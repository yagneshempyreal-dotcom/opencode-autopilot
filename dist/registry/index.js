import { classifyModel, inferCtxWindow, inferApiShape, isFlaggedAsUnknown } from "./classify.js";
const PROVIDER_BASE_URLS = {
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
export function buildRegistry(input) {
    const models = [];
    const seen = new Set();
    const seed = collectSeedModels(input);
    for (const { provider, modelID } of seed) {
        const id = `${provider}/${modelID}`;
        if (seen.has(id))
            continue;
        seen.add(id);
        models.push(buildEntry(provider, modelID, input.opencodeConfig));
    }
    const byID = new Map();
    for (const m of models)
        byID.set(`${m.provider}/${m.modelID}`, m);
    const flagged = models.filter((m) => isFlaggedAsUnknown(m.provider, m.modelID));
    return { models, byID, flagged };
}
const SELF_PROVIDERS = new Set(["openauto", "router"]);
function collectSeedModels(input) {
    const out = [];
    const skip = (p) => SELF_PROVIDERS.has(p.toLowerCase());
    for (const provider of Object.keys(input.auth)) {
        if (skip(provider))
            continue;
        const cfgModels = input.opencodeConfig.provider?.[provider]?.models;
        if (cfgModels) {
            for (const modelID of Object.keys(cfgModels))
                out.push({ provider, modelID });
        }
    }
    if (input.opencodeConfig.provider) {
        for (const [provider, pCfg] of Object.entries(input.opencodeConfig.provider)) {
            if (skip(provider))
                continue;
            if (pCfg.models)
                for (const modelID of Object.keys(pCfg.models))
                    out.push({ provider, modelID });
        }
    }
    if (input.recentModels) {
        for (const m of input.recentModels) {
            if (skip(m.providerID))
                continue;
            out.push({ provider: m.providerID, modelID: m.modelID });
        }
    }
    if (input.configuredTiers) {
        for (const ids of Object.values(input.configuredTiers)) {
            for (const id of ids) {
                const slash = id.indexOf("/");
                if (slash <= 0)
                    continue;
                const provider = id.slice(0, slash);
                if (skip(provider))
                    continue;
                out.push({ provider, modelID: id.slice(slash + 1) });
            }
        }
    }
    return out;
}
function buildEntry(provider, modelID, opencodeCfg) {
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
export function modelsForTier(reg, tier) {
    return reg.models.filter((m) => m.tier === tier);
}
export function findModel(reg, modelRef) {
    if (reg.byID.has(modelRef))
        return reg.byID.get(modelRef) ?? null;
    for (const m of reg.models)
        if (m.modelID === modelRef)
            return m;
    return null;
}
//# sourceMappingURL=index.js.map