import type { ChatCompletionRequest, ModelEntry, OpenCodeAuth } from "../types.js";
export interface ForwardInput {
    request: ChatCompletionRequest;
    model: ModelEntry;
    auth: OpenCodeAuth;
    signal?: AbortSignal;
}
export interface ForwardResult {
    status: number;
    headers: Record<string, string>;
    body: ReadableStream<Uint8Array> | null;
    modelUsed: ModelEntry;
}
export type Forwarder = (input: ForwardInput) => Promise<ForwardResult>;
export declare class ForwardError extends Error {
    status: number;
    detail: string;
    retriable: boolean;
    constructor(status: number, detail: string, retriable: boolean);
}
export declare function isRetriableStatus(status: number): boolean;
/** Premium pool exhausted; host should prompt for `router free` instead of retrying. */
export declare class PremiumExhaustedError extends Error {
    attempts: Array<{
        provider: string;
        modelID: string;
        status: number;
        reason?: string;
    }>;
    constructor(attempts: Array<{
        provider: string;
        modelID: string;
        status: number;
        reason?: string;
    }>);
}
//# sourceMappingURL=types.d.ts.map