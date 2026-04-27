import type {
  AutopilotConfig,
  ClassifierResult,
  Complexity,
  Goal,
  ModelEntry,
  RouteDecision,
  Tier,
} from "../types.js";
import { TIER_RANK } from "../types.js";
import type { Registry } from "../registry/index.js";
import { findModel, modelsForTier } from "../registry/index.js";

export interface PolicyInput {
  classification: ClassifierResult;
  config: AutopilotConfig;
  registry: Registry;
  stickyFloor: Tier | null;
  override: { modelRef: string } | null;
  estimatedTokens: number;
}

export const GOAL_MATRIX: Record<Goal, Record<Complexity, Tier>> = {
  cost: { low: "free", medium: "free", high: "cheap-paid" },
  balance: { low: "free", medium: "cheap-paid", high: "top-paid" },
  quality: { low: "cheap-paid", medium: "top-paid", high: "top-paid" },
  custom: { low: "free", medium: "cheap-paid", high: "top-paid" },
};

export const TIER_ESCALATION: Tier[] = ["free", "cheap-paid", "top-paid"];

export function decide(input: PolicyInput): RouteDecision | null {
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
      if (!chosen) continue;
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

export function maxTier(a: Tier, b: Tier | null): Tier {
  if (!b) return a;
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

export function bumpStickyFloor(current: Tier | null, currentEffective?: Tier): Tier {
  const baseRank = Math.max(
    current ? TIER_RANK[current] : -1,
    currentEffective ? TIER_RANK[currentEffective] : -1,
  );
  const nextIdx = Math.min(baseRank + 1, TIER_ESCALATION.length - 1);
  const next = TIER_ESCALATION[Math.max(0, nextIdx)];
  return (next ?? "cheap-paid") as Tier;
}

export function tierLadder(start: Tier): Tier[] {
  const idx = TIER_RANK[start];
  return TIER_ESCALATION.slice(idx);
}

function pickCandidates(
  registry: Registry,
  config: AutopilotConfig,
  tier: Tier,
  estimatedTokens: number,
): ModelEntry[] {
  const explicit = config.tiers[tier] ?? [];
  const explicitResolved = explicit
    .map((id) => findModel(registry, id))
    .filter((m): m is ModelEntry => m !== null);

  const pool = explicitResolved.length > 0 ? explicitResolved : modelsForTier(registry, tier);

  return pool.filter((m) => m.ctxWindow >= Math.max(estimatedTokens + 1024, 4096));
}
