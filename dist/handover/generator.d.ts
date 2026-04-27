import type { ChatMessage, ModelEntry, OpenCodeAuth, SessionState } from "../types.js";
export declare function handoverDir(): string;
export declare function handoverIndexPath(): string;
export declare const HANDOVER_DIR: string;
export declare const HANDOVER_INDEX: string;
export interface HandoverInput {
    session: SessionState;
    transcript: ChatMessage[];
    ctxAtSave: number;
    ctxWindow: number;
    goal: string;
    summaryModel: ModelEntry | null;
    auth: OpenCodeAuth;
    emergency: boolean;
}
export interface HandoverResult {
    path: string;
    goalOneliner: string;
    ctxUtilization: number;
}
export declare function generateHandover(input: HandoverInput): Promise<HandoverResult>;
//# sourceMappingURL=generator.d.ts.map