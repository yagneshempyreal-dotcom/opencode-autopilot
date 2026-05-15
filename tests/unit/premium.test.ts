import { describe, it, expect } from "vitest";
import { decide } from "../../src/policy/index.js";
import { buildRegistry } from "../../src/registry/index.js";
import {
  premiumModelIds,
  buildPremiumCandidates,
  buildFreeCandidates,
  premiumRetries,
  premiumFallbackToFree,
  isPremiumGoal,
} from "../../src/policy/premium.js";
import { emptyStore } from "../../src/registry/health.js";
import type { AutopilotConfig } from "../../src/types.js";

function premiumConfig(overrides: Partial<AutopilotConfig> = {}): AutopilotConfig {
  return {
    goal: "premium",
    tiers: {
      free: ["mock-free/tiny"],
      "cheap-paid": ["mock-cheap/small"],
      "top-paid": ["mock-top/big", "mock-top/big2"],
    },
    premium: {
      models: ["mock-top/big", "mock-top/big2", "mock-cheap/small"],
      retriesPerModel: 3,
      fallbackToFree: false,
      freeModels: ["mock-free/tiny"],
    },
    proxy: { port: 4317, host: "127.0.0.1" },
    ux: { badge: false },
    triage: { enabled: false },
    handover: {
      enabled: false,
      thresholdWarn: 0.7,
      thresholdSave: 0.8,
      thresholdEmergency: 0.9,
      mode: "replace",
      autoResume: false,
      summaryModel: "policy",
    },
    ...overrides,
  };
}

function mockRegistry() {
  const entries = [
    { provider: "mock-top", modelID: "big", tier: "top-paid" as const },
    { provider: "mock-top", modelID: "big2", tier: "top-paid" as const },
    { provider: "mock-cheap", modelID: "small", tier: "cheap-paid" as const },
    { provider: "mock-free", modelID: "tiny", tier: "free" as const },
  ];
  return buildRegistry({
    auth: Object.fromEntries(entries.map((e) => [e.provider, { type: "api" as const, key: "k" }])),
    opencodeConfig: {
      provider: Object.fromEntries(
        entries.map((e) => [e.provider, { models: { [e.modelID]: { ctx: 128_000 } } }]),
      ),
    },
  });
}

describe("premium policy", () => {
  it("detects premium goal", () => {
    expect(isPremiumGoal(premiumConfig())).toBe(true);
    expect(isPremiumGoal(premiumConfig({ goal: "balance" }))).toBe(false);
  });

  it("resolves premium model ids from premium.models", () => {
    const ids = premiumModelIds(premiumConfig());
    expect(ids).toEqual(["mock-top/big", "mock-top/big2", "mock-cheap/small"]);
  });

  it("decide picks from premium pool only", () => {
    const reg = mockRegistry();
    const d = decide({
      classification: { tier: "low", confidence: 0.9, reason: "" },
      config: premiumConfig(),
      registry: reg,
      stickyFloor: null,
      override: null,
      estimatedTokens: 500,
    });
    expect(d?.provider).toBe("mock-top");
    expect(d?.reason).toContain("premium");
  });

  it("excludes free tier from premium candidates", () => {
    const reg = mockRegistry();
    const pool = buildPremiumCandidates(reg, premiumConfig(), 500, emptyStore());
    expect(pool.every((m) => m.tier !== "free")).toBe(true);
  });

  it("builds free fallback pool from premium.freeModels", () => {
    const reg = mockRegistry();
    const free = buildFreeCandidates(reg, premiumConfig(), 500, emptyStore());
    expect(free.map((m) => `${m.provider}/${m.modelID}`)).toEqual(["mock-free/tiny"]);
  });

  it("defaults retries to 3 and does not auto-fallback to free", () => {
    const cfg = premiumConfig();
    expect(premiumRetries(cfg)).toBe(3);
    expect(premiumFallbackToFree(cfg)).toBe(false);
    expect(premiumFallbackToFree({ ...cfg, premium: { fallbackToFree: true } })).toBe(true);
  });
});
