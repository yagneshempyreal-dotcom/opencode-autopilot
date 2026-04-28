import type { ModelEntry, OpenCodeAuth } from "../types.js";
export type HealthStatus = "ok" | "down" | "unknown";
export interface HealthRecord {
    status: HealthStatus;
    lastChecked: number;
    lastOk?: number;
    consecutiveFails: number;
    lastError?: string;
    latencyMs?: number;
}
export interface HealthStore {
    records: Record<string, HealthRecord>;
}
export declare const DOWN_RETRY_MS: number;
export declare const OK_TTL_MS: number;
export declare function healthPath(): string;
export declare function emptyStore(): HealthStore;
export declare function loadHealth(path?: string): Promise<HealthStore>;
export declare function saveHealth(store: HealthStore, path?: string): Promise<void>;
export declare function key(provider: string, modelID: string): string;
export declare function markOk(store: HealthStore, k: string, latencyMs?: number): void;
export declare function markDown(store: HealthStore, k: string, reason: string): void;
export declare function isHealthy(store: HealthStore, k: string, now?: number): boolean;
export declare function knownDown(store: HealthStore): string[];
export interface ProbeResult {
    ok: boolean;
    latencyMs: number;
    status: number;
    error?: string;
}
export declare function probeModel(model: ModelEntry, auth: OpenCodeAuth, timeoutMs?: number): Promise<ProbeResult>;
export interface VerifyReport {
    total: number;
    ok: string[];
    down: Array<{
        id: string;
        status: number;
        error?: string;
    }>;
    durationMs: number;
}
export declare function verifyAll(models: ModelEntry[], auth: OpenCodeAuth, store: HealthStore, opts?: {
    concurrency?: number;
    timeoutMs?: number;
}): Promise<VerifyReport>;
//# sourceMappingURL=health.d.ts.map