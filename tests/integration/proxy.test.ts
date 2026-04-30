import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, request as httpRequest, type Server } from "node:http";
import { startProxy, type ProxyServer } from "../../src/proxy/server.js";
import { ProxyEventBus, type ProxyContext } from "../../src/proxy/context.js";
import { buildRegistry } from "../../src/registry/index.js";
import { DEFAULT_CONFIG } from "../../src/config/store.js";
import { clearAllSessions, getSession } from "../../src/session/state.js";
import type { ModelEntry, OpenCodeAuth, AutopilotConfig } from "../../src/types.js";

interface MockServerOpts {
  failures?: number;
  status?: number;
  modelLabel?: string;
  finishReason?: string | null;
}

interface MockServer {
  port: number;
  close: () => Promise<void>;
  setOpts: (o: Partial<MockServerOpts>) => void;
  hits: number;
}

async function startMockProvider(initial: MockServerOpts): Promise<MockServer> {
  let opts: MockServerOpts = { failures: 0, status: 200, modelLabel: "mock", finishReason: "stop", ...initial };
  let hits = 0;
  const server: Server = createServer((req, res) => {
    hits++;
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      if ((opts.failures ?? 0) > 0) {
        opts.failures = (opts.failures ?? 0) - 1;
        res.statusCode = opts.status ?? 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: { message: "mock failure" } }));
        return;
      }
      const stream = req.url?.includes("anthropic") ? false : true;
      try {
        const parsed = JSON.parse(body) as { stream?: boolean; model?: string };
        const useStream = parsed.stream ?? stream;
        const label = opts.modelLabel ?? "mock";
        if (useStream) {
          res.statusCode = 200;
          res.setHeader("content-type", "text/event-stream");
          const chunk = JSON.stringify({
            id: "chatcmpl-mock",
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: parsed.model ?? "mock",
            choices: [{ index: 0, delta: { role: "assistant", content: `hello from ${label}` }, finish_reason: null }],
          });
          res.write(`data: ${chunk}\n\n`);
          const doneChunk = JSON.stringify({
            id: "chatcmpl-mock",
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: parsed.model ?? "mock",
            choices: [{ index: 0, delta: {}, finish_reason: opts.finishReason ?? "stop" }],
          });
          res.write(`data: ${doneChunk}\n\n`);
          const usageChunk = JSON.stringify({
            usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
          });
          res.write(`data: ${usageChunk}\n\n`);
          res.write(`data: [DONE]\n\n`);
          res.end();
        } else {
          res.statusCode = 200;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              id: "chatcmpl-mock",
              object: "chat.completion",
              choices: [{ index: 0, message: { role: "assistant", content: `hello from ${label}` }, finish_reason: opts.finishReason ?? "stop" }],
              usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
            }),
          );
        }
      } catch (err) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { message: (err as Error).message } }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  return {
    port: addr.port,
    close: () => new Promise<void>((r) => server.close(() => r())),
    setOpts: (o) => { opts = { ...opts, ...o }; },
    get hits() { return hits; },
  } as MockServer;
}

function buildContext(opts: {
  freeURL: string;
  cheapURL: string;
  topURL: string;
  config?: Partial<AutopilotConfig>;
}): { ctx: ProxyContext; auth: OpenCodeAuth } {
  const auth: OpenCodeAuth = {
    "mock-free": { type: "api", key: "free-key" },
    "mock-cheap": { type: "api", key: "cheap-key" },
    "mock-top": { type: "api", key: "top-key" },
  };
  const models: ModelEntry[] = [
    {
      provider: "mock-free",
      modelID: "tiny-free",
      tier: "free",
      ctxWindow: 100_000,
      supportsStreaming: true,
      apiShape: "openai",
      baseURL: opts.freeURL,
    },
    {
      provider: "mock-cheap",
      modelID: "small-paid",
      tier: "cheap-paid",
      ctxWindow: 100_000,
      supportsStreaming: true,
      apiShape: "openai",
      baseURL: opts.cheapURL,
    },
    {
      provider: "mock-top",
      modelID: "big-paid",
      tier: "top-paid",
      ctxWindow: 200_000,
      supportsStreaming: true,
      apiShape: "openai",
      baseURL: opts.topURL,
    },
  ];
  const registry = {
    models,
    byID: new Map(models.map((m) => [`${m.provider}/${m.modelID}`, m])),
    flagged: [],
  };
  let auto = true;
  const cfg: AutopilotConfig = {
    ...DEFAULT_CONFIG,
    goal: "balance",
    triage: { enabled: false },
    handover: { ...DEFAULT_CONFIG.handover, enabled: true },
    proxy: { host: "127.0.0.1", port: 0 },
    tiers: {
      free: ["mock-free/tiny-free"],
      "cheap-paid": ["mock-cheap/small-paid"],
      "top-paid": ["mock-top/big-paid"],
    },
    ...(opts.config ?? {}),
  };
  const ctx: ProxyContext = {
    config: cfg,
    registry,
    auth,
    triageModel: null,
    events: new ProxyEventBus(),
    autoEnabled: () => auto,
    setAutoEnabled: (v) => { auto = v; },
  };
  return { ctx, auth };
}

async function postChat(port: number, body: object, sessionID = "test-session"): Promise<{ status: number; text: string; lines: string[] }> {
  return httpPost(port, "/v1/chat/completions", JSON.stringify(body), { "x-session-id": sessionID });
}

function httpPost(port: number, path: string, body: string, extraHeaders: Record<string, string> = {}): Promise<{ status: number; text: string; lines: string[] }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      method: "POST",
      host: "127.0.0.1",
      port,
      path,
      agent: false,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
        connection: "close",
        ...extraHeaders,
      },
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { text += c; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text, lines: text.split("\n") }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function httpGet(port: number, path: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { method: "GET", host: "127.0.0.1", port, path, agent: false, headers: { connection: "close" } },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { text += c; });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("proxy integration", () => {
  let free: MockServer;
  let cheap: MockServer;
  let top: MockServer;
  let proxy: ProxyServer;
  let ctx: ProxyContext;

  beforeAll(async () => {
    free = await startMockProvider({ modelLabel: "free" });
    cheap = await startMockProvider({ modelLabel: "cheap" });
    top = await startMockProvider({ modelLabel: "top" });
    const built = buildContext({
      freeURL: `http://127.0.0.1:${free.port}/v1`,
      cheapURL: `http://127.0.0.1:${cheap.port}/v1`,
      topURL: `http://127.0.0.1:${top.port}/v1`,
    });
    ctx = built.ctx;
    proxy = await startProxy(ctx);
  });

  afterAll(async () => {
    await proxy?.close();
    await Promise.all([free.close(), cheap.close(), top.close()]);
  });

  beforeEach(() => {
    clearAllSessions();
    free.setOpts({ failures: 0, status: 200, finishReason: "stop" });
    cheap.setOpts({ failures: 0, status: 200, finishReason: "stop" });
    top.setOpts({ failures: 0, status: 200, finishReason: "stop" });
    ctx.setAutoEnabled(true);
  });

  it("routes a low/balance prompt to a free model", async () => {
    const before = free.hits;
    const r = await postChat(proxy.port, {
      model: "auto",
      stream: true,
      messages: [{ role: "user", content: "fix typo" }],
    });
    expect(r.status).toBe(200);
    expect(free.hits).toBe(before + 1);
    expect(r.text).toContain("hello from free");
    expect(r.text).toMatch(/router → free/);
  });

  it("routes a high prompt to top-paid", async () => {
    const before = top.hits;
    await postChat(proxy.port, {
      model: "auto",
      stream: true,
      messages: [{
        role: "user",
        content: "Please refactor the entire monolithic auth service into microservices, addressing concurrency and scalability concerns. The architecture must support horizontal scaling.",
      }],
    });
    expect(top.hits).toBe(before + 1);
  });

  it("escalates when free tier all fails", async () => {
    free.setOpts({ failures: 5, status: 429 });
    const beforeCheap = cheap.hits;
    const r = await postChat(proxy.port, {
      model: "auto",
      stream: true,
      messages: [{ role: "user", content: "fix typo" }],
    });
    expect(r.status).toBe(200);
    expect(cheap.hits).toBe(beforeCheap + 1);
    expect(r.text).toContain("hello from cheap");
  });

  it("continues automatically when upstream hits finish_reason=length", async () => {
    // Simulate a GPT-style truncation (max_tokens hit).
    free.setOpts({ finishReason: "length" });
    const beforeCheap = cheap.hits;
    const r = await postChat(proxy.port, {
      model: "auto",
      stream: true,
      messages: [{ role: "user", content: "write a long answer" }],
    });
    expect(r.status).toBe(200);
    // The proxy should have performed at least one continuation hop, which
    // forces it to avoid the truncating model and pick another candidate.
    expect(cheap.hits).toBeGreaterThan(beforeCheap);
    expect(r.text).toContain("hello from free");
    expect(r.text).toContain("hello from cheap");
  });

  it("respects sticky upgrade across two prompts", async () => {
    await postChat(proxy.port, {
      model: "auto",
      stream: true,
      messages: [{ role: "user", content: "fix typo" }],
    }, "stickysess");
    expect(getSession("stickysess").stickyFloor).toBeNull();

    const beforeCheap = cheap.hits;
    await postChat(proxy.port, {
      model: "auto",
      stream: true,
      messages: [{ role: "user", content: "this is wrong, try again" }],
    }, "stickysess");
    expect(getSession("stickysess").stickyFloor).not.toBeNull();
    expect(cheap.hits).toBeGreaterThan(beforeCheap);
  });

  it("inline @model override picks that model", async () => {
    const beforeTop = top.hits;
    await postChat(proxy.port, {
      model: "auto",
      stream: true,
      messages: [{ role: "user", content: "@mock-top/big-paid please answer" }],
    });
    expect(top.hits).toBe(beforeTop + 1);
  });

  it("rejects requests when /auto off", async () => {
    await postChat(proxy.port, {
      model: "auto",
      stream: false,
      messages: [{ role: "user", content: "/auto off" }],
    });
    const r = await postChat(proxy.port, {
      model: "auto",
      stream: false,
      messages: [{ role: "user", content: "hello" }],
    });
    expect(r.status).toBe(503);
    await postChat(proxy.port, {
      model: "auto",
      stream: false,
      messages: [{ role: "user", content: "/auto on" }],
    });
  });

  it("non-streaming response also gets badge prepended", async () => {
    const r = await postChat(proxy.port, {
      model: "auto",
      stream: false,
      messages: [{ role: "user", content: "fix typo" }],
    });
    expect(r.status).toBe(200);
    const parsed = JSON.parse(r.text);
    expect(parsed.choices[0].message.content).toMatch(/router → free/);
    expect(parsed.choices[0].message.content).toContain("hello from free");
  });

  it("/health returns ok", async () => {
    const res = await httpGet(proxy.port, "/health");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text).ok).toBe(true);
  });

  it("/v1/models lists auto", async () => {
    const res = await httpGet(proxy.port, "/v1/models");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text).data[0].id).toBe("auto");
  });

  it("returns 400 on malformed body", async () => {
    const res = await httpPost(proxy.port, "/v1/chat/completions", "not json");
    expect(res.status).toBe(400);
  });

  it("emits route + sticky-bump events", async () => {
    const events: string[] = [];
    ctx.events.on((e) => events.push(e.type));
    await postChat(proxy.port, {
      model: "auto",
      stream: true,
      messages: [{ role: "user", content: "this is wrong, try again" }],
    }, "evt-sess");
    expect(events).toContain("route");
    expect(events).toContain("sticky-bump");
  });
});
