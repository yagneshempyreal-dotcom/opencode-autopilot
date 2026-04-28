import { logger } from "../util/log.js";
import { classify } from "../classifier/index.js";
import { decide, bumpStickyFloor, GOAL_MATRIX } from "../policy/index.js";
import { dispatch } from "../forwarder/index.js";
import { findModel, modelsForTier } from "../registry/index.js";
import { parseRequest } from "./parse.js";
import { sseLines, extractDeltaText, extractUsage } from "./sse.js";
import { formatBadge } from "../badge/format.js";
import { getSession, recordUsage, setStickyFloor, resetStickyFloor } from "../session/state.js";
import { estimateRequestTokens, estimateStringTokens } from "../util/tokens.js";
import { saveConfig } from "../config/store.js";
import { extractTaskTags } from "../classifier/tags.js";
import { saveHealth, verifyAll } from "../registry/health.js";
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
export async function handleChatCompletions(req, res, ctx) {
    const raw = await readJSON(req).catch((err) => {
        fail(res, 400, `invalid JSON: ${err.message}`);
        return null;
    });
    if (!raw)
        return;
    const request = raw;
    if (!request.messages || !Array.isArray(request.messages) || request.messages.length === 0) {
        fail(res, 400, "missing or empty messages");
        return;
    }
    if (!request.messages.some((m) => m && (m.role === "user" || m.role === "system" || m.role === "assistant" || m.role === "tool"))) {
        fail(res, 400, "no valid message roles");
        return;
    }
    const sessionHeader = req.headers["x-session-id"] ?? null;
    const parsed = parseRequest(request, sessionHeader);
    const session = getSession(parsed.sessionID);
    if (parsed.signals.reset)
        resetStickyFloor(parsed.sessionID);
    if (parsed.signals.autoOff)
        ctx.setAutoEnabled(false);
    if (parsed.signals.autoOn)
        ctx.setAutoEnabled(true);
    if (parsed.signals.goalSwitch) {
        const before = ctx.config.goal;
        ctx.config.goal = parsed.signals.goalSwitch;
        try {
            await saveConfig(ctx.config);
        }
        catch (err) {
            logger.warn("saveConfig failed after goal switch", { err: err.message });
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
        const matrix = {
            cost: { low: "free", medium: "free", high: "cheap-paid" },
            balance: { low: "free", medium: "cheap-paid", high: "top-paid" },
            quality: { low: "cheap-paid", medium: "top-paid", high: "top-paid" },
            custom: { low: "free", medium: "cheap-paid", high: "top-paid" },
        };
        const row = matrix[ctx.config.goal] ?? matrix.balance;
        return (row?.[classification.tier] ?? "cheap-paid");
    })();
    const stickyBumpedTo = parsed.signals.upgradeRequested
        ? bumpStickyFloor(session.stickyFloor, wouldBeTier)
        : null;
    if (stickyBumpedTo)
        setStickyFloor(parsed.sessionID, stickyBumpedTo);
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
    const badge = ctx.config.ux.badge
        ? formatBadge({
            decision,
            ctxUtilization: utilization,
            warnHandover,
            stickyBumpedTo,
        })
        : null;
    const stream = parsed.request.stream ?? false;
    parsed.request.stream = stream;
    let dispatchResult;
    try {
        dispatchResult = await dispatch({
            decision,
            request: parsed.request,
            registry: ctx.registry,
            auth: ctx.auth,
            allowEscalation: !parsed.override,
            health: ctx.health,
        });
        // Persist any health updates made during dispatch (best-effort).
        saveHealth(ctx.health).catch((e) => logger.warn("saveHealth failed", { err: e.message }));
    }
    catch (err) {
        logger.error("dispatch failed", { err: err.message });
        fail(res, 502, `dispatch failed: ${err.message}`);
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
        if (HOP_BY_HOP.has(k.toLowerCase()))
            continue;
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
        await streamThrough(res, dispatchResult.body, badge, parsed.sessionID, decision.modelID, estimatedTokens);
        return;
    }
    await passThroughJSON(res, dispatchResult.body, badge, parsed.sessionID, decision.modelID, estimatedTokens);
}
async function passThroughJSON(res, body, badge, sessionID, modelID, estimatedIn) {
    const chunks = [];
    const reader = body.getReader();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            if (value)
                chunks.push(Buffer.from(value));
        }
    }
    finally {
        reader.releaseLock();
    }
    const text = Buffer.concat(chunks).toString("utf8");
    const enriched = badge ? prependBadgeToJSON(text, badge) : text;
    res.end(enriched);
    let outTokens = estimateStringTokens(text);
    let usageIn = estimatedIn;
    let usageOut = outTokens;
    try {
        const parsed = JSON.parse(text);
        if (parsed.usage) {
            usageIn = parsed.usage.prompt_tokens ?? usageIn;
            usageOut = parsed.usage.completion_tokens ?? usageOut;
        }
    }
    catch { /* not JSON */ }
    recordUsage(sessionID, usageIn, usageOut, modelID);
}
async function readJSON(req) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buf.length;
        if (total > MAX_REQUEST_BYTES)
            throw new Error("request too large");
        chunks.push(buf);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    if (!text)
        throw new Error("empty body");
    return JSON.parse(text);
}
function fail(res, status, message) {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: { message } }));
}
async function streamThrough(res, body, badge, sessionID, modelID, estimatedIn) {
    let badgeSent = false;
    let outTokens = 0;
    let usageReported = false;
    for await (const line of sseLines(body)) {
        if (!badgeSent && badge && line.startsWith("data:")) {
            const inject = makeBadgeChunk(badge);
            if (inject)
                res.write(`data: ${inject}\n\n`);
            badgeSent = true;
        }
        res.write(`${line}\n`);
        const delta = extractDeltaText(line);
        if (delta)
            outTokens += estimateStringTokens(delta);
        const usage = extractUsage(line);
        if (usage) {
            recordUsage(sessionID, usage.in, usage.out, modelID);
            usageReported = true;
        }
    }
    if (!usageReported)
        recordUsage(sessionID, estimatedIn, outTokens, modelID);
    res.end();
}
function makeBadgeChunk(badge) {
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
    }
    catch {
        return null;
    }
}
function prependBadgeToJSON(json, badge) {
    try {
        const parsed = JSON.parse(json);
        const c = parsed.choices?.[0]?.message;
        if (c && typeof c.content === "string") {
            c.content = `${badge}\n${c.content}`;
        }
        return JSON.stringify(parsed);
    }
    catch {
        return json;
    }
}
function respondInline(res, stream, text) {
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
function formatGoalSwitchAck(before, after, ctx) {
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
function formatStatus(ctx) {
    const tierCounts = ["free", "cheap-paid", "top-paid"]
        .map((t) => `${t}=${modelsForTier(ctx.registry, t).length}`)
        .join("  ");
    const okCount = Object.values(ctx.health.records).filter((r) => r.status === "ok").length;
    const downCount = Object.values(ctx.health.records).filter((r) => r.status === "down").length;
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
function formatModels(ctx) {
    const lines = [`**available models**`, ``];
    for (const tier of ["free", "cheap-paid", "top-paid"]) {
        const ms = modelsForTier(ctx.registry, tier);
        lines.push(`_${tier}_ (${ms.length}):`);
        if (ms.length === 0) {
            lines.push(`  · (none)`);
            continue;
        }
        for (const m of ms.slice(0, 12))
            lines.push(`  · ${m.provider}/${m.modelID}`);
        if (ms.length > 12)
            lines.push(`  · …+${ms.length - 12} more`);
        lines.push("");
    }
    return lines.join("\n");
}
async function runVerify(ctx) {
    const models = ctx.registry.models;
    if (models.length === 0)
        return "(no models in registry — run `opencode-openauto init`)";
    const report = await verifyAll(models, ctx.auth, ctx.health, { concurrency: 4, timeoutMs: 8000 });
    await saveHealth(ctx.health).catch(() => { });
    // Auto-pin the OK set so the next request goes straight to a working
    // model — no cascade through the dead ones. User can override with
    // `router pick clear` or a manual list.
    let autoPinned = false;
    if (report.ok.length > 0) {
        ctx.config.allowlist = report.ok;
        await saveConfig(ctx.config).catch(() => { });
        autoPinned = true;
    }
    const lines = [
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
        for (const d of report.down)
            lines.push(`  ✗ ${d.id}  (status=${d.status}${d.error ? ` · ${d.error.slice(0, 60)}` : ""})`);
        lines.push("");
    }
    if (autoPinned) {
        lines.push(`✓ auto-pinned ${report.ok.length} model(s) — routing will only use these.`);
        lines.push("Override anytime: `router pick clear` (use full registry) or `router pick a/b, c/d` (custom).");
    }
    else {
        lines.push("Pin manually: `router pick provider/m1, provider/m2`");
    }
    return lines.join("\n");
}
function formatHealth(ctx) {
    const records = Object.entries(ctx.health.records);
    if (records.length === 0)
        return "(no health records yet — run `router verify`)";
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
async function applyPick(ctx, arg) {
    const trimmed = arg.trim();
    if (/^clear$|^reset$|^none$/i.test(trimmed)) {
        ctx.config.allowlist = [];
        await saveConfig(ctx.config);
        return "**router pick: cleared.** Full registry is now eligible.";
    }
    let picks;
    if (/^all-?ok$/i.test(trimmed)) {
        picks = Object.entries(ctx.health.records)
            .filter(([, r]) => r.status === "ok")
            .map(([id]) => id);
        if (picks.length === 0)
            return "No models with status=ok found. Run `router verify` first.";
    }
    else {
        picks = trimmed.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    }
    // Validate against registry.
    const valid = [];
    const invalid = [];
    for (const id of picks) {
        if (ctx.registry.byID.has(id))
            valid.push(id);
        else
            invalid.push(id);
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
function goalMatrixPreview(goal, ctx) {
    const row = GOAL_MATRIX[goal];
    const out = [];
    for (const c of ["low", "medium", "high"]) {
        const tier = row[c];
        const pool = modelsForTier(ctx.registry, tier);
        const sample = pool[0] ? `${pool[0].provider}/${pool[0].modelID}` : "(no model in tier — will escalate)";
        out.push(`  · ${c.padEnd(6)} → ${tier.padEnd(11)} → ${sample}`);
    }
    return out;
}
//# sourceMappingURL=routes.js.map