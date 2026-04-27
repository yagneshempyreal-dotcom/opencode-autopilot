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
//# sourceMappingURL=types.d.ts.map