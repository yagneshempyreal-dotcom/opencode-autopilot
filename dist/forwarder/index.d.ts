import type { AutopilotConfig, ChatCompletionRequest, ModelEntry, OpenCodeAuth, RouteDecision } from "../types.js";
import type { Registry } from "../registry/index.js";
import type { ForwardResult } from "./types.js";
import { PremiumExhaustedError } from "./types.js";
import type { HealthStore } from "../registry/health.js";
export interface DispatchInput {
    decision: RouteDecision;
    request: ChatCompletionRequest;
    registry: Registry;
    auth: OpenCodeAuth;
    config?: AutopilotConfig;
    signal?: AbortSignal;
    allowEscalation: boolean;
    health?: HealthStore;
    exclude?: string[];
    /** Session opted into free models after premium exhaustion (`router free`). */
    freeModeActive?: boolean;
    perAttemptTimeoutMs?: number;
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
export { PremiumExhaustedError };
export declare function injectIdentityPrompt(request: ChatCompletionRequest, model: ModelEntry): ChatCompletionRequest;
//# sourceMappingURL=index.d.ts.map