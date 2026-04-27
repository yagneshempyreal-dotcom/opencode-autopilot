import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server, request as httpRequest } from "node:http";
import { startProxy, type ProxyServer } from "../../src/proxy/server.js";
import { ProxyEventBus, type ProxyContext } from "../../src/proxy/context.js";
import { DEFAULT_CONFIG } from "../../src/config/store.js";
import type { AutopilotConfig, ModelEntry, OpenCodeAuth } from "../../src/types.js";

interface MockServer { port: number; close: () => Promise<void> }

async function startInvalidJSONServer(): Promise<MockServer> {
  // Returns content-type=application/json but body is not valid JSON.
  const server: Server = createServer((_req, res) => {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end("not actually json {{{");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  return { port: addr.port, close: () => new Promise<void>((r) => server.close(() => r())) };
}

function httpPost(port: number, path: string, body: string, extraHeaders: Record<string, string> = {}): Promise<{ status: number; text: string }> {
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
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function startNoContent(): Promise<MockServer> {
  const server: Server = createServer((_req, res) => {
    res.statusCode = 204;
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  return { port: addr.port, close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe("proxy 204-no-body upstream path", () => {
  let upstream: MockServer;
  let proxy: ProxyServer;

  beforeAll(async () => {
    upstream = await startNoContent();
    const auth: OpenCodeAuth = { p: { type: "api", key: "k" } };
    const baseURL = `http://127.0.0.1:${upstream.port}/v1`;
    const model: ModelEntry = {
      provider: "p", modelID: "m", tier: "free", ctxWindow: 32_000,
      supportsStreaming: true, apiShape: "openai", baseURL,
    };
    let auto = true;
    const cfg: AutopilotConfig = {
      ...DEFAULT_CONFIG, goal: "balance",
      triage: { enabled: false },
      proxy: { host: "127.0.0.1", port: 0 },
    };
    const ctx: ProxyContext = {
      config: cfg,
      registry: { models: [model], byID: new Map([[`${model.provider}/${model.modelID}`, model]]), flagged: [] },
      auth,
      triageModel: null,
      events: new ProxyEventBus(),
      autoEnabled: () => auto,
      setAutoEnabled: (v) => { auto = v; },
    };
    proxy = await startProxy(ctx);
  });

  afterAll(async () => {
    await proxy?.close();
    await upstream.close();
  });

  it("returns 204 with empty body when upstream sends no content", async () => {
    const r = await httpPost(proxy.port, "/v1/chat/completions", JSON.stringify({
      model: "auto", stream: false, messages: [{ role: "user", content: "fix typo" }],
    }));
    expect(r.status).toBe(204);
    expect(r.text).toBe("");
  });
});

describe("proxy badge prepend on malformed JSON upstream", () => {
  let upstream: MockServer;
  let proxy: ProxyServer;

  beforeAll(async () => {
    upstream = await startInvalidJSONServer();
    const auth: OpenCodeAuth = { p: { type: "api", key: "k" } };
    const baseURL = `http://127.0.0.1:${upstream.port}/v1`;
    const model: ModelEntry = {
      provider: "p",
      modelID: "m",
      tier: "free",
      ctxWindow: 32_000,
      supportsStreaming: true,
      apiShape: "openai",
      baseURL,
    };
    let auto = true;
    const cfg: AutopilotConfig = {
      ...DEFAULT_CONFIG,
      goal: "balance",
      triage: { enabled: false },
      proxy: { host: "127.0.0.1", port: 0 },
    };
    const ctx: ProxyContext = {
      config: cfg,
      registry: { models: [model], byID: new Map([[`${model.provider}/${model.modelID}`, model]]), flagged: [] },
      auth,
      triageModel: null,
      events: new ProxyEventBus(),
      autoEnabled: () => auto,
      setAutoEnabled: (v) => { auto = v; },
    };
    proxy = await startProxy(ctx);
  });

  afterAll(async () => {
    await proxy?.close();
    await upstream.close();
  });

  it("passes through unparseable JSON body without crashing (badge prepend catch)", async () => {
    const r = await httpPost(proxy.port, "/v1/chat/completions", JSON.stringify({
      model: "auto",
      stream: false,
      messages: [{ role: "user", content: "fix typo" }],
    }));
    expect(r.status).toBe(200);
    expect(r.text).toBe("not actually json {{{");
  });
});
