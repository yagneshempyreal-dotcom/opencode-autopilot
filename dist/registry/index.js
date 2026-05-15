import { classifyModel, inferCtxWindow, inferApiShape, isFlaggedAsUnknown, inferTags } from "./classify.js";
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
        tags: inferTags(provider, modelID),
    };
}
export function modelsForTier(reg, tier) {
    return reg.models.filter((m) => m.tier === tier);
}
export function findModel(reg, modelRef) {
    const ref = modelRef.trim();
    if (!ref)
        return null;
    if (reg.byID.has(ref))
        return reg.byID.get(ref) ?? null;
    // Bare model id (e.g. @gpt-5.4) — prefer exact id, then unique prefix match.
    const byModelId = reg.models.filter((m) => m.modelID === ref);
    if (byModelId.length === 1)
        return byModelId[0] ?? null;
    if (byModelId.length > 1) {
        const openai = byModelId.filter((m) => m.provider === "openai");
        if (openai.length === 1)
            return openai[0] ?? null;
        return byModelId[0] ?? null;
    }
    const prefixMatches = reg.models.filter((m) => m.modelID.startsWith(ref) || ref.startsWith(m.modelID));
    if (prefixMatches.length === 1)
        return prefixMatches[0] ?? null;
    if (prefixMatches.length > 1) {
        // Prefer openai for bare gpt-* refs; otherwise shortest model id (most specific).
        const preferOpenai = /^gpt[-.]/i.test(ref);
        const ranked = [...prefixMatches].sort((a, b) => {
            if (preferOpenai) {
                const ao = a.provider === "openai" ? 0 : 1;
                const bo = b.provider === "openai" ? 0 : 1;
                if (ao !== bo)
                    return ao - bo;
            }
            return a.modelID.length - b.modelID.length || a.modelID.localeCompare(b.modelID);
        });
        return ranked[0] ?? null;
    }
    return null;
}
//# sourceMappingURL=index.js.map