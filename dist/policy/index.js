import { TIER_RANK } from "../types.js";
import { findModel, modelsForTier } from "../registry/index.js";
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
    let escalated = false;
    for (const tier of ladder) {
        const candidates = pickCandidates(input.registry, input.config, tier, input.estimatedTokens);
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
function pickCandidates(registry, config, tier, estimatedTokens) {
    const explicit = config.tiers[tier] ?? [];
    const explicitResolved = explicit
        .map((id) => findModel(registry, id))
        .filter((m) => m !== null);
    const pool = explicitResolved.length > 0 ? explicitResolved : modelsForTier(registry, tier);
    return pool.filter((m) => m.ctxWindow >= Math.max(estimatedTokens + 1024, 4096));
}
//# sourceMappingURL=index.js.map