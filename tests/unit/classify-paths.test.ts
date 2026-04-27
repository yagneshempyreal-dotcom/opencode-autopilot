import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { classify } from "../../src/classifier/index.js";
import type { ChatMessage, ModelEntry, OpenCodeAuth } from "../../src/types.js";

interface TestServer { port: number; close: () => Promise<void> }

async function startTriageMock(score: number): Promise<TestServer> {
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: `<score>${score}</score>` } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  return { port: addr.port, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const ambiguousMessages: ChatMessage[] = [
  { role: "user", content: "I'd like to know more about how this part of the system actually works in practice." },
];

describe("classify decision branches", () => {
  let triageSrv: TestServer;
  beforeAll(async () => {
    triageSrv = await startTriageMock(8);
  });
  afterAll(() => triageSrv.close());

  function model(): ModelEntry {
    return {
      provider: "p",
      modelID: "tiny",
      tier: "free",
      ctxWindow: 32_000,
      supportsStreaming: true,
      apiShape: "openai",
      baseURL: `http://127.0.0.1:${triageSrv.port}/v1`,
    };
  }

  const auth: OpenCodeAuth = { p: { type: "api", key: "k" } };

  it("returns heuristic when confidence already high", async () => {
    const r = await classify({
      messages: [{ role: "user", content: "fix typo" }],
      goal: "balance",
      triageEnabled: true,
      triageModel: model(),
      auth,
    });
    expect(r.tier).toBe("low");
    expect(r.reason).not.toContain("triage");
  });

  it("returns heuristic when goal=quality even if confidence low", async () => {
    const r = await classify({
      messages: ambiguousMessages,
      goal: "quality",
      triageEnabled: true,
      triageModel: model(),
      auth,
    });
    expect(r.reason).not.toContain("triage");
  });

  it("returns heuristic when triageEnabled=false", async () => {
    const r = await classify({
      messages: ambiguousMessages,
      goal: "balance",
      triageEnabled: false,
      triageModel: model(),
      auth,
    });
    expect(r.reason).not.toContain("triage");
  });

  it("returns heuristic when triageModel=null", async () => {
    const r = await classify({
      messages: ambiguousMessages,
      goal: "balance",
      triageEnabled: true,
      triageModel: null,
      auth,
    });
    expect(r.reason).not.toContain("triage");
  });

  it("returns heuristic when prompt is very short (<20 chars)", async () => {
    const r = await classify({
      messages: [{ role: "user", content: "hmm?" }],
      goal: "balance",
      triageEnabled: true,
      triageModel: model(),
      auth,
    });
    expect(r.reason).not.toContain("triage");
  });

  it("calls triage when ambiguous and conditions met", async () => {
    const r = await classify({
      messages: ambiguousMessages,
      goal: "balance",
      triageEnabled: true,
      triageModel: model(),
      auth,
    });
    expect(r.reason).toMatch(/triage/);
    expect(r.tier).toBe("high");
  });

  it("respects custom confidenceFloor (high floor → triage)", async () => {
    const r = await classify({
      messages: [{ role: "user", content: "fix the typo somewhere in the README please" }],
      goal: "balance",
      triageEnabled: true,
      triageModel: model(),
      auth,
      confidenceFloor: 0.99,
    });
    expect(r.reason).toMatch(/triage/);
  });
});
