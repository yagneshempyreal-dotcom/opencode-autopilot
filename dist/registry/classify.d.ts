import type { Tier, ModelEntry, Tag } from "../types.js";
export declare function classifyModel(provider: string, modelID: string): Tier;
export declare function inferCtxWindow(modelID: string): number;
export declare function inferApiShape(provider: string): ModelEntry["apiShape"];
export declare function isFlaggedAsUnknown(provider: string, modelID: string): boolean;
export declare function inferTags(provider: string, modelID: string): Tag[];
//# sourceMappingURL=classify.d.ts.map