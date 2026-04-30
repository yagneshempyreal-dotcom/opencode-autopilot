import type { IncomingMessage, ServerResponse } from "node:http";
import { logger } from "../util/log.js";
import { classify } from "../classifier/index.js";
import { decide, bumpStickyFloor, GOAL_MATRIX } from "../policy/index.js";
import { dispatch } from "../forwarder/index.js";
import { findModel, modelsForTier } from "../registry/index.js";
import { parseRequest } from "./parse.js";
import { sseLines, extractDeltaText, extractUsage, extractFinishReason } from "./sse.js";
import { formatBadge } from "../badge/format.js";
import { getSession, recordUsage, setStickyFloor, resetStickyFloor } from "../session/state.js";
import { estimateRequestTokens, estimateStringTokens } from "../util/tokens.js";
import { saveConfig } from "../config/store.js";
import { loadAuth } from "../config/auth.js";
import { extractTaskTags } from "../classifier/tags.js";
import { saveHealth, verifyAll, key as healthKey } from "../registry/health.js";
import type { ProxyContext } from "./context.js";
import type { ChatCompletionRequest, Goal, Tier } from "../types.js";

const MAX_REQUEST_BYTES = 8 * 1024 * 1024;

export async function handleChatCompletions(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ProxyContext,
): Promise<void> {
  const raw = await readJSON(req).catch((err) => {
    fail(res, 400, `invalid JSON: ${(err as Error).message}`);
    return null;
  });
  if (!raw) return;

  const request = raw as ChatCompletionRequest;
  if (!request.messages || !Array.isArray(request.messages) || request.messages.length === 0) {
    fail(res, 400, "missing or empty messages");
    return;
  }
  if (!request.messages.some((m) => m && (m.role === "user" || m.role === "system" || m.role === "assistant" || m.role === "tool"))) {
    fail(res, 400, "no valid message roles");
    return;
  }

  const sessionHeader = (req.headers["x-session-id"] as string | undefined) ?? null;
  const parsed = parseRequest(request, sessionHeader);
  const session = getSession(parsed.sessionID);

  if (parsed.signals.reset) resetStickyFloor(parsed.sessionID);
  if (parsed.signals.autoOff) ctx.setAutoEnabled(false);
  if (parsed.signals.autoOn) ctx.setAutoEnabled(true);

  if (parsed.signals.goalSwitch) {
    const before = ctx.config.goal;
    ctx.config.goal = parsed.signals.goalSwitch;
    try { await saveConfig(ctx.config); } catch (err) {
      logger.warn("saveConfig failed after goal switch", { err: (err as Error).message });
    }
    respondInline(res, parsed.request.stream === true, formatGoalSwitchAck(before, ctx.config.goal, ctx));
    return;
  }
  if (parsed.signals.statusRequested) {
    respondInline(res, parsed.request.stream === true, formatStatus(ctx));
    return;
  }
  if (parsed.signals.modelsRequested) {
    respondInline(res, parsed.request.stream === true, formatModels(ctx));
    return;
  }
  if (parsed.signals.verifyRequested) {
    const text = await runVerify(ctx);
    respondInline(res, parsed.request.stream === true, text);
    return;
  }
  if (parsed.signals.healthRequested) {
    respondInline(res, parsed.request.stream === true, formatHealth(ctx));
    return;
  }
  if (parsed.signals.pickArg) {
    const text = await applyPick(ctx, parsed.signals.pickArg);
    respondInline(res, parsed.request.stream === true, text);
    return;
  }
  if (parsed.signals.badgeMode) {
    const wanted = parsed.signals.badgeMode === "verbose";
    ctx.config.ux.badge = wanted;
    await saveConfig(ctx.config).catch(() => {});
    respondInline(res, parsed.request.stream === true,
      `**router · badge ${wanted ? "verbose" : "quiet"}**\n\nBadges will ${wanted
        ? "show on every model change (and on tier escalation, sticky bump, context warning)"
        : "be suppressed entirely"}. Toggle: \`router ${wanted ? "quiet" : "verbose"}\`.`);
    return;
  }

  if (!ctx.autoEnabled() && !parsed.override) {
    fail(res, 503, "router disabled (/auto off). Re-enable with /auto on.");
    return;
  }

  const triageEnabled = ctx.config.triage.enabled && !!ctx.triageModel;

  const classification = await classify({
    messages: parsed.request.messages,
    goal: ctx.config.goal,
    triageEnabled,
    triageModel: ctx.triageModel,
    auth: ctx.auth,
  });

  const wouldBeTier = (() => {
    const matrix: Record<string, Record<string, string>> = {
      cost: { low: "free", medium: "free", high: "cheap-paid" },
      balance: { low: "free", medium: "cheap-paid", high: "top-paid" },
      quality: { low: "cheap-paid", medium: "top-paid", high: "top-paid" },
      custom: { low: "free", medium: "cheap-paid", high: "top-paid" },
    };
    const row = matrix[ctx.config.goal] ?? matrix.balance;
    return (row?.[classification.tier] ?? "cheap-paid") as "free" | "cheap-paid" | "top-paid";
  })();

  const stickyBumpedTo = parsed.signals.upgradeRequested
    ? bumpStickyFloor(session.stickyFloor, wouldBeTier)
    : null;
  if (stickyBumpedTo) setStickyFloor(parsed.sessionID, stickyBumpedTo);

  const estimatedTokens = estimateRequestTokens(parsed.request.messages);
  const taskTags = extractTaskTags(parsed.request.messages);

  const decision = decide({
    classification,
    config: ctx.config,
    registry: ctx.registry,
    stickyFloor: getSession(parsed.sessionID).stickyFloor,
    override: parsed.override,
    estimatedTokens,
    health: ctx.health,
    taskTags,
  });

  if (!decision) {
    fail(res, 503, "no model available in any tier");
    ctx.events.emit({ type: "error", sessionID: parsed.sessionID, message: "no model available" });
    return;
  }

  const targetModel = findModel(ctx.registry, `${decision.provider}/${decision.modelID}`);
  if (!targetModel) {
    fail(res, 500, `chosen model not in registry: ${decision.modelID}`);
    return;
  }

  ctx.events.emit({
    type: "route",
    sessionID: parsed.sessionID,
    modelID: decision.modelID,
    tier: decision.tier,
    escalated: decision.escalated,
  });
  if (stickyBumpedTo) {
    ctx.events.emit({
      type: "sticky-bump",
      sessionID: parsed.sessionID,
      from: session.stickyFloor,
      to: stickyBumpedTo,
    });
  }

  const utilization = estimatedTokens / Math.max(targetModel.ctxWindow, 1);
  const warnHandover = utilization >= ctx.config.handover.thresholdWarn;
  if (warnHandover) {
    ctx.events.emit({ type: "ctx", sessionID: parsed.sessionID, utilization, modelID: decision.modelID });
  }
  const triggerHandover = ctx.config.handover.enabled && utilization >= ctx.config.handover.thresholdSave;
  if (triggerHandover) {
    ctx.events.emit({ type: "handover", sessionID: parsed.sessionID, reason: `utilization ${utilization.toFixed(2)}` });
  }

  // Dedup: agentic flows can emit dozens of tool-call requests per user
  // turn. Only show the badge when something interesting changed —
  // different model, escalation, sticky bump, or a context warning.
  const lastModel = session.lastModel;
  const sameAsLast = lastModel === `${decision.provider}/${decision.modelID}` || lastModel === decision.modelID;
  const interesting = decision.escalated || decision.override || !!stickyBumpedTo || warnHandover;
  const showBadge = ctx.config.ux.badge && (!sameAsLast || interesting);
  const badge = showBadge
    ? formatBadge({
        decision,
        ctxUtilization: utilization,
        warnHandover,
        stickyBumpedTo,
      })
    : null;

  const stream = parsed.request.stream ?? false;
  parsed.request.stream = stream;

  // Reload auth from disk if any cached entry is OAuth — opencode refreshes
  // access tokens and writes them back to auth.json, and a stale value here
  // gives 401 once the token expires (~1 h). API-key-only setups skip the
  // file read; this also keeps tests deterministic when ctx.auth is a literal.
  let liveAuth = ctx.auth;
  const hasOAuth = Object.values(ctx.auth).some((e) => e?.type === "oauth");
  if (hasOAuth) {
    try {
      liveAuth = await loadAuth();
      ctx.auth = liveAuth;
    } catch (err) {
      logger.warn("auth reload failed; using cached", { err: (err as Error).message });
    }
  }

  let dispatchResult;
  try {
    dispatchResult = await dispatch({
      decision,
      request: parsed.request,
      registry: ctx.registry,
      auth: liveAuth,
      allowEscalation: !parsed.override,
      health: ctx.health,
    });
    // Persist any health updates made during dispatch (best-effort).
    saveHealth(ctx.health).catch((e) => logger.warn("saveHealth failed", { err: (e as Error).message }));
  } catch (err) {
    logger.error("dispatch failed", { err: (err as Error).message });
    // Returning a 5xx makes opencode retry the whole turn (3x by default),
    // burning the same dead-model cascade each time. Return 200 with a
    // synthetic assistant message instead so the user sees what's wrong
    // and the host stops retrying.
    const text = formatExhaustedReply(ctx, decision, (err as Error).message);
    respondInline(res, parsed.request.stream === true, text);
    return;
  }

  res.statusCode = dispatchResult.status;
  const HOP_BY_HOP = new Set([
    "transfer-encoding",
    "content-encoding",
    "content-length",
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "upgrade",
  ]);
  for (const [k, v] of Object.entries(dispatchResult.headers)) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    res.setHeader(k, v);
  }

  const responseContentType = (dispatchResult.headers["content-type"] ?? dispatchResult.headers["Content-Type"] ?? "").toLowerCase();
  const isStream = responseContentType.includes("text/event-stream") || (parsed.request.stream === true && responseContentType === "");

  if (!dispatchResult.body) {
    res.end();
    recordUsage(parsed.sessionID, estimatedTokens, 0, decision.modelID);
    return;
  }

  if (isStream) {
    await streamWithContinuation({
      res,
      ctx,
      initialBody: dispatchResult.body,
      initialModelID: decision.modelID,
      initialProvider: decision.provider,
      badge,
      sessionID: parsed.sessionID,
      estimatedIn: estimatedTokens,
      baseRequest: parsed.request,
      decision,
      allowEscalation: !parsed.override,
      override: parsed.override,
    });
    return;
  }

  await passThroughJSON(res, dispatchResult.body, badge, parsed.sessionID, decision.modelID, estimatedTokens);
}

async function passThroughJSON(
  res: ServerResponse,
  body: ReadableStream<Uint8Array>,
  badge: string | null,
  sessionID: string,
  modelID: string,
  estimatedIn: number,
): Promise<void> {
  const chunks: Buffer[] = [];
  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  const text = Buffer.concat(chunks).toString("utf8");
  const enriched = badge ? prependBadgeToJSON(text, badge) : text;
  res.end(enriched);

  let outTokens = estimateStringTokens(text);
  let usageIn = estimatedIn;
  let usageOut = outTokens;
  try {
    const parsed = JSON.parse(text) as { usage?: { prompt_tokens?: number; completion_tokens?: number } };
    if (parsed.usage) {
      usageIn = parsed.usage.prompt_tokens ?? usageIn;
      usageOut = parsed.usage.completion_tokens ?? usageOut;
    }
  } catch { /* not JSON */ }
  recordUsage(sessionID, usageIn, usageOut, modelID);
}

async function readJSON(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_REQUEST_BYTES) throw new Error("request too large");
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) throw new Error("empty body");
  return JSON.parse(text);
}

function fail(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ error: { message } }));
}

async function streamThrough(
  res: ServerResponse,
  body: ReadableStream<Uint8Array>,
  badge: string | null,
  sessionID: string,
  modelID: string,
  estimatedIn: number,
): Promise<void> {
  let badgeSent = false;
  let outTokens = 0;
  let usageReported = false;

  for await (const line of sseLines(body)) {
    if (!badgeSent && badge && line.startsWith("data:")) {
      const inject = makeBadgeChunk(badge);
      if (inject) res.write(`data: ${inject}\n\n`);
      badgeSent = true;
    }
    res.write(`${line}\n`);
    const delta = extractDeltaText(line);
    if (delta) outTokens += estimateStringTokens(delta);
    const usage = extractUsage(line);
    if (usage) {
      recordUsage(sessionID, usage.in, usage.out, modelID);
      usageReported = true;
    }
  }
  if (!usageReported) recordUsage(sessionID, estimatedIn, outTokens, modelID);
  res.end();
}

const MAX_CONTINUATION_HOPS = 2;

async function streamWithContinuation(input: {
  res: ServerResponse;
  ctx: ProxyContext;
  initialBody: ReadableStream<Uint8Array>;
  initialProvider: string;
  initialModelID: string;
  badge: string | null;
  sessionID: string;
  estimatedIn: number;
  baseRequest: ChatCompletionRequest;
  decision: { provider: string; modelID: string; tier: Tier; reason: string; escalated: boolean; override: boolean };
  allowEscalation: boolean;
  override: { modelRef: string } | null;
}): Promise<void> {
  const { res, ctx, sessionID, estimatedIn } = input;
  const baseMessages = input.baseRequest.messages;
  let hop = 0;
  let badgeSent = false;
  let accumulated = "";
  const excluded = new Set<string>();

  let currentBody: ReadableStream<Uint8Array> | null = input.initialBody;
  let currentModelKey = `${input.initialProvider}/${input.initialModelID}`;
  let currentModelIDForUsage = input.initialModelID;
  let currentEstimatedIn = estimatedIn;

  while (currentBody) {
    const out = await pipeSSEOnce({
      res,
      body: currentBody,
      badge: input.badge,
      badgeSent,
      sessionID,
      modelID: currentModelIDForUsage,
      estimatedIn: currentEstimatedIn,
      onDelta: (d) => { accumulated += d; },
    });
    badgeSent = out.badgeSent;

    if (out.finishReason !== "length") {
      // Normal termination (or unknown) — forward the final chunk + DONE.
      if (out.finalLine) {
        res.write(`${out.finalLine}\n`);
        res.write("\n");
      }
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    // Upstream hit output limit. Auto-continue by re-dispatching with an
    // explicit "continue" turn, while avoiding the truncating model.
    if (hop >= MAX_CONTINUATION_HOPS || input.override) {
      // Can't/shouldn't auto-continue when user forced a specific model.
      if (out.finalLine) {
        res.write(`${out.finalLine}\n`);
        res.write("\n");
      }
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    excluded.add(currentModelKey);
    hop += 1;

    const nextRequest: ChatCompletionRequest = {
      ...input.baseRequest,
      stream: true,
      messages: [
        ...baseMessages,
        { role: "assistant", content: accumulated },
        { role: "user", content: "continue" },
      ],
    };

    const next = await dispatch({
      decision: input.decision,
      request: nextRequest,
      registry: ctx.registry,
      auth: ctx.auth,
      allowEscalation: input.allowEscalation,
      health: ctx.health,
      exclude: Array.from(excluded),
    });
    currentBody = next.body;
    currentModelKey = healthKey(next.modelUsed.provider, next.modelUsed.modelID);
    currentModelIDForUsage = next.modelUsed.modelID;
    currentEstimatedIn = 0;
  }
  res.end();
}

async function pipeSSEOnce(input: {
  res: ServerResponse;
  body: ReadableStream<Uint8Array>;
  badge: string | null;
  badgeSent: boolean;
  sessionID: string;
  modelID: string;
  estimatedIn: number;
  onDelta: (d: string) => void;
}): Promise<{ finishReason: string | null; finalLine: string | null; badgeSent: boolean }> {
  const { res, body, sessionID, modelID } = input;
  let badgeSent = input.badgeSent;
  let outTokens = 0;
  let usageReported = false;
  let finishReason: string | null = null;
  let finalLine: string | null = null;

  for await (const line of sseLines(body)) {
    if (!badgeSent && input.badge && line.startsWith("data:")) {
      const inject = makeBadgeChunk(input.badge);
      if (inject) res.write(`data: ${inject}\n\n`);
      badgeSent = true;
    }
    if (line.trim() === "data: [DONE]") {
      continue;
    }
    const fr = extractFinishReason(line);
    if (fr) {
      finishReason = fr;
      finalLine = line;
      continue;
    }
    res.write(`${line}\n`);
    const delta = extractDeltaText(line);
    if (delta) {
      input.onDelta(delta);
      outTokens += estimateStringTokens(delta);
    }
    const usage = extractUsage(line);
    if (usage) {
      recordUsage(sessionID, usage.in, usage.out, modelID);
      usageReported = true;
    }
  }
  if (!usageReported) recordUsage(sessionID, input.estimatedIn, outTokens, modelID);
  return { finishReason, finalLine, badgeSent };
}

function makeBadgeChunk(badge: string): string | null {
  try {
    return JSON.stringify({
      id: `chatcmpl-router-${Date.now()}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "openauto/auto",
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: `${badge}\n` },
          finish_reason: null,
        },
      ],
    });
  } catch {
    return null;
  }
}

function prependBadgeToJSON(json: string, badge: string): string {
  try {
    const parsed = JSON.parse(json) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const c = parsed.choices?.[0]?.message;
    if (c && typeof c.content === "string") {
      c.content = `${badge}\n${c.content}`;
    }
    return JSON.stringify(parsed);
  } catch {
    return json;
  }
}

function respondInline(res: ServerResponse, stream: boolean, text: string): void {
  if (stream) {
    res.statusCode = 200;
    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache");
    const id = `chatcmpl-router-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const chunk = JSON.stringify({
      id, object: "chat.completion.chunk", created, model: "openauto/auto",
      choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }],
    });
    const done = JSON.stringify({
      id, object: "chat.completion.chunk", created, model: "openauto/auto",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    });
    res.write(`data: ${chunk}\n\n`);
    res.write(`data: ${done}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({
    id: `chatcmpl-router-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "openauto/auto",
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  }));
}

function formatGoalSwitchAck(before: Goal, after: Goal, ctx: ProxyContext): string {
  const lines = [
    `**router goal: ${before} → ${after}**`,
    "",
    "Routing matrix for the new goal:",
    ...goalMatrixPreview(after, ctx),
    "",
    "Tip: `router status` to see current pick · `router models` to list models per tier.",
  ];
  return lines.join("\n");
}

function formatStatus(ctx: ProxyContext): string {
  const tierCounts = (["free", "cheap-paid", "top-paid"] as Tier[])
    .map((t) => `${t}=${modelsForTier(ctx.registry, t).length}`)
    .join("  ");
  const okCount = Object.values((ctx.health?.records ?? {})).filter((r) => r.status === "ok").length;
  const downCount = Object.values((ctx.health?.records ?? {})).filter((r) => r.status === "down").length;
  const allow = ctx.config.allowlist ?? [];
  return [
    `**router status**`,
    ``,
    `Goal:        ${ctx.config.goal}`,
    `Auto:        ${ctx.autoEnabled() ? "on" : "off"}`,
    `Triage:      ${ctx.config.triage.enabled ? "on" : "off"}`,
    `Models:      ${tierCounts}`,
    `Health:      ok=${okCount}  down=${downCount}  unprobed=${ctx.registry.models.length - okCount - downCount}`,
    `Pinned:      ${allow.length === 0 ? "(none — using full registry)" : `${allow.length} model(s)`}`,
    ``,
    `Routing matrix for current goal:`,
    ...goalMatrixPreview(ctx.config.goal, ctx),
    ``,
    `Commands:`,
    `  router verify                          probe every model & save health`,
    `  router pick all-ok | <id,id,...> | clear   pin which models routing may use`,
    `  router health                          show last-known health`,
    `  router goal cost|balance|quality       switch routing strategy`,
  ].join("\n");
}

function formatModels(ctx: ProxyContext): string {
  const lines = [`**available models**`, ``];
  for (const tier of ["free", "cheap-paid", "top-paid"] as Tier[]) {
    const ms = modelsForTier(ctx.registry, tier);
    lines.push(`_${tier}_ (${ms.length}):`);
    if (ms.length === 0) { lines.push(`  · (none)`); continue; }
    for (const m of ms.slice(0, 12)) lines.push(`  · ${m.provider}/${m.modelID}`);
    if (ms.length > 12) lines.push(`  · …+${ms.length - 12} more`);
    lines.push("");
  }
  return lines.join("\n");
}

async function runVerify(ctx: ProxyContext): Promise<string> {
  const models = ctx.registry.models;
  if (models.length === 0) return "(no models in registry — run `opencode-openauto init`)";
  const report = await verifyAll(models, ctx.auth, ctx.health, { concurrency: 4, timeoutMs: 8000 });
  await saveHealth(ctx.health).catch(() => {});

  // Auto-pin the OK set so the next request goes straight to a working
  // model — no cascade through the dead ones. User can override with
  // `router pick clear` or a manual list.
  let autoPinned = false;
  if (report.ok.length > 0) {
    ctx.config.allowlist = report.ok;
    await saveConfig(ctx.config).catch(() => {});
    autoPinned = true;
  }

  const lines: string[] = [
    `**router verify** (${(report.durationMs / 1000).toFixed(1)}s)`,
    "",
    `OK    ${report.ok.length}/${report.total}`,
    `Down  ${report.down.length}/${report.total}`,
    "",
  ];
  if (report.ok.length > 0) {
    lines.push("_working_:");
    for (const id of report.ok) {
      const m = ctx.registry.byID.get(id);
      const tagstr = m && m.tags.length > 0 ? `  [${m.tags.join(",")}]` : "";
      lines.push(`  ✓ ${id}${tagstr}`);
    }
    lines.push("");
  }
  if (report.down.length > 0) {
    lines.push("_failing_:");
    for (const d of report.down) lines.push(`  ✗ ${d.id}  (status=${d.status}${d.error ? ` · ${d.error.slice(0, 60)}` : ""})`);
    lines.push("");
  }
  if (autoPinned) {
    lines.push(`✓ auto-pinned ${report.ok.length} model(s) — routing will only use these.`);
    lines.push("Override anytime: `router pick clear` (use full registry) or `router pick a/b, c/d` (custom).");
  } else {
    lines.push("Pin manually: `router pick provider/m1, provider/m2`");
  }
  return lines.join("\n");
}

function formatHealth(ctx: ProxyContext): string {
  const records = Object.entries((ctx.health?.records ?? {}));
  if (records.length === 0) return "(no health records yet — run `router verify`)";
  records.sort(([a], [b]) => a.localeCompare(b));
  const lines = [`**health** (${records.length} records)`, ""];
  for (const [id, r] of records) {
    const ageMs = Date.now() - r.lastChecked;
    const age = ageMs < 60000 ? `${Math.round(ageMs / 1000)}s` : `${Math.round(ageMs / 60000)}m`;
    const sym = r.status === "ok" ? "✓" : r.status === "down" ? "✗" : "?";
    const lat = r.latencyMs ? ` ${r.latencyMs}ms` : "";
    const reason = r.lastError ? `  ${r.lastError.slice(0, 60)}` : "";
    lines.push(`  ${sym} ${id}${lat}  (checked ${age} ago)${reason}`);
  }
  return lines.join("\n");
}

async function applyPick(ctx: ProxyContext, arg: string): Promise<string> {
  const trimmed = arg.trim();
  if (/^clear$|^reset$|^none$/i.test(trimmed)) {
    ctx.config.allowlist = [];
    await saveConfig(ctx.config);
    return "**router pick: cleared.** Full registry is now eligible.";
  }
  let picks: string[];
  if (/^all-?ok$/i.test(trimmed)) {
    picks = Object.entries((ctx.health?.records ?? {}))
      .filter(([, r]) => r.status === "ok")
      .map(([id]) => id);
    if (picks.length === 0) return "No models with status=ok found. Run `router verify` first.";
  } else {
    picks = trimmed.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  }
  // Validate against registry.
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const id of picks) {
    if (ctx.registry.byID.has(id)) valid.push(id);
    else invalid.push(id);
  }
  if (valid.length === 0) {
    return [
      "**router pick: no valid model IDs.**",
      "Use `provider/modelID` form (e.g. `openai/gpt-5.4-mini`).",
      "Run `router models` to see the registry.",
    ].join("\n");
  }
  ctx.config.allowlist = valid;
  await saveConfig(ctx.config);
  const out = [
    `**router pick: pinned ${valid.length} model(s)**`,
    "",
    ...valid.map((id) => `  · ${id}`),
  ];
  if (invalid.length > 0) {
    out.push("");
    out.push(`Skipped (not in registry): ${invalid.join(", ")}`);
  }
  out.push("");
  out.push("Switch goal: `router goal cost|balance|quality`");
  out.push("Re-verify any time: `router verify`");
  return out.join("\n");
}

function formatExhaustedReply(ctx: ProxyContext, decision: { tier: Tier; modelID: string }, errMsg: string): string {
  const records = Object.entries(ctx.health?.records ?? {});
  const ok = records.filter(([, r]) => r.status === "ok").map(([id]) => id);
  const quotaDown = records.filter(([, r]) => r.status === "down" && r.quotaError).map(([id]) => id);
  const otherDown = records.filter(([, r]) => r.status === "down" && !r.quotaError).map(([id]) => id);
  const totalRegistry = ctx.registry.models.length;

  // Bucket failures by root cause so we can give a specific fix instead
  // of a generic checklist. Parse the dispatch error JSON if present.
  const auth = parseAttempts(errMsg);
  const causes = classifyCauses(auth);

  const lines: string[] = [
    "**router · all candidates failed**",
    "",
    `Tried tier \`${decision.tier}\` first (and fell through). Last error:`,
    "```",
    errMsg.slice(0, 400),
    "```",
    "",
    `Registry has ${totalRegistry} model(s). Health right now:`,
    `  · ok:        ${ok.length}`,
    `  · quota:     ${quotaDown.length}    (402/429/insufficient balance — backoff 60min)`,
    `  · other:     ${otherDown.length}    (transient — retried after 5min)`,
    "",
  ];

  // Targeted advice based on what actually broke.
  if (causes.expiredOAuth.length > 0) {
    lines.push("**Expired OAuth tokens.** opencode's OAuth access tokens expire (~1 h). The router can't refresh them — re-login through opencode:");
    for (const p of causes.expiredOAuth) lines.push(`  · ${p} — run \`opencode auth login ${p}\``);
    lines.push("");
  }
  if (causes.missingCreds.length > 0) {
    lines.push("**Missing auth credentials.** opencode reported 401 / \"no credentials for…\" for:");
    for (const p of causes.missingCreds) lines.push(`  · ${p} — run \`opencode auth login ${p}\``);
    lines.push("");
  }
  if (causes.invalidCreds.length > 0) {
    lines.push("**Invalid / expired credentials.** Provider returned 401 / 403:");
    for (const p of causes.invalidCreds) lines.push(`  · ${p} — re-run \`opencode auth login ${p}\``);
    lines.push("");
  }
  if (causes.quota.length > 0) {
    lines.push("**Quota / billing exhausted** (402, 429, \"insufficient balance\"):");
    for (const p of causes.quota) lines.push(`  · ${p} — top up the account or wait, then \`router verify\``);
    lines.push("");
  }
  if (causes.notFound.length > 0) {
    lines.push("**Model not found** (404). The model id in your config doesn't exist on the provider:");
    for (const id of causes.notFound) lines.push(`  · ${id} — remove it from \`~/.config/opencode/autopilot.json\` tiers`);
    lines.push("");
  }
  if (totalRegistry <= 1) {
    lines.push("**Only 1 model in the registry.** You need more providers configured for routing to be useful:");
    lines.push("  · `opencode auth login openrouter`   — free + paid via openrouter");
    lines.push("  · `opencode auth login deepseek`     — cheap chat / reasoner");
    lines.push("  · `opencode auth login anthropic`    — claude family");
    lines.push("  · or use opencode's wellknown free tier (no key required)");
    lines.push("");
  }

  lines.push("Generic next steps:");
  lines.push("  1. `router verify`    — re-probe everything; auto-pins the OK set");
  lines.push("  2. `router goal cost` — prefer free models if your paid quotas are out");
  lines.push("  3. `router models`    — see what's actually in your registry");

  if (ok.length > 0) {
    lines.push("");
    lines.push(`Currently working: ${ok.slice(0, 5).join(", ")}${ok.length > 5 ? ` (+${ok.length - 5} more)` : ""}`);
    lines.push("Pin them: `router pick all-ok`");
  }
  return lines.join("\n");
}

interface AttemptInfo { provider: string; modelID: string; status: number; reason?: string; }

function parseAttempts(errMsg: string): AttemptInfo[] {
  // dispatch errors look like: forward 503: all candidates failed: [{...},{...}]
  const m = /\[(\{.*\})\]/s.exec(errMsg);
  if (!m) return [];
  try {
    return JSON.parse(`[${m[1]}]`) as AttemptInfo[];
  } catch { return []; }
}

interface CauseBuckets {
  missingCreds: string[]; // provider names with "no credentials"
  expiredOAuth: string[]; // provider names with expired oauth tokens
  invalidCreds: string[]; // 401/403 with creds present
  quota: string[];        // providers with 402/429
  notFound: string[];     // model ids that 404'd
}

function classifyCauses(attempts: AttemptInfo[]): CauseBuckets {
  const out: CauseBuckets = { missingCreds: [], expiredOAuth: [], invalidCreds: [], quota: [], notFound: [] };
  const seenProvider = (set: string[], p: string) => { if (!set.includes(p)) set.push(p); };
  for (const a of attempts) {
    const reason = (a.reason ?? "").toLowerCase();
    if (/oauth token expired/.test(reason)) {
      seenProvider(out.expiredOAuth, a.provider);
    } else if (a.status === 401 || /no credentials|missing.*key|unauthorized/.test(reason)) {
      if (/no credentials/.test(reason)) seenProvider(out.missingCreds, a.provider);
      else seenProvider(out.invalidCreds, a.provider);
    } else if (a.status === 403) {
      seenProvider(out.invalidCreds, a.provider);
    } else if (a.status === 402 || a.status === 429 || /insufficient.*balance|exceeded.*quota/.test(reason)) {
      seenProvider(out.quota, a.provider);
    } else if (a.status === 404 || /not found|model.*does not exist/.test(reason)) {
      out.notFound.push(`${a.provider}/${a.modelID}`);
    }
  }
  return out;
}

function goalMatrixPreview(goal: Goal, ctx: ProxyContext): string[] {
  const row = GOAL_MATRIX[goal];
  const out: string[] = [];
  for (const c of ["low", "medium", "high"] as const) {
    const tier = row[c];
    const pool = modelsForTier(ctx.registry, tier);
    const sample = pool[0] ? `${pool[0].provider}/${pool[0].modelID}` : "(no model in tier — will escalate)";
    out.push(`  · ${c.padEnd(6)} → ${tier.padEnd(11)} → ${sample}`);
  }
  return out;
}
