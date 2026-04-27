import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, chmod } from "node:fs/promises";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import { listHandovers } from "../../src/handover/resume.js";
import { loadConfig } from "../../src/config/store.js";
import { loadAuth } from "../../src/config/auth.js";

describe("filesystem error paths", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "autopilot-err-"));
  });

  afterEach(async () => {
    try { await chmod(tmpDir, 0o755); } catch { /* */ }
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("listHandovers returns empty when handover dir does not exist and index missing", async () => {
    const old = process.env.OPENCODE_AUTOPILOT_HANDOVER_DIR;
    process.env.OPENCODE_AUTOPILOT_HANDOVER_DIR = join(tmpDir, "does-not-exist");
    try {
      const list = await listHandovers();
      expect(list).toEqual([]);
    } finally {
      if (old === undefined) delete process.env.OPENCODE_AUTOPILOT_HANDOVER_DIR;
      else process.env.OPENCODE_AUTOPILOT_HANDOVER_DIR = old;
    }
  });

  it("listHandovers re-throws non-ENOENT readFile errors (e.g. directory passed as path)", async () => {
    const old = process.env.OPENCODE_AUTOPILOT_HANDOVER_DIR;
    process.env.OPENCODE_AUTOPILOT_HANDOVER_DIR = tmpDir;
    try {
      await mkdir(join(tmpDir, "INDEX.jsonl"), { recursive: true });
      await expect(listHandovers()).rejects.toBeDefined();
    } finally {
      if (old === undefined) delete process.env.OPENCODE_AUTOPILOT_HANDOVER_DIR;
      else process.env.OPENCODE_AUTOPILOT_HANDOVER_DIR = old;
    }
  });

  it("loadConfig rethrows when path is a directory (EISDIR)", async () => {
    const dirAsFile = join(tmpDir, "as-file");
    await mkdir(dirAsFile, { recursive: true });
    await expect(loadConfig(dirAsFile)).rejects.toBeDefined();
  });

  it("loadAuth rethrows on directory-as-file (EISDIR)", async () => {
    const dirAsFile = join(tmpDir, "as-file");
    await mkdir(dirAsFile, { recursive: true });
    await expect(loadAuth(dirAsFile)).rejects.toBeDefined();
  });

  it("listHandovers via scanFallback ignores .txt files and returns valid .md only", async () => {
    const old = process.env.OPENCODE_AUTOPILOT_HANDOVER_DIR;
    process.env.OPENCODE_AUTOPILOT_HANDOVER_DIR = tmpDir;
    try {
      await mkdir(tmpDir, { recursive: true });
      await writeFile(join(tmpDir, "2026-01-01T00-00-00-000Z-s-X.md"), "## Goal\nGoodOne");
      await writeFile(join(tmpDir, "extra.txt"), "ignored");
      const list = await listHandovers();
      expect(list.length).toBe(1);
      expect(list[0]?.goalOneliner).toContain("GoodOne");
    } finally {
      if (old === undefined) delete process.env.OPENCODE_AUTOPILOT_HANDOVER_DIR;
      else process.env.OPENCODE_AUTOPILOT_HANDOVER_DIR = old;
    }
  });

  it.runIf(platform() !== "win32")("listHandovers re-throws EACCES from index file", async () => {
    const old = process.env.OPENCODE_AUTOPILOT_HANDOVER_DIR;
    const blocked = join(tmpDir, "blocked");
    await mkdir(blocked);
    await writeFile(join(blocked, "INDEX.jsonl"), "{}");
    await chmod(join(blocked, "INDEX.jsonl"), 0o000);
    process.env.OPENCODE_AUTOPILOT_HANDOVER_DIR = blocked;
    try {
      await expect(listHandovers()).rejects.toMatchObject({ code: "EACCES" });
    } finally {
      try { await chmod(join(blocked, "INDEX.jsonl"), 0o644); } catch { /* */ }
      if (old === undefined) delete process.env.OPENCODE_AUTOPILOT_HANDOVER_DIR;
      else process.env.OPENCODE_AUTOPILOT_HANDOVER_DIR = old;
    }
  });

});
