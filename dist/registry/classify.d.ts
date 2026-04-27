import type { Tier, ModelEntry } from "../types.js";
export declare function classifyModel(provider: string, modelID: string): Tier;
export declare function inferCtxWindow(modelID: string): number;
export declare function inferApiShape(provider: string): ModelEntry["apiShape"];
export declare function isFlaggedAsUnknown(provider: string, modelID: string): boolean;
//# sourceMappingURL=classify.d.ts.map