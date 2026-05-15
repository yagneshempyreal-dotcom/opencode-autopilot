import { findModel, modelsForTier } from "../registry/index.js";
import { isHealthy, key as healthKey } from "../registry/health.js";
const SELF_IDS = new Set(["openauto/auto", "router/auto"]);
export function isPremiumGoal(config) {
    return config.goal === "premium";
}
/** Explicit premium list, else allowlist (non-free), else tiers top+cheap. */
export function premiumModelIds(config) {
    const explicit = config.premium?.models;
    if (explicit && explicit.length > 0) {
        return explicit.filter((id) => id && !SELF_IDS.has(id));
    }
    const allow = config.allowlist;
    if (allow && allow.length > 0) {
        return allow.filter((id) => id && !SELF_IDS.has(id));
    }
    const merged = [
        ...(config.tiers["top-paid"] ?? []),
        ...(config.tiers["cheap-paid"] ?? []),
    ];
    const seen = new Set();
    const out = [];
    for (const id of merged) {
        if (!id || SELF_IDS.has(id) || seen.has(id))
            continue;
        seen.add(id);
        out.push(id);
    }
    return out;
}
export function freeFallbackModelIds(config, registry) {
    const explicit = config.premium?.freeModels;
    if (explicit && explicit.length > 0) {
        return explicit.filter((id) => id && !SELF_IDS.has(id));
    }
    const tierIds = config.tiers.free ?? [];
    if (tierIds.length > 0) {
        return tierIds.filter((id) => id && !SELF_IDS.has(id));
    }
    return modelsForTier(registry, "free").map((m) => `${m.provider}/${m.modelID}`);
}
export function buildPremiumCandidates(registry, config, estimatedTokens, health, taskTags = [], exclude = []) {
    const excludeSet = new Set(exclude);
    const minCtx = Math.max(estimatedTokens + 1024, 4096);
    const ids = premiumModelIds(config);
    let pool = ids
        .map((id) => findModel(registry, id))
        .filter((m) => m !== null && m.tier !== "free")
        .filter((m) => !excludeSet.has(`${m.provider}/${m.modelID}`))
        .filter((m) => m.ctxWindow >= minCtx);
    pool = sortPremiumPool(pool, taskTags, health);
    return pool;
}
export function buildFreeCandidates(registry, config, estimatedTokens, health, exclude = []) {
    const excludeSet = new Set(exclude);
    const minCtx = Math.max(estimatedTokens + 1024, 4096);
    const ids = freeFallbackModelIds(config, registry);
    let pool = ids
        .map((id) => findModel(registry, id))
        .filter((m) => m !== null)
        .filter((m) => !excludeSet.has(`${m.provider}/${m.modelID}`))
        .filter((m) => m.ctxWindow >= minCtx);
    const healthy = pool.filter((m) => isHealthy(health, healthKey(m.provider, m.modelID)));
    pool = healthy.length > 0 ? healthy : pool;
    return pool;
}
function sortPremiumPool(pool, taskTags, health) {
    const score = (m) => {
        let s = 0;
        for (const t of taskTags)
            if (m.tags.includes(t))
                s += 10;
        if (m.tier === "top-paid")
            s += 5;
        if (isHealthy(health, healthKey(m.provider, m.modelID)))
            s += 3;
        return s;
    };
    const healthy = pool.filter((m) => isHealthy(health, healthKey(m.provider, m.modelID)));
    const base = healthy.length > 0 ? healthy : pool;
    return [...base].sort((a, b) => score(b) - score(a) || a.modelID.localeCompare(b.modelID));
}
export function premiumRetries(config) {
    const n = config.premium?.retriesPerModel;
    return typeof n === "number" && n >= 1 ? Math.min(n, 10) : 3;
}
export function premiumFallbackToFree(config) {
    return config.premium?.fallbackToFree === true;
}
//# sourceMappingURL=premium.js.map