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
//# sourceMappingURL=opencode.d.ts.map