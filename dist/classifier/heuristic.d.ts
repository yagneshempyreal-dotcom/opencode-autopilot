import type { ChatMessage, ClassifierResult, Complexity } from "../types.js";
export interface HeuristicInput {
    prompt: string;
    contextChars: number;
    attachedFiles: number;
    codeBlockCount: number;
}
export declare function heuristicScore(input: HeuristicInput): ClassifierResult;
export declare function extractHeuristicInput(messages: ChatMessage[]): HeuristicInput;
export declare function lastUserMessage(messages: ChatMessage[]): ChatMessage | null;
export declare function extractText(content: ChatMessage["content"] | undefined): string;
export declare function tierToOrder(t: Complexity): number;
//# sourceMappingURL=heuristic.d.ts.map