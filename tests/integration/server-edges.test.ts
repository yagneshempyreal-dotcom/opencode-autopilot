import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server, request as httpRequest } from "node:http";
import { startProxy, type ProxyServer } from "../../src/proxy/server.js";
import { ProxyEventBus, type ProxyContext } from "../../src/proxy/context.js";
import { DEFAULT_CONFIG } from "../../src/config/store.js";
import type { AutopilotConfig, ModelEntry, OpenCodeAuth } from "../../src/types.js";

function buildCtx(): ProxyContext {
  const auth: OpenCodeAuth = { p: { type: "api", key: "k" } };
  const models: ModelEntry[] = [{
    provider: "p", modelID: "m", tier: "free", ctxWindow: 32_000,
    supportsStreaming: true, apiShape: "openai", baseURL: "http://127.0.0.1:1/v1",
  }];
  let auto = true;
  const cfg: AutopilotConfig = {
    ...DEFAULT_CONFIG,
    triage: { enabled: false },
    proxy: { host: "127.0.0.1", port: 0 },
  };
  return {
    config: cfg,
    registry: { models, byID: new Map(models.map((m) => [`${m.provider}/${m.modelID}`, m])), flagged: [] },
    auth,
    triageModel: null,
    events: new ProxyEventBus(),
    autoEnabled: () => auto,
    setAutoEnabled: (v) => { auto = v; },
  };
}

function rawGet(port: number, path: string, method = "GET"): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ method, host: "127.0.0.1", port, path, agent: false, headers: { connection: "close" } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { text += c; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

describe("proxy server edges", () => {
  let proxy: ProxyServer;
  beforeAll(async () => { proxy = await startProxy(buildCtx()); });
  afterAll(async () => { await proxy.close(); });

  it("returns 404 for unknown GET path", async () => {
    const r = await rawGet(proxy.port, "/nope");
    expect(r.status).toBe(404);
  });

  it("returns 404 for non-POST chat completions", async () => {
    const r = await rawGet(proxy.port, "/v1/chat/completions");
    expect(r.status).toBe(404);
  });

  it("/v1/models returns list", async () => {
    const r = await rawGet(proxy.port, "/v1/models");
    expect(r.status).toBe(200);
    const json = JSON.parse(r.text);
    expect(json.data[0].id).toBe("auto");
  });

  it("port collision: pre-bind a port, request that port, proxy moves to next", async () => {
    const blocker: Server = createServer();
    await new Promise<void>((r) => blocker.listen(45123, "127.0.0.1", () => r()));
    try {
      const ctx = buildCtx();
      ctx.config.proxy.port = 45123;
      const px = await startProxy(ctx);
      try {
        expect(px.port).toBeGreaterThan(45123);
        const r = await rawGet(px.port, "/health");
        expect(r.status).toBe(200);
      } finally {
        await px.close();
      }
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()));
    }
  });
});
