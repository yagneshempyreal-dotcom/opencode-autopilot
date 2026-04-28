import { TIER_RANK } from "../types.js";
import { findModel, modelsForTier } from "../registry/index.js";
import { emptyStore, isHealthy, key as healthKey } from "../registry/health.js";
export const GOAL_MATRIX = {
    cost: { low: "free", medium: "free", high: "cheap-paid" },
    balance: { low: "free", medium: "cheap-paid", high: "top-paid" },
    quality: { low: "cheap-paid", medium: "top-paid", high: "top-paid" },
    custom: { low: "free", medium: "cheap-paid", high: "top-paid" },
};
export const TIER_ESCALATION = ["free", "cheap-paid", "top-paid"];
export function decide(input) {
    if (input.override) {
        const overridden = findModel(input.registry, input.override.modelRef);
        if (overridden) {
            return {
                modelID: overridden.modelID,
                provider: overridden.provider,
                tier: overridden.tier,
                reason: `manual override: ${input.override.modelRef}`,
                escalated: false,
                override: true,
            };
        }
    }
    const goalTier = GOAL_MATRIX[input.config.goal][input.classification.tier];
    const effective = maxTier(goalTier, input.stickyFloor);
    const ladder = tierLadder(effective);
    const health = input.health ?? emptyStore();
    let escalated = false;
    for (const tier of ladder) {
        const raw = pickCandidates(input.registry, input.config, tier, input.estimatedTokens, health);
        const candidates = rankByTags(raw, input.taskTags ?? []);
        if (candidates.length > 0) {
            const chosen = candidates[0];
            if (!chosen)
                continue;
            return {
                modelID: chosen.modelID,
                provider: chosen.provider,
                tier: chosen.tier,
                reason: escalated
                    ? `escalated to ${tier} (no fit in lower tiers)`
                    : `${input.config.goal}/${input.classification.tier} → ${tier}`,
                escalated,
                override: false,
            };
        }
        escalated = true;
    }
    return null;
}
export function maxTier(a, b) {
    if (!b)
        return a;
    return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}
export function bumpStickyFloor(current, currentEffective) {
    const baseRank = Math.max(current ? TIER_RANK[current] : -1, currentEffective ? TIER_RANK[currentEffective] : -1);
    const nextIdx = Math.min(baseRank + 1, TIER_ESCALATION.length - 1);
    const next = TIER_ESCALATION[Math.max(0, nextIdx)];
    return (next ?? "cheap-paid");
}
export function tierLadder(start) {
    const idx = TIER_RANK[start];
    return TIER_ESCALATION.slice(idx);
}
function rankByTags(pool, taskTags) {
    if (taskTags.length === 0)
        return pool;
    const score = (m) => {
        let s = 0;
        for (const t of taskTags)
            if (m.tags.includes(t))
                s += 1;
        return s;
    };
    return [...pool].sort((a, b) => score(b) - score(a));
}
function pickCandidates(registry, config, tier, estimatedTokens, health = emptyStore()) {
    const explicit = config.tiers[tier] ?? [];
    const explicitResolved = explicit
        .map((id) => findModel(registry, id))
        .filter((m) => m !== null);
    let pool = explicitResolved.length > 0 ? explicitResolved : modelsForTier(registry, tier);
    // User-pinned allowlist takes precedence — only models the user picked
    // are considered, regardless of detection.
    const allow = config.allowlist;
    if (allow && allow.length > 0) {
        const allowSet = new Set(allow);
        pool = pool.filter((m) => allowSet.has(`${m.provider}/${m.modelID}`));
    }
    // Context-window fit.
    pool = pool.filter((m) => m.ctxWindow >= Math.max(estimatedTokens + 1024, 4096));
    // Drop models we know are down. Falls back to full pool if filter empties
    // (so first-time-ever models still get a probe attempt).
    const healthy = pool.filter((m) => isHealthy(health, healthKey(m.provider, m.modelID)));
    return healthy.length > 0 ? healthy : pool;
}
//# sourceMappingURL=index.js.map