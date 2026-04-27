import { describe, it, expect } from "vitest";
import { evaluate, shouldTriggerSave } from "../../src/handover/monitor.js";
import { DEFAULT_CONFIG } from "../../src/config/store.js";

describe("handover monitor evaluate()", () => {
  const cfg = DEFAULT_CONFIG.handover;

  it("returns ok below warn threshold", () => {
    expect(evaluate(0.0, cfg)).toBe("ok");
    expect(evaluate(0.5, cfg)).toBe("ok");
    expect(evaluate(0.69, cfg)).toBe("ok");
  });

  it("returns warn at warn threshold", () => {
    expect(evaluate(0.7, cfg)).toBe("warn");
    expect(evaluate(0.79, cfg)).toBe("warn");
  });

  it("returns save at save threshold", () => {
    expect(evaluate(0.8, cfg)).toBe("save");
    expect(evaluate(0.91, cfg)).toBe("save");
  });

  it("returns emergency at emergency threshold", () => {
    expect(evaluate(0.92, cfg)).toBe("emergency");
    expect(evaluate(0.99, cfg)).toBe("emergency");
    expect(evaluate(1.5, cfg)).toBe("emergency");
  });

  it("respects disabled config but still flags emergency", () => {
    const disabled = { ...cfg, enabled: false };
    expect(evaluate(0.85, disabled)).toBe("ok");
    expect(evaluate(0.99, disabled)).toBe("emergency");
  });
});

describe("shouldTriggerSave", () => {
  it("triggers on save and emergency only", () => {
    expect(shouldTriggerSave("ok")).toBe(false);
    expect(shouldTriggerSave("warn")).toBe(false);
    expect(shouldTriggerSave("save")).toBe(true);
    expect(shouldTriggerSave("emergency")).toBe(true);
  });
});
