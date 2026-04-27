import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateHandover, handoverIndexPath } from "../../src/handover/generator.js";
import { listHandovers, getLastHandover } from "../../src/handover/resume.js";

describe("generateHandover", () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "autopilot-handover-"));
    originalEnv = process.env.OPENCODE_AUTOPILOT_HANDOVER_DIR;
    process.env.OPENCODE_AUTOPILOT_HANDOVER_DIR = tmpDir;
  });

  afterEach(async () => {
    if (originalEnv === undefined) delete process.env.OPENCODE_AUTOPILOT_HANDOVER_DIR;
    else process.env.OPENCODE_AUTOPILOT_HANDOVER_DIR = originalEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes a markdown handover and appends to INDEX.jsonl", async () => {
    const result = await generateHandover({
      session: {
        sessionID: "s-test-1",
        stickyFloor: "cheap-paid",
        tokensIn: 12345,
        tokensOut: 6789,
        promptCount: 8,
        archived: false,
        lastModel: "openai/gpt-5.4-mini",
      },
      transcript: [
        { role: "system", content: "be helpful" },
        { role: "user", content: "Refactor /src/foo.ts to use async/await throughout" },
        { role: "assistant", content: "I'll start by reading /src/foo.ts" },
        { role: "user", content: "Yes please proceed" },
        { role: "assistant", content: "Done. The file /src/foo.ts now uses async/await." },
      ],
      ctxAtSave: 80_000,
      ctxWindow: 100_000,
      goal: "balance",
      summaryModel: null,
      auth: {},
      emergency: true,
    });

    expect(result.path.startsWith(tmpDir)).toBe(true);
    expect(result.path).toMatch(/s-test-1\.md$/);
    expect(result.ctxUtilization).toBeCloseTo(0.8, 2);

    const md = await readFile(result.path, "utf8");
    expect(md).toContain("# Session Handover — s-test-1");
    expect(md).toContain("Refactor /src/foo.ts");
    expect(md).toContain("/src/foo.ts");
    expect(md).toContain("Sticky floor at handover: cheap-paid");
    expect(md).toContain("Emergency mode: true");
    expect(md).toContain("Recent transcript");

    const idx = await readFile(handoverIndexPath(), "utf8");
    expect(idx).toContain("s-test-1");
  });

  it("falls back to emergency dump when summary model is null and not emergency", async () => {
    const result = await generateHandover({
      session: {
        sessionID: "s-no-summary",
        stickyFloor: null,
        tokensIn: 1000,
        tokensOut: 500,
        promptCount: 1,
        archived: false,
      },
      transcript: [{ role: "user", content: "hello world" }],
      ctxAtSave: 8000,
      ctxWindow: 10_000,
      goal: "cost",
      summaryModel: null,
      auth: {},
      emergency: false,
    });
    const md = await readFile(result.path, "utf8");
    expect(md).toContain("Recent transcript");
    expect(md).toContain("hello world");
  });

  it("listHandovers returns entries from index", async () => {
    await generateHandover({
      session: { sessionID: "s-a", stickyFloor: null, tokensIn: 0, tokensOut: 0, promptCount: 0, archived: false },
      transcript: [{ role: "user", content: "task A" }],
      ctxAtSave: 100,
      ctxWindow: 1000,
      goal: "balance",
      summaryModel: null,
      auth: {},
      emergency: true,
    });
    await new Promise((r) => setTimeout(r, 5));
    await generateHandover({
      session: { sessionID: "s-b", stickyFloor: null, tokensIn: 0, tokensOut: 0, promptCount: 0, archived: false },
      transcript: [{ role: "user", content: "task B" }],
      ctxAtSave: 200,
      ctxWindow: 1000,
      goal: "balance",
      summaryModel: null,
      auth: {},
      emergency: true,
    });
    const list = await listHandovers();
    expect(list).toHaveLength(2);
    expect(list[0]?.sessionID).toBe("s-b");
    expect(list[1]?.sessionID).toBe("s-a");

    const last = await getLastHandover();
    expect(last?.sessionID).toBe("s-b");
  });
});
