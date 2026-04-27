import type { ModelEntry, Tier, OpenCodeAuth } from "../types.js";
import type { OpencodeConfig } from "../config/opencode.js";
export interface Registry {
    models: ModelEntry[];
    byID: Map<string, ModelEntry>;
    flagged: ModelEntry[];
}
export interface ScanInput {
    auth: OpenCodeAuth;
    opencodeConfig: OpencodeConfig;
    recentModels?: Array<{
        providerID: string;
        modelID: string;
    }>;
    configuredTiers?: Record<string, string[]>;
}
export declare function buildRegistry(input: ScanInput): Registry;
export declare function modelsForTier(reg: Registry, tier: Tier): ModelEntry[];
export declare function findModel(reg: Registry, modelRef: string): ModelEntry | null;
//# sourceMappingURL=index.d.ts.map