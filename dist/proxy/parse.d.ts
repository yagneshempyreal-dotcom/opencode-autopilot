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
    goalSwitch: "cost" | "balance" | "quality" | null;
    statusRequested: boolean;
    modelsRequested: boolean;
    verifyRequested: boolean;
    pickArg: string | null;
    healthRequested: boolean;
}
export declare function parseRequest(raw: ChatCompletionRequest, sessionIDHeader: string | null): ParsedRequest;
export declare function lastUserIndex(messages: ChatMessage[]): number;
export declare function extractText(content: ChatMessage["content"] | undefined): string;
//# sourceMappingURL=parse.d.ts.map