import { describe, it, expect } from "vitest";
import { formatBadge } from "../../src/badge/format.js";
import type { RouteDecision } from "../../src/types.js";

const decision = (over: Partial<RouteDecision> = {}): RouteDecision => ({
  modelID: "nemotron-3-super-free",
  provider: "opencode",
  tier: "free",
  reason: "test",
  escalated: false,
  override: false,
  ...over,
});

describe("formatBadge", () => {
  it("formats a normal route", () => {
    const b = formatBadge({ decision: decision() });
    expect(b).toBe("[router → free / nemotron-3-super-free]");
  });

  it("formats override", () => {
    const b = formatBadge({ decision: decision({ override: true, modelID: "claude-opus-4-7" }) });
    expect(b).toContain("manual");
    expect(b).toContain("claude-opus-4-7");
  });

  it("formats escalation warning", () => {
    const b = formatBadge({ decision: decision({ escalated: true, tier: "cheap-paid", modelID: "gpt-5.4-mini" }) });
    expect(b).toContain("⚠");
    expect(b).toContain("cheap-paid");
  });

  it("formats sticky upgrade", () => {
    const b = formatBadge({ decision: decision({ tier: "cheap-paid" }), stickyBumpedTo: "cheap-paid" });
    expect(b).toContain("↑");
    expect(b).toContain("upgraded");
  });

  it("formats resume", () => {
    const b = formatBadge({ decision: decision(), resumed: true, resumeFrom: "/path/to/handover-X.md" });
    expect(b).toContain("↻");
    expect(b).toContain("handover-X.md");
  });

  it("includes ctx warning when warnHandover", () => {
    const b = formatBadge({ decision: decision(), ctxUtilization: 0.75, warnHandover: true });
    expect(b).toContain("ctx 75%");
  });
});
