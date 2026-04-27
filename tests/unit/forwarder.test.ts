import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { forwardOpenAICompat } from "../../src/forwarder/openai.js";
import { forwardAnthropic } from "../../src/forwarder/anthropic.js";
import { ForwardError } from "../../src/forwarder/types.js";
import type { ModelEntry, OpenCodeAuth } from "../../src/types.js";

interface TestServer { port: number; close: () => Promise<void>; lastReq: { headers: Record<string, string | string[] | undefined>; body: string } | null }

async function startEcho(handler: (body: string, headers: Record<string, string | string[] | undefined>) => { status: number; body: string; headers?: Record<string, string> }): Promise<TestServer> {
  let lastReq: TestServer["lastReq"] = null;
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      lastReq = { headers: req.headers, body };
      const r = handler(body, req.headers);
      res.statusCode = r.status;
      for (const [k, v] of Object.entries(r.headers ?? { "content-type": "application/json" })) res.setHeader(k, v);
      res.end(r.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  return {
    port: addr.port,
    close: () => new Promise<void>((r) => server.close(() => r())),
    get lastReq() { return lastReq; },
  } as TestServer;
}

describe("forwardOpenAICompat", () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startEcho(() => ({
      status: 200,
      body: JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
    }));
  });
  afterAll(() => server.close());

  const auth: OpenCodeAuth = { testp: { type: "api", key: "sk-x" } };

  it("forwards and uses bearer token", async () => {
    const model: ModelEntry = {
      provider: "testp",
      modelID: "test-model",
      tier: "free",
      ctxWindow: 32_000,
      supportsStreaming: true,
      apiShape: "openai",
      baseURL: `http://127.0.0.1:${server.port}/v1`,
    };
    const res = await forwardOpenAICompat({
      request: { model: "auto", messages: [{ role: "user", content: "hi" }] },
      model,
      auth,
    });
    expect(res.status).toBe(200);
    expect(server.lastReq?.headers.authorization).toBe("Bearer sk-x");
    const sentBody = JSON.parse(server.lastReq?.body ?? "{}");
    expect(sentBody.model).toBe("test-model");
  });

  it("throws ForwardError with retriable=true on 429", async () => {
    const failServer = await startEcho(() => ({ status: 429, body: JSON.stringify({ error: "rate" }) }));
    try {
      const model: ModelEntry = {
        provider: "testp",
        modelID: "x",
        tier: "free",
        ctxWindow: 32_000,
        supportsStreaming: true,
        apiShape: "openai",
        baseURL: `http://127.0.0.1:${failServer.port}/v1`,
      };
      await expect(
        forwardOpenAICompat({
          request: { model: "auto", messages: [{ role: "user", content: "hi" }] },
          model,
          auth,
        }),
      ).rejects.toMatchObject({ status: 429, retriable: true });
    } finally {
      await failServer.close();
    }
  });

  it("throws ForwardError(401) when no credentials and provider is not opencode", async () => {
    const model: ModelEntry = {
      provider: "testp",
      modelID: "x",
      tier: "free",
      ctxWindow: 32_000,
      supportsStreaming: true,
      apiShape: "openai",
      baseURL: `http://127.0.0.1:${server.port}/v1`,
    };
    await expect(
      forwardOpenAICompat({
        request: { model: "auto", messages: [{ role: "user", content: "hi" }] },
        model,
        auth: {},
      }),
    ).rejects.toBeInstanceOf(ForwardError);
  });
});

describe("forwardAnthropic", () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startEcho(() => ({
      status: 200,
      body: JSON.stringify({ content: [{ type: "text", text: "hi" }] }),
    }));
  });
  afterAll(() => server.close());

  it("uses x-api-key header for api type, sends system separately", async () => {
    const auth: OpenCodeAuth = { anthropic: { type: "api", key: "sk-ant-1" } };
    const model: ModelEntry = {
      provider: "anthropic",
      modelID: "claude-haiku-4-5",
      tier: "cheap-paid",
      ctxWindow: 200_000,
      supportsStreaming: true,
      apiShape: "anthropic",
      baseURL: `http://127.0.0.1:${server.port}/v1`,
    };
    const res = await forwardAnthropic({
      request: {
        model: "auto",
        messages: [
          { role: "system", content: "Be helpful." },
          { role: "user", content: "hi" },
        ],
      },
      model,
      auth,
    });
    expect(res.status).toBe(200);
    expect(server.lastReq?.headers["x-api-key"]).toBe("sk-ant-1");
    const sent = JSON.parse(server.lastReq?.body ?? "{}");
    expect(sent.system).toContain("Be helpful");
    expect(sent.messages[0].role).toBe("user");
    expect(sent.model).toBe("claude-haiku-4-5");
    expect(sent.max_tokens).toBeGreaterThan(0);
  });

  it("uses Authorization Bearer when oauth", async () => {
    const auth: OpenCodeAuth = {
      anthropic: { type: "oauth", access: "tok-abc", refresh: "r", expires: Date.now() + 3600 * 1000 },
    };
    const model: ModelEntry = {
      provider: "anthropic",
      modelID: "claude-haiku-4-5",
      tier: "cheap-paid",
      ctxWindow: 200_000,
      supportsStreaming: true,
      apiShape: "anthropic",
      baseURL: `http://127.0.0.1:${server.port}/v1`,
    };
    await forwardAnthropic({
      request: { model: "auto", messages: [{ role: "user", content: "hi" }] },
      model,
      auth,
    });
    expect(server.lastReq?.headers.authorization).toBe("Bearer tok-abc");
  });
});
