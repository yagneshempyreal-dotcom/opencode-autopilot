import type { AutopilotConfig, ClassifierResult, Complexity, Goal, RouteDecision, Tag, Tier } from "../types.js";
import type { Registry } from "../registry/index.js";
import type { HealthStore } from "../registry/health.js";
export interface PolicyInput {
    classification: ClassifierResult;
    config: AutopilotConfig;
    registry: Registry;
    stickyFloor: Tier | null;
    override: {
        modelRef: string;
    } | null;
    estimatedTokens: number;
    health?: HealthStore;
    taskTags?: Tag[];
}
export declare const GOAL_MATRIX: Record<Goal, Record<Complexity, Tier>>;
export declare const TIER_ESCALATION: Tier[];
export declare function decide(input: PolicyInput): RouteDecision | null;
export declare function maxTier(a: Tier, b: Tier | null): Tier;
export declare function bumpStickyFloor(current: Tier | null, currentEffective?: Tier): Tier;
export declare function tierLadder(start: Tier): Tier[];
//# sourceMappingURL=index.d.ts.map