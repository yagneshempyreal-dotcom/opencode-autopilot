import type { ChatCompletionRequest, OpenCodeAuth, RouteDecision } from "../types.js";
import type { Registry } from "../registry/index.js";
import type { ForwardResult } from "./types.js";
export interface DispatchInput {
    decision: RouteDecision;
    request: ChatCompletionRequest;
    registry: Registry;
    auth: OpenCodeAuth;
    signal?: AbortSignal;
    allowEscalation: boolean;
}
export interface DispatchResult extends ForwardResult {
    attempts: Array<{
        provider: string;
        modelID: string;
        status: number;
        reason?: string;
    }>;
    escalated: boolean;
}
export declare function dispatch(input: DispatchInput): Promise<DispatchResult>;
//# sourceMappingURL=index.d.ts.map