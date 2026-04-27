import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KEYS = ["OPENCODE_AUTOPILOT_LOG_PATH", "OPENCODE_AUTOPILOT_DEBUG"] as const;
const saved: Record<string, string | undefined> = {};

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "autopilot-log-"));
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.OPENCODE_AUTOPILOT_LOG_PATH = join(tmpDir, "test.log");
  vi.resetModules();
});

afterEach(async () => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
    delete saved[k];
  }
  await rm(tmpDir, { recursive: true, force: true });
});

describe("logger", () => {
  it("writes JSON line per call", async () => {
    const { logger } = await import("../../src/util/log.js?t=write");
    await logger.info("hello", { x: 1 });
    await logger.warn("warn-msg");
    await logger.error("err-msg", { y: 2 });
    await logger.debug("debug-msg");
    const content = await readFile(join(tmpDir, "test.log"), "utf8");
    const lines = content.split("\n").filter(Boolean);
    expect(lines.length).toBe(4);
    const first = JSON.parse(lines[0]!);
    expect(first.msg).toBe("hello");
    expect(first.x).toBe(1);
    expect(first.level).toBe("info");
  });

  it("OPENCODE_AUTOPILOT_DEBUG=1 also writes to stderr", async () => {
    process.env.OPENCODE_AUTOPILOT_DEBUG = "1";
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const { logger } = await import("../../src/util/log.js?t=debug");
      await logger.info("debug-on");
      expect(stderrSpy).toHaveBeenCalled();
      const argZero = stderrSpy.mock.calls[0]?.[0];
      expect(typeof argZero === "string" ? argZero : argZero?.toString() ?? "").toContain("debug-on");
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("does not throw when log file path is unwritable", async () => {
    process.env.OPENCODE_AUTOPILOT_LOG_PATH = "/dev/null/cannot-write/x.log";
    const { logger } = await import("../../src/util/log.js?t=fail");
    await expect(logger.info("ok")).resolves.toBeUndefined();
  });
});
