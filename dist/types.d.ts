export type Tier = "free" | "cheap-paid" | "top-paid";
export type Goal = "cost" | "quality" | "balance" | "custom";
export type Complexity = "low" | "medium" | "high";
export interface ModelEntry {
    provider: string;
    modelID: string;
    tier: Tier;
    ctxWindow: number;
    supportsStreaming: boolean;
    apiShape: "openai" | "anthropic" | "openrouter" | "opencode";
    baseURL?: string;
}
export interface AutopilotConfig {
    goal: Goal;
    customMapping?: Record<Complexity, string>;
    tiers: Record<Tier, string[]>;
    proxy: {
        port: number;
        host: string;
    };
    ux: {
        badge: boolean;
    };
    triage: {
        enabled: boolean;
    };
    handover: HandoverConfig;
}
export interface HandoverConfig {
    enabled: boolean;
    thresholdWarn: number;
    thresholdSave: number;
    thresholdEmergency: number;
    mode: "replace" | "augment";
    autoResume: boolean;
    summaryModel: "policy" | string;
}
export interface SessionState {
    sessionID: string;
    stickyFloor: Tier | null;
    tokensIn: number;
    tokensOut: number;
    promptCount: number;
    lastModel?: string;
    archived: boolean;
    resumedFrom?: string;
}
export interface ClassifierResult {
    tier: Complexity;
    confidence: number;
    reason: string;
}
export interface RouteDecision {
    modelID: string;
    provider: string;
    tier: Tier;
    reason: string;
    escalated: boolean;
    override: boolean;
}
export interface OpenCodeAuth {
    [provider: string]: AuthEntry;
}
export type AuthEntry = {
    type: "api";
    key: string;
} | {
    type: "oauth";
    access: string;
    refresh: string;
    expires: number;
    accountId?: string;
} | {
    type: "wellknown";
    key: string;
};
export interface ChatMessage {
    role: "system" | "user" | "assistant" | "tool";
    content: string | ChatPart[];
    name?: string;
    tool_call_id?: string;
    tool_calls?: unknown;
}
export interface ChatPart {
    type: string;
    text?: string;
    [k: string]: unknown;
}
export interface ChatCompletionRequest {
    model: string;
    messages: ChatMessage[];
    stream?: boolean;
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    [k: string]: unknown;
}
export declare const DEFAULT_PORT = 4317;
export declare const TIER_RANK: Record<Tier, number>;
//# sourceMappingURL=types.d.ts.map