import type { Tier, ModelEntry } from "../types.js";

const FREE_PATTERNS = [/:free$/i, /-free$/i, /-free[/-]/i];

const TOP_PATTERNS = [
  /opus/i,
  /gpt-?5(?!\.\d?-mini|\.\d?-nano)/i,
  /gpt-?4o(?!-mini)/i,
  /o1(?:-preview|-pro)?/i,
  /o3(?:-pro|-deep)?/i,
  /reasoner/i,
  /\b(?:glm|chatglm)-4-plus/i,
  /\b(?:glm|chatglm)-5\b/i,
  /sonnet-4/i,
  /sonnet-5/i,
  /claude-(?:opus|sonnet)-[0-9]/i,
  /gemini-(?:1\.5|2)-pro/i,
  /gemini-advanced/i,
  /grok-(?:3|4)(?!-mini)/i,
];

const CHEAP_PATTERNS = [
  /mini/i,
  /nano/i,
  /haiku/i,
  /flash/i,
  /turbo/i,
  /small/i,
  /\bmistral-small/i,
  /\bgrok-code-fast/i,
  /\bglm-4\.5/i,
  /\bglm-5v-turbo/i,
  /-codex-/i,
];

const CTX_HINTS: Array<{ pattern: RegExp; ctx: number }> = [
  { pattern: /1m\b/i, ctx: 1_000_000 },
  { pattern: /200k\b/i, ctx: 200_000 },
  { pattern: /128k\b/i, ctx: 128_000 },
  { pattern: /opus|sonnet/i, ctx: 200_000 },
  { pattern: /gpt-?5/i, ctx: 400_000 },
  { pattern: /gpt-?4o/i, ctx: 128_000 },
  { pattern: /gemini/i, ctx: 1_000_000 },
  { pattern: /deepseek/i, ctx: 128_000 },
  { pattern: /glm-4-plus|glm-5/i, ctx: 128_000 },
  { pattern: /haiku/i, ctx: 200_000 },
];

const DEFAULT_CTX = 32_000;

export function classifyModel(provider: string, modelID: string): Tier {
  const haystack = `${provider}/${modelID}`;
  if (FREE_PATTERNS.some((re) => re.test(haystack))) return "free";
  if (TOP_PATTERNS.some((re) => re.test(haystack))) return "top-paid";
  if (CHEAP_PATTERNS.some((re) => re.test(haystack))) return "cheap-paid";
  return "cheap-paid";
}

export function inferCtxWindow(modelID: string): number {
  for (const hint of CTX_HINTS) if (hint.pattern.test(modelID)) return hint.ctx;
  return DEFAULT_CTX;
}

export function inferApiShape(provider: string): ModelEntry["apiShape"] {
  const p = provider.toLowerCase();
  if (p === "anthropic") return "anthropic";
  if (p === "openrouter") return "openrouter";
  if (p === "opencode") return "opencode";
  return "openai";
}

export function isFlaggedAsUnknown(provider: string, modelID: string): boolean {
  const haystack = `${provider}/${modelID}`;
  if (FREE_PATTERNS.some((re) => re.test(haystack))) return false;
  if (TOP_PATTERNS.some((re) => re.test(haystack))) return false;
  if (CHEAP_PATTERNS.some((re) => re.test(haystack))) return false;
  return true;
}
