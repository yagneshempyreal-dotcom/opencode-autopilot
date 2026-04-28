export declare const OPENCODE_CONFIG_PATH: string;
export interface OpencodeConfig {
    $schema?: string;
    model?: string;
    provider?: Record<string, OpencodeProviderConfig>;
    plugin?: Array<string | [string, Record<string, unknown>]>;
    [k: string]: unknown;
}
export interface OpencodeProviderConfig {
    npm?: string;
    options?: {
        baseURL?: string;
        [k: string]: unknown;
    };
    models?: Record<string, {
        id?: string;
        ctx?: number;
    }>;
    [k: string]: unknown;
}
export declare function loadOpencodeConfig(path?: string): Promise<OpencodeConfig>;
export declare const ROUTER_PROVIDER_KEY = "openauto";
export declare const ROUTER_MODEL_KEY = "auto";
export interface EnsureRouterResult {
    path: string;
    patched: boolean;
    reason: "missing-file" | "missing-provider" | "port-mismatch" | "already-correct";
}
export declare function ensureRouterProvider(port: number, path?: string): Promise<EnsureRouterResult>;
//# sourceMappingURL=opencode.d.ts.map