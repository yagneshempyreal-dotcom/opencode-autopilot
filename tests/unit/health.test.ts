import { describe, it, expect } from "vitest";
import {
  emptyStore,
  isHealthy,
  markDown,
  markOk,
  key,
  DOWN_RETRY_MS,
} from "../../src/registry/health.js";
import { decide } from "../../src/policy/index.js";
import { buildRegistry } from "../../src/registry/index.js";

describe("health store", () => {
  it("treats unknown models as healthy (optimistic)", () => {
    const s = emptyStore();
    expect(isHealthy(s, "openai/whatever")).toBe(true);
  });

  it("marks ok then reports healthy", () => {
    const s = emptyStore();
    markOk(s, "openai/gpt-5.4-mini", 120);
    expect(isHealthy(s, "openai/gpt-5.4-mini")).toBe(true);
    expect(s.records["openai/gpt-5.4-mini"]?.latencyMs).toBe(120);
  });

  it("marks down then reports unhealthy until DOWN_RETRY_MS elapses", () => {
    const s = emptyStore();
    const k = key("openai", "gpt-5.4-mini");
    markDown(s, k, "timeout");
    const t0 = s.records[k]!.lastChecked;
    expect(isHealthy(s, k, t0)).toBe(false);
    expect(isHealthy(s, k, t0 + DOWN_RETRY_MS - 1)).toBe(false);
    expect(isHealthy(s, k, t0 + DOWN_RETRY_MS + 1)).toBe(true); // retry window
  });

  it("counts consecutive failures", () => {
    const s = emptyStore();
    markDown(s, "p/m", "x");
    markDown(s, "p/m", "y");
    expect(s.records["p/m"]?.consecutiveFails).toBe(2);
    markOk(s, "p/m");
    expect(s.records["p/m"]?.consecutiveFails).toBe(0);
  });

  it("flags quota/billing errors with longer backoff", () => {
    const s = emptyStore();
    markDown(s, "deepseek/x", "Insufficient Balance");
    expect(s.records["deepseek/x"]?.quotaError).toBe(true);
    markDown(s, "openai/y", "You exceeded your current quota");
    expect(s.records["openai/y"]?.quotaError).toBe(true);
    markDown(s, "p/transient", "ECONNRESET");
    expect(s.records["p/transient"]?.quotaError).toBeUndefined();
  });
});

describe("policy.decide respects health", () => {
  it("skips down model and picks the next one in tier", () => {
    const reg = buildRegistry({
      auth: { openai: { type: "api", key: "k" } },
      opencodeConfig: {
        provider: { openai: { models: { "gpt-5.4-mini": {}, "gpt-5.4-mini-fast": {} } } },
      },
    });
    const health = emptyStore();
    markDown(health, "openai/gpt-5.4-mini", "timeout");
    const decision = decide({
      classification: { tier: "medium", confidence: 1, reason: "" },
      config: {
        goal: "balance",
        tiers: { free: [], "cheap-paid": [], "top-paid": [] },
        proxy: { port: 4317, host: "127.0.0.1" },
        ux: { badge: false },
        triage: { enabled: false },
        handover: {
          enabled: false, thresholdWarn: 0.7, thresholdSave: 0.8, thresholdEmergency: 0.9,
          mode: "replace", autoResume: false, summaryModel: "policy",
        },
      },
      registry: reg,
      stickyFloor: null,
      override: null,
      estimatedTokens: 1000,
      health,
    });
    expect(decision).not.toBeNull();
    expect(decision?.modelID).toBe("gpt-5.4-mini-fast");
  });

  it("respects allowlist — only pinned models are eligible", () => {
    const reg = buildRegistry({
      auth: { openai: { type: "api", key: "k" }, deepseek: { type: "api", key: "k" } },
      opencodeConfig: {
        provider: {
          openai: { models: { "gpt-5.4-mini": {} } },
          deepseek: { models: { "deepseek-chat": {} } },
        },
      },
    });
    const decision = decide({
      classification: { tier: "medium", confidence: 1, reason: "" },
      config: {
        goal: "balance",
        tiers: { free: [], "cheap-paid": [], "top-paid": [] },
        allowlist: ["deepseek/deepseek-chat"],
        proxy: { port: 4317, host: "127.0.0.1" },
        ux: { badge: false },
        triage: { enabled: false },
        handover: {
          enabled: false, thresholdWarn: 0.7, thresholdSave: 0.8, thresholdEmergency: 0.9,
          mode: "replace", autoResume: false, summaryModel: "policy",
        },
      },
      registry: reg,
      stickyFloor: null,
      override: null,
      estimatedTokens: 1000,
    });
    expect(decision?.modelID).toBe("deepseek-chat");
  });
});
