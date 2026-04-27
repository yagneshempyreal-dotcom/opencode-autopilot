import type { ClassifierResult, ModelEntry, OpenCodeAuth } from "../types.js";
export interface TriageInput {
    prompt: string;
    triageModel: ModelEntry;
    auth: OpenCodeAuth;
}
export declare function triageScore(input: TriageInput): Promise<ClassifierResult>;
//# sourceMappingURL=triage.d.ts.map