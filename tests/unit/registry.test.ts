import { describe, it, expect } from "vitest";
import { classifyModel, inferCtxWindow, inferApiShape, isFlaggedAsUnknown } from "../../src/registry/classify.js";
import { buildRegistry, modelsForTier, findModel } from "../../src/registry/index.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = join(__dirname, "..", "fixtures");

describe("classifyModel", () => {
  it("classifies free models by suffix :free", () => {
    expect(classifyModel("openrouter", "google/gemma-4-26b-a4b-it:free")).toBe("free");
    expect(classifyModel("openrouter", "nousresearch/hermes-3-llama-3.1-405b:free")).toBe("free");
  });

  it("classifies free models by -free pattern", () => {
    expect(classifyModel("opencode", "nemotron-3-super-free")).toBe("free");
    expect(classifyModel("opencode", "minimax-m2.5-free")).toBe("free");
  });

  it("classifies top-paid models", () => {
    expect(classifyModel("anthropic", "claude-opus-4-7")).toBe("top-paid");
    expect(classifyModel("openai", "gpt-5.4")).toBe("top-paid");
    expect(classifyModel("openai", "gpt-4o")).toBe("top-paid");
    expect(classifyModel("deepseek", "deepseek-reasoner")).toBe("top-paid");
    expect(classifyModel("zhipuai", "glm-4-plus")).toBe("top-paid");
    expect(classifyModel("anthropic", "claude-sonnet-4-6")).toBe("top-paid");
  });

  it("classifies cheap-paid models", () => {
    expect(classifyModel("openai", "gpt-5.4-mini")).toBe("cheap-paid");
    expect(classifyModel("anthropic", "claude-haiku-4-5")).toBe("cheap-paid");
    expect(classifyModel("google", "gemini-2-flash")).toBe("cheap-paid");
    expect(classifyModel("openrouter", "x-ai/grok-code-fast-1")).toBe("cheap-paid");
  });

  it("defaults unknowns to cheap-paid + flags them", () => {
    expect(classifyModel("custom", "weird-model-id-9000")).toBe("cheap-paid");
    expect(isFlaggedAsUnknown("custom", "weird-model-id-9000")).toBe(true);
  });

  it("does not flag known patterns", () => {
    expect(isFlaggedAsUnknown("openai", "gpt-5.4-mini")).toBe(false);
    expect(isFlaggedAsUnknown("opencode", "nemotron-3-super-free")).toBe(false);
    expect(isFlaggedAsUnknown("anthropic", "claude-opus-4-7")).toBe(false);
  });
});

describe("inferCtxWindow", () => {
  it("returns large windows for known big models", () => {
    expect(inferCtxWindow("gpt-5-1m")).toBe(1_000_000);
    expect(inferCtxWindow("gemini-2-pro")).toBe(1_000_000);
    expect(inferCtxWindow("claude-opus-4-7")).toBe(200_000);
  });

  it("falls back to 32k for unknown", () => {
    expect(inferCtxWindow("totally-made-up")).toBe(32_000);
  });
});

describe("inferApiShape", () => {
  it("dispatches by provider name", () => {
    expect(inferApiShape("anthropic")).toBe("anthropic");
    expect(inferApiShape("openrouter")).toBe("openrouter");
    expect(inferApiShape("opencode")).toBe("opencode");
    expect(inferApiShape("openai")).toBe("openai");
    expect(inferApiShape("deepseek")).toBe("openai");
    expect(inferApiShape("zhipuai")).toBe("openai");
  });
});

describe("buildRegistry", () => {
  it("scans auth + opencode config to build registry", async () => {
    const auth = JSON.parse(await readFile(join(FIX, "auth.json"), "utf8"));
    const opencodeConfig = JSON.parse(await readFile(join(FIX, "opencode.json"), "utf8"));
    const reg = buildRegistry({ auth, opencodeConfig });
    expect(reg.models.length).toBeGreaterThan(8);

    const free = modelsForTier(reg, "free");
    const cheap = modelsForTier(reg, "cheap-paid");
    const top = modelsForTier(reg, "top-paid");
    expect(free.length).toBeGreaterThanOrEqual(3);
    expect(cheap.length).toBeGreaterThanOrEqual(2);
    expect(top.length).toBeGreaterThanOrEqual(3);

    const opus = findModel(reg, "anthropic/claude-opus-4-7");
    expect(opus).not.toBeNull();
    expect(opus?.tier).toBe("top-paid");
    expect(opus?.ctxWindow).toBe(200_000);
    expect(opus?.apiShape).toBe("anthropic");
  });

  it("lookup by short modelID falls back to first match", async () => {
    const auth = JSON.parse(await readFile(join(FIX, "auth.json"), "utf8"));
    const opencodeConfig = JSON.parse(await readFile(join(FIX, "opencode.json"), "utf8"));
    const reg = buildRegistry({ auth, opencodeConfig });
    const m = findModel(reg, "gpt-5.4-mini");
    expect(m).not.toBeNull();
    expect(m?.modelID).toBe("gpt-5.4-mini");
  });

  it("handles empty auth gracefully", () => {
    const reg = buildRegistry({ auth: {}, opencodeConfig: {} });
    expect(reg.models).toHaveLength(0);
    expect(reg.flagged).toHaveLength(0);
  });

  it("includes recentModels even when not in auth or config", () => {
    const reg = buildRegistry({
      auth: {},
      opencodeConfig: {},
      recentModels: [
        { providerID: "openai", modelID: "gpt-5.4" },
        { providerID: "openai", modelID: "gpt-5.4" }, // dedup
        { providerID: "anthropic", modelID: "claude-haiku-4-5" },
      ],
    });
    expect(reg.models.length).toBe(2);
    const ids = reg.models.map((m) => `${m.provider}/${m.modelID}`);
    expect(ids).toContain("openai/gpt-5.4");
    expect(ids).toContain("anthropic/claude-haiku-4-5");
  });

  it("seeds from configuredTiers when opencode.json declares no models inline", () => {
    const reg = buildRegistry({
      auth: { opencode: { type: "wellknown", key: "k" }, openai: { type: "api", key: "k" } },
      opencodeConfig: {},
      configuredTiers: {
        free: ["opencode/nemotron-3-super-free", "opencode/minimax-m2.5-free"],
        "cheap-paid": ["openai/gpt-5.4-mini"],
        "top-paid": ["openai/gpt-5.4"],
      },
    });
    expect(reg.models.length).toBe(4);
    const free = reg.models.filter((m) => m.tier === "free");
    expect(free.length).toBe(2);
  });

  it("ignores configuredTiers entries without slash separator", () => {
    const reg = buildRegistry({
      auth: {},
      opencodeConfig: {},
      configuredTiers: { free: ["bad-entry-no-slash"] } as Record<string, string[]>,
    });
    expect(reg.models).toHaveLength(0);
  });
});
