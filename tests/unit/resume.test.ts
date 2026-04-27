import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listHandovers, getLastHandover, readHandoverDoc } from "../../src/handover/resume.js";

describe("handover resume listing", () => {
  let tmpDir: string;
  let saved: string | undefined;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "autopilot-resume-"));
    saved = process.env.OPENCODE_AUTOPILOT_HANDOVER_DIR;
    process.env.OPENCODE_AUTOPILOT_HANDOVER_DIR = tmpDir;
  });

  afterEach(async () => {
    if (saved === undefined) delete process.env.OPENCODE_AUTOPILOT_HANDOVER_DIR;
    else process.env.OPENCODE_AUTOPILOT_HANDOVER_DIR = saved;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty list when no index and no files", async () => {
    expect(await listHandovers()).toEqual([]);
    expect(await getLastHandover()).toBeNull();
  });

  it("scans .md files when index missing", async () => {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(join(tmpDir, "2026-04-27T10-00-00-000Z-s-X.md"), "# Session Handover\n## Goal\nDo task X\n");
    const list = await listHandovers();
    expect(list.length).toBe(1);
    expect(list[0]?.goalOneliner).toContain("Do task X");
  });

  it("reads from INDEX.jsonl when present", async () => {
    await mkdir(tmpDir, { recursive: true });
    const idx = join(tmpDir, "INDEX.jsonl");
    await appendFile(idx, JSON.stringify({
      ts: "2026-04-27T10:00:00Z",
      sessionID: "s-A",
      path: "/x/a.md",
      goalOneliner: "task A",
      ctxAtSave: 100, ctxWindow: 1000,
      stickyFloor: null, goal: "balance", emergency: false,
    }) + "\n");
    await appendFile(idx, JSON.stringify({
      ts: "2026-04-27T11:00:00Z",
      sessionID: "s-B",
      path: "/x/b.md",
      goalOneliner: "task B",
      ctxAtSave: 200, ctxWindow: 1000,
      stickyFloor: "free", goal: "cost", emergency: true,
    }) + "\n");
    const list = await listHandovers();
    expect(list).toHaveLength(2);
    expect(list[0]?.sessionID).toBe("s-B");
    expect(list[1]?.sessionID).toBe("s-A");
  });

  it("ignores corrupted lines in index", async () => {
    await mkdir(tmpDir, { recursive: true });
    await appendFile(join(tmpDir, "INDEX.jsonl"), "this is not json\n" +
      JSON.stringify({ ts: "x", sessionID: "ok", path: "/p", goalOneliner: "g", ctxAtSave: 0, ctxWindow: 0, stickyFloor: null, goal: "g", emergency: false }) + "\n");
    const list = await listHandovers();
    expect(list).toHaveLength(1);
    expect(list[0]?.sessionID).toBe("ok");
  });

  it("readHandoverDoc returns file content", async () => {
    await mkdir(tmpDir, { recursive: true });
    const path = join(tmpDir, "doc.md");
    await writeFile(path, "hello");
    expect(await readHandoverDoc(path)).toBe("hello");
  });
});
