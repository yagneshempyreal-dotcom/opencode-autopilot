import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, request as httpRequest, type Server } from "node:http";
import { startProxy, type ProxyServer } from "../../src/proxy/server.js";
import { ProxyEventBus, type ProxyContext } from "../../src/proxy/context.js";
import { DEFAULT_CONFIG } from "../../src/config/store.js";
import { clearAllSessions } from "../../src/session/state.js";
import type { ModelEntry, OpenCodeAuth, AutopilotConfig } from "../../src/types.js";

interface MockServer { port: number; close: () => Promise<void> }

async function alwaysFail(status: number): Promise<MockServer> {
  const server: Server = createServer((_req, res) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: { message: "always fail" } }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  return {
    port: addr.port,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
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

describe("proxy edge cases", () => {
  let allFail: MockServer;
  let proxy: ProxyServer;
  let ctx: ProxyContext;

  beforeAll(async () => {
    allFail = await alwaysFail(503);
    const auth: OpenCodeAuth = {
      "p-fail": { type: "api", key: "fail-key" },
    };
    const baseURL = `http://127.0.0.1:${allFail.port}/v1`;
    const models: ModelEntry[] = [
      {
        provider: "p-fail",
        modelID: "tiny-free",
        tier: "free",
        ctxWindow: 100_000,
        supportsStreaming: true,
        apiShape: "openai",
        baseURL,
      },
      {
        provider: "p-fail",
        modelID: "small-paid",
        tier: "cheap-paid",
        ctxWindow: 100_000,
        supportsStreaming: true,
        apiShape: "openai",
        baseURL,
      },
      {
        provider: "p-fail",
        modelID: "big-paid",
        tier: "top-paid",
        ctxWindow: 200_000,
        supportsStreaming: true,
        apiShape: "openai",
        baseURL,
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
      proxy: { host: "127.0.0.1", port: 0 },
    };
    ctx = {
      config: cfg,
      registry,
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
    await allFail.close();
  });

  beforeEach(() => {
    clearAllSessions();
  });

  it("returns 502 when every tier fails", async () => {
    const r = await httpPost(proxy.port, "/v1/chat/completions", JSON.stringify({
      model: "auto",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
    }));
    expect(r.status).toBe(502);
  });

  it("returns 400 on missing messages", async () => {
    const r = await httpPost(proxy.port, "/v1/chat/completions", JSON.stringify({ model: "auto" }));
    expect(r.status).toBe(400);
  });

  it("returns 400 on empty messages array", async () => {
    const r = await httpPost(proxy.port, "/v1/chat/completions", JSON.stringify({ model: "auto", messages: [] }));
    expect(r.status).toBe(400);
  });

  it("returns 404 for unknown route", async () => {
    const r = await httpPost(proxy.port, "/v1/nonexistent", JSON.stringify({}));
    expect(r.status).toBe(404);
  });

  it("returns 503 when no model fits ctx window (registry mocked at runtime)", async () => {
    const tinyOnly: ModelEntry[] = [
      {
        provider: "p-fail",
        modelID: "tiny",
        tier: "free",
        ctxWindow: 2_000,
        supportsStreaming: true,
        apiShape: "openai",
        baseURL: `http://127.0.0.1:${allFail.port}/v1`,
      },
    ];
    const savedRegistry = ctx.registry;
    ctx.registry = {
      models: tinyOnly,
      byID: new Map(tinyOnly.map((m) => [`${m.provider}/${m.modelID}`, m])),
      flagged: [],
    };
    try {
      const longContent = "lorem ipsum dolor sit amet ".repeat(800);
      const r = await httpPost(proxy.port, "/v1/chat/completions", JSON.stringify({
        model: "auto",
        messages: [{ role: "user", content: longContent }],
        stream: false,
      }));
      expect(r.status).toBe(503);
    } finally {
      ctx.registry = savedRegistry;
    }
  }, 15_000);
});

import { beforeEach } from "vitest";
