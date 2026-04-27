import { describe, it, expect } from "vitest";
import { decide, GOAL_MATRIX, maxTier, bumpStickyFloor, tierLadder } from "../../src/policy/index.js";
import { buildRegistry } from "../../src/registry/index.js";
import { DEFAULT_CONFIG } from "../../src/config/store.js";
import type { AutopilotConfig } from "../../src/types.js";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = join(__dirname, "..", "fixtures");

async function fixtureRegistry() {
  const auth = JSON.parse(await readFile(join(FIX, "auth.json"), "utf8"));
  const opencodeConfig = JSON.parse(await readFile(join(FIX, "opencode.json"), "utf8"));
  return buildRegistry({ auth, opencodeConfig });
}

function configFor(goal: AutopilotConfig["goal"]): AutopilotConfig {
  return { ...DEFAULT_CONFIG, goal, tiers: { free: [], "cheap-paid": [], "top-paid": [] } };
}

describe("GOAL_MATRIX", () => {
  it("cost prefers free where possible", () => {
    expect(GOAL_MATRIX.cost.low).toBe("free");
    expect(GOAL_MATRIX.cost.medium).toBe("free");
    expect(GOAL_MATRIX.cost.high).toBe("cheap-paid");
  });
  it("balance distributes across tiers", () => {
    expect(GOAL_MATRIX.balance.low).toBe("free");
    expect(GOAL_MATRIX.balance.medium).toBe("cheap-paid");
    expect(GOAL_MATRIX.balance.high).toBe("top-paid");
  });
  it("quality avoids free entirely", () => {
    expect(GOAL_MATRIX.quality.low).toBe("cheap-paid");
    expect(GOAL_MATRIX.quality.medium).toBe("top-paid");
    expect(GOAL_MATRIX.quality.high).toBe("top-paid");
  });
});

describe("maxTier", () => {
  it("returns higher of two tiers", () => {
    expect(maxTier("free", "cheap-paid")).toBe("cheap-paid");
    expect(maxTier("cheap-paid", "free")).toBe("cheap-paid");
    expect(maxTier("top-paid", "free")).toBe("top-paid");
    expect(maxTier("free", null)).toBe("free");
  });
});

describe("bumpStickyFloor", () => {
  it("from null with no effective context returns free (lowest)", () => {
    expect(bumpStickyFloor(null)).toBe("free");
  });
  it("from null but with effective tier=free returns cheap-paid", () => {
    expect(bumpStickyFloor(null, "free")).toBe("cheap-paid");
  });
  it("from null but with effective tier=cheap-paid returns top-paid", () => {
    expect(bumpStickyFloor(null, "cheap-paid")).toBe("top-paid");
  });
  it("escalates each tier (sticky floor only)", () => {
    expect(bumpStickyFloor("free")).toBe("cheap-paid");
    expect(bumpStickyFloor("cheap-paid")).toBe("top-paid");
  });
  it("caps at top-paid", () => {
    expect(bumpStickyFloor("top-paid")).toBe("top-paid");
    expect(bumpStickyFloor(null, "top-paid")).toBe("top-paid");
  });
  it("uses max of sticky and effective when both present", () => {
    expect(bumpStickyFloor("free", "cheap-paid")).toBe("top-paid");
    expect(bumpStickyFloor("cheap-paid", "free")).toBe("top-paid");
  });
});

describe("tierLadder", () => {
  it("returns escalation path from given tier", () => {
    expect(tierLadder("free")).toEqual(["free", "cheap-paid", "top-paid"]);
    expect(tierLadder("cheap-paid")).toEqual(["cheap-paid", "top-paid"]);
    expect(tierLadder("top-paid")).toEqual(["top-paid"]);
  });
});

describe("decide", () => {
  it("routes low+cost to a free model", async () => {
    const registry = await fixtureRegistry();
    const result = decide({
      classification: { tier: "low", confidence: 0.9, reason: "" },
      config: configFor("cost"),
      registry,
      stickyFloor: null,
      override: null,
      estimatedTokens: 100,
    });
    expect(result).not.toBeNull();
    expect(result?.tier).toBe("free");
  });

  it("routes high+balance to top-paid", async () => {
    const registry = await fixtureRegistry();
    const result = decide({
      classification: { tier: "high", confidence: 0.9, reason: "" },
      config: configFor("balance"),
      registry,
      stickyFloor: null,
      override: null,
      estimatedTokens: 1000,
    });
    expect(result).not.toBeNull();
    expect(result?.tier).toBe("top-paid");
  });

  it("respects sticky floor (can't go below)", async () => {
    const registry = await fixtureRegistry();
    const result = decide({
      classification: { tier: "low", confidence: 0.9, reason: "" },
      config: configFor("cost"),
      registry,
      stickyFloor: "cheap-paid",
      override: null,
      estimatedTokens: 100,
    });
    expect(result?.tier).toBe("cheap-paid");
  });

  it("override bypasses classifier and policy", async () => {
    const registry = await fixtureRegistry();
    const result = decide({
      classification: { tier: "low", confidence: 0.9, reason: "" },
      config: configFor("cost"),
      registry,
      stickyFloor: null,
      override: { modelRef: "anthropic/claude-opus-4-7" },
      estimatedTokens: 100,
    });
    expect(result?.override).toBe(true);
    expect(result?.modelID).toBe("claude-opus-4-7");
  });

  it("ignores invalid override and uses tier", async () => {
    const registry = await fixtureRegistry();
    const result = decide({
      classification: { tier: "low", confidence: 0.9, reason: "" },
      config: configFor("balance"),
      registry,
      stickyFloor: null,
      override: { modelRef: "nonsense/does-not-exist" },
      estimatedTokens: 100,
    });
    expect(result?.override).toBe(false);
    expect(result?.tier).toBe("free");
  });

  it("escalates when tier has no models with sufficient ctx window", () => {
    const registry = buildRegistry({
      auth: { p1: { type: "api", key: "x" } },
      opencodeConfig: { provider: { p1: { models: { "tiny-free": { ctx: 4000 } } } } },
    });
    const result = decide({
      classification: { tier: "low", confidence: 0.9, reason: "" },
      config: configFor("cost"),
      registry,
      stickyFloor: null,
      override: null,
      estimatedTokens: 100_000,
    });
    expect(result).toBeNull();
  });

  it("returns null when registry empty", () => {
    const registry = buildRegistry({ auth: {}, opencodeConfig: {} });
    const result = decide({
      classification: { tier: "low", confidence: 0.9, reason: "" },
      config: configFor("balance"),
      registry,
      stickyFloor: null,
      override: null,
      estimatedTokens: 100,
    });
    expect(result).toBeNull();
  });

  it("uses configured tier list when set", async () => {
    const registry = await fixtureRegistry();
    const cfg: AutopilotConfig = {
      ...configFor("cost"),
      tiers: {
        free: ["opencode/minimax-m2.5-free"],
        "cheap-paid": [],
        "top-paid": [],
      },
    };
    const result = decide({
      classification: { tier: "low", confidence: 0.9, reason: "" },
      config: cfg,
      registry,
      stickyFloor: null,
      override: null,
      estimatedTokens: 100,
    });
    expect(result?.modelID).toBe("minimax-m2.5-free");
  });
});
