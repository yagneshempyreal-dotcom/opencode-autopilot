import { describe, it, expect, beforeEach } from "vitest";
import {
  getSession,
  setStickyFloor,
  resetStickyFloor,
  archiveSession,
  recordUsage,
  snapshotSessions,
  clearAllSessions,
} from "../../src/session/state.js";

describe("session state", () => {
  beforeEach(() => {
    clearAllSessions();
  });

  it("creates a fresh session on first access", () => {
    const s = getSession("session-A");
    expect(s.sessionID).toBe("session-A");
    expect(s.stickyFloor).toBeNull();
    expect(s.tokensIn).toBe(0);
    expect(s.tokensOut).toBe(0);
    expect(s.archived).toBe(false);
  });

  it("sticky floor set/reset", () => {
    setStickyFloor("s1", "cheap-paid");
    expect(getSession("s1").stickyFloor).toBe("cheap-paid");
    resetStickyFloor("s1");
    expect(getSession("s1").stickyFloor).toBeNull();
  });

  it("recordUsage accumulates", () => {
    recordUsage("s2", 100, 50, "m1");
    recordUsage("s2", 200, 80, "m2");
    const s = getSession("s2");
    expect(s.tokensIn).toBe(300);
    expect(s.tokensOut).toBe(130);
    expect(s.promptCount).toBe(2);
    expect(s.lastModel).toBe("m2");
  });

  it("isolates sessions by id", () => {
    setStickyFloor("a", "free");
    setStickyFloor("b", "top-paid");
    expect(getSession("a").stickyFloor).toBe("free");
    expect(getSession("b").stickyFloor).toBe("top-paid");
  });

  it("archive flips flag", () => {
    archiveSession("s3");
    expect(getSession("s3").archived).toBe(true);
  });

  it("snapshotSessions returns copies", () => {
    setStickyFloor("snap1", "free");
    const snap = snapshotSessions();
    expect(snap.find((s) => s.sessionID === "snap1")?.stickyFloor).toBe("free");
    snap[0]!.stickyFloor = "top-paid";
    expect(getSession("snap1").stickyFloor).toBe("free");
  });
});
