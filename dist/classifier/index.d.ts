import type { ChatMessage, ClassifierResult, Goal, ModelEntry, OpenCodeAuth } from "../types.js";
import { extractHeuristicInput, heuristicScore } from "./heuristic.js";
export interface ClassifyInput {
    messages: ChatMessage[];
    goal: Goal;
    triageEnabled: boolean;
    triageModel: ModelEntry | null;
    auth: OpenCodeAuth;
    confidenceFloor?: number;
}
export declare function classify(input: ClassifyInput): Promise<ClassifierResult>;
export { heuristicScore, extractHeuristicInput };
//# sourceMappingURL=index.d.ts.map