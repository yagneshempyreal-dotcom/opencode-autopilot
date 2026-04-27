import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateHandover } from "../../src/handover/generator.js";
import type { ModelEntry, OpenCodeAuth } from "../../src/types.js";

interface SummarySrv { port: number; close: () => Promise<void>; setReply: (s: { status: number; body: string }) => void }

async function startSummary(initial: { status: number; body: string }): Promise<SummarySrv> {
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
    setReply: (s) => { reply = s; },
  };
}

const auth: OpenCodeAuth = { p: { type: "api", key: "k" } };

function summaryModel(port: number): ModelEntry {
  return {
    provider: "p",
    modelID: "summarizer",
    tier: "cheap-paid",
    ctxWindow: 100_000,
    supportsStreaming: true,
    apiShape: "openai",
    baseURL: `http://127.0.0.1:${port}/v1`,
  };
}

describe("handover with summary model (LLM)", () => {
  let srv: SummarySrv;
  let tmpDir: string;
  let savedEnv: string | undefined;

  beforeAll(async () => {
    srv = await startSummary({ status: 200, body: "" });
  });
  afterAll(() => srv.close());

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "autopilot-sum-"));
    savedEnv = process.env.OPENCODE_AUTOPILOT_HANDOVER_DIR;
    process.env.OPENCODE_AUTOPILOT_HANDOVER_DIR = tmpDir;
  });

  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.OPENCODE_AUTOPILOT_HANDOVER_DIR;
    else process.env.OPENCODE_AUTOPILOT_HANDOVER_DIR = savedEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("uses LLM summary when summaryModel set and call succeeds", async () => {
    srv.setReply({
      status: 200,
      body: JSON.stringify({
        choices: [{
          message: {
            content: "## Decisions made\n- chose X\n\n## Files touched\n- src/foo.ts — refactored\n\n## Current state\nAll done.\n\n## Open todos\n- [x] tests\n\n## Key context\n> done",
          },
        }],
      }),
    });
    const result = await generateHandover({
      session: { sessionID: "s-summary", stickyFloor: null, tokensIn: 100, tokensOut: 50, promptCount: 3, archived: false },
      transcript: [
        { role: "user", content: "build feature X" },
        { role: "assistant", content: "let me start" },
      ],
      ctxAtSave: 50_000,
      ctxWindow: 100_000,
      goal: "balance",
      summaryModel: summaryModel(srv.port),
      auth,
      emergency: false,
    });
    const md = await readFile(result.path, "utf8");
    expect(md).toContain("Decisions made");
    expect(md).toContain("chose X");
    expect(md).toContain("src/foo.ts");
  });

  it("falls back to emergency dump when LLM call fails (5xx)", async () => {
    srv.setReply({ status: 500, body: "{}" });
    const result = await generateHandover({
      session: { sessionID: "s-fail", stickyFloor: null, tokensIn: 100, tokensOut: 50, promptCount: 3, archived: false },
      transcript: [{ role: "user", content: "task X" }],
      ctxAtSave: 80_000,
      ctxWindow: 100_000,
      goal: "balance",
      summaryModel: summaryModel(srv.port),
      auth,
      emergency: false,
    });
    const md = await readFile(result.path, "utf8");
    expect(md).toContain("Recent transcript");
    expect(md).toContain("task X");
  });

  it("returns empty summary section when summary model has no auth and is not opencode", async () => {
    const result = await generateHandover({
      session: { sessionID: "s-noauth", stickyFloor: null, tokensIn: 0, tokensOut: 0, promptCount: 0, archived: false },
      transcript: [{ role: "user", content: "x" }],
      ctxAtSave: 100,
      ctxWindow: 1000,
      goal: "balance",
      summaryModel: summaryModel(srv.port),
      auth: {},
      emergency: false,
    });
    const md = await readFile(result.path, "utf8");
    expect(md).toContain("Recent transcript");
  });

  it("returns empty when summaryModel has no baseURL", async () => {
    const noBase: ModelEntry = { ...summaryModel(srv.port) };
    delete noBase.baseURL;
    const result = await generateHandover({
      session: { sessionID: "s-nobase", stickyFloor: null, tokensIn: 0, tokensOut: 0, promptCount: 0, archived: false },
      transcript: [{ role: "user", content: "x" }],
      ctxAtSave: 100,
      ctxWindow: 1000,
      goal: "balance",
      summaryModel: noBase,
      auth,
      emergency: false,
    });
    const md = await readFile(result.path, "utf8");
    expect(md).toContain("Recent transcript");
  });
});
