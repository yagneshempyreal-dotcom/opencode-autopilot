import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { triageScore } from "../../src/classifier/triage.js";
import type { ModelEntry, OpenCodeAuth } from "../../src/types.js";

interface TestServer { port: number; close: () => Promise<void>; setReply: (r: { status: number; body: string }) => void }

async function startTestServer(initial: { status: number; body: string }): Promise<TestServer> {
  let reply = initial;
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      res.statusCode = reply.status;
      res.setHeader("content-type", "application/json");
      res.end(reply.body);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  return {
    port: addr.port,
    close: () => new Promise<void>((r) => server.close(() => r())),
    setReply: (r) => { reply = r; },
  };
}

const auth: OpenCodeAuth = { p: { type: "api", key: "k" } };

describe("triageScore", () => {
  let s: TestServer;
  beforeAll(async () => {
    s = await startTestServer({ status: 200, body: "" });
  });
  afterAll(() => s.close());

  function buildModel(): ModelEntry {
    return {
      provider: "p",
      modelID: "tiny",
      tier: "free",
      ctxWindow: 32_000,
      supportsStreaming: true,
      apiShape: "openai",
      baseURL: `http://127.0.0.1:${s.port}/v1`,
    };
  }

  it("parses <score>2</score> as low", async () => {
    s.setReply({
      status: 200,
      body: JSON.stringify({ choices: [{ message: { content: "<score>2</score>" } }] }),
    });
    const r = await triageScore({ prompt: "fix typo", triageModel: buildModel(), auth });
    expect(r.tier).toBe("low");
    expect(r.confidence).toBeGreaterThan(0.7);
  });

  it("parses <score>5</score> as medium", async () => {
    s.setReply({
      status: 200,
      body: JSON.stringify({ choices: [{ message: { content: "<score>5</score>" } }] }),
    });
    const r = await triageScore({ prompt: "do something", triageModel: buildModel(), auth });
    expect(r.tier).toBe("medium");
  });

  it("parses <score>9</score> as high", async () => {
    s.setReply({
      status: 200,
      body: JSON.stringify({ choices: [{ message: { content: "<score>9</score>" } }] }),
    });
    const r = await triageScore({ prompt: "redesign system", triageModel: buildModel(), auth });
    expect(r.tier).toBe("high");
  });

  it("falls back to first integer in text", async () => {
    s.setReply({
      status: 200,
      body: JSON.stringify({ choices: [{ message: { content: "complexity 7 maybe" } }] }),
    });
    const r = await triageScore({ prompt: "x", triageModel: buildModel(), auth });
    expect(r.tier).toBe("high");
  });

  it("returns medium fallback on HTTP error", async () => {
    s.setReply({ status: 500, body: "{}" });
    const r = await triageScore({ prompt: "x", triageModel: buildModel(), auth });
    expect(r.tier).toBe("medium");
    expect(r.reason).toMatch(/HTTP 500/);
  });

  it("returns medium fallback when output unparseable", async () => {
    s.setReply({
      status: 200,
      body: JSON.stringify({ choices: [{ message: { content: "no number here" } }] }),
    });
    const r = await triageScore({ prompt: "x", triageModel: buildModel(), auth });
    expect(r.tier).toBe("medium");
  });

  it("skips triage when no auth and not opencode", async () => {
    const r = await triageScore({ prompt: "x", triageModel: buildModel(), auth: {} });
    expect(r.tier).toBe("medium");
    expect(r.reason).toMatch(/no auth/);
  });
});
