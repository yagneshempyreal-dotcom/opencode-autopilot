import type { AutopilotConfig, ModelEntry, Tag } from "../types.js";
import type { Registry } from "../registry/index.js";
import type { HealthStore } from "../registry/health.js";
export declare function isPremiumGoal(config: AutopilotConfig): boolean;
/** Explicit premium list, else allowlist (non-free), else tiers top+cheap. */
export declare function premiumModelIds(config: AutopilotConfig): string[];
export declare function freeFallbackModelIds(config: AutopilotConfig, registry: Registry): string[];
export declare function buildPremiumCandidates(registry: Registry, config: AutopilotConfig, estimatedTokens: number, health: HealthStore, taskTags?: Tag[], exclude?: string[]): ModelEntry[];
export declare function buildFreeCandidates(registry: Registry, config: AutopilotConfig, estimatedTokens: number, health: HealthStore, exclude?: string[]): ModelEntry[];
export declare function premiumRetries(config: AutopilotConfig): number;
export declare function premiumFallbackToFree(config: AutopilotConfig): boolean;
//# sourceMappingURL=premium.d.ts.map