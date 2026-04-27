import type { ModelEntry, Tier, OpenCodeAuth } from "../types.js";
import type { OpencodeConfig } from "../config/opencode.js";
import { classifyModel, inferCtxWindow, inferApiShape, isFlaggedAsUnknown } from "./classify.js";

export interface Registry {
  models: ModelEntry[];
  byID: Map<string, ModelEntry>;
  flagged: ModelEntry[];
}

export interface ScanInput {
  auth: OpenCodeAuth;
  opencodeConfig: OpencodeConfig;
  recentModels?: Array<{ providerID: string; modelID: string }>;
}

const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  deepseek: "https://api.deepseek.com/v1",
  zhipuai: "https://open.bigmodel.cn/api/paas/v4",
  opencode: "https://opencode.ai/zen/v1",
  groq: "https://api.groq.com/openai/v1",
  cerebras: "https://api.cerebras.ai/v1",
  together: "https://api.together.xyz/v1",
};

export function buildRegistry(input: ScanInput): Registry {
  const models: ModelEntry[] = [];
  const seen = new Set<string>();

  const seed = collectSeedModels(input);
  for (const { provider, modelID } of seed) {
    const id = `${provider}/${modelID}`;
    if (seen.has(id)) continue;
    seen.add(id);
    models.push(buildEntry(provider, modelID, input.opencodeConfig));
  }

  const byID = new Map<string, ModelEntry>();
  for (const m of models) byID.set(`${m.provider}/${m.modelID}`, m);
  const flagged = models.filter((m) => isFlaggedAsUnknown(m.provider, m.modelID));

  return { models, byID, flagged };
}

function collectSeedModels(input: ScanInput): Array<{ provider: string; modelID: string }> {
  const out: Array<{ provider: string; modelID: string }> = [];
  for (const provider of Object.keys(input.auth)) {
    const cfgModels = input.opencodeConfig.provider?.[provider]?.models;
    if (cfgModels) {
      for (const modelID of Object.keys(cfgModels)) out.push({ provider, modelID });
    }
  }
  if (input.opencodeConfig.provider) {
    for (const [provider, pCfg] of Object.entries(input.opencodeConfig.provider)) {
      if (pCfg.models) for (const modelID of Object.keys(pCfg.models)) out.push({ provider, modelID });
    }
  }
  if (input.recentModels) {
    for (const m of input.recentModels) out.push({ provider: m.providerID, modelID: m.modelID });
  }
  return out;
}

function buildEntry(provider: string, modelID: string, opencodeCfg: OpencodeConfig): ModelEntry {
  const tier = classifyModel(provider, modelID);
  const cfgEntry = opencodeCfg.provider?.[provider];
  const ctx = cfgEntry?.models?.[modelID]?.ctx ?? inferCtxWindow(modelID);
  const baseURL = cfgEntry?.options?.baseURL ?? PROVIDER_BASE_URLS[provider];
  return {
    provider,
    modelID,
    tier,
    ctxWindow: ctx,
    supportsStreaming: true,
    apiShape: inferApiShape(provider),
    baseURL,
  };
}

export function modelsForTier(reg: Registry, tier: Tier): ModelEntry[] {
  return reg.models.filter((m) => m.tier === tier);
}

export function findModel(reg: Registry, modelRef: string): ModelEntry | null {
  if (reg.byID.has(modelRef)) return reg.byID.get(modelRef) ?? null;
  for (const m of reg.models) if (m.modelID === modelRef) return m;
  return null;
}
