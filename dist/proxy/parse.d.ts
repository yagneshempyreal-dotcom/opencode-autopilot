import type { ChatCompletionRequest, ChatMessage } from "../types.js";
export interface ParsedRequest {
    request: ChatCompletionRequest;
    override: {
        modelRef: string;
    } | null;
    signals: ParsedSignals;
    sessionID: string;
}
export interface ParsedSignals {
    upgradeRequested: boolean;
    reset: boolean;
    autoOff: boolean;
    autoOn: boolean;
    resumeRequested: boolean;
    goalSwitch: "cost" | "balance" | "quality" | "premium" | null;
    statusRequested: boolean;
    modelsRequested: boolean;
    verifyRequested: boolean;
    pickArg: string | null;
    healthRequested: boolean;
    badgeMode: "quiet" | "verbose" | null;
    /** User accepted free fallback after premium exhaustion (`router free`). */
    freeAccept: boolean;
    /** Return to premium-only routing (`router free off`). */
    freeOff: boolean;
}
export declare function parseRequest(raw: ChatCompletionRequest, sessionIDHeader: string | null): ParsedRequest;
export declare function lastUserIndex(messages: ChatMessage[]): number;
export declare function extractText(content: ChatMessage["content"] | undefined): string;
//# sourceMappingURL=parse.d.ts.map