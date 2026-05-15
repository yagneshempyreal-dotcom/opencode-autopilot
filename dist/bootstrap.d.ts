import { type ProxyContext } from "./proxy/context.js";
import type { ModelEntry } from "./types.js";
export interface BootstrapOptions {
    port?: number;
    host?: string;
}
export interface Bootstrapped {
    ctx: ProxyContext;
    autoEnabled: {
        get: () => boolean;
        set: (v: boolean) => void;
    };
}
export declare function loadRecentModels(): Promise<Array<{
    providerID: string;
    modelID: string;
}>>;
export declare function pickTriageModel(models: ModelEntry[]): ModelEntry | null;
/** Load config, auth, registry, and health — shared by plugin and standalone CLI. */
export declare function bootstrap(opts?: BootstrapOptions): Promise<Bootstrapped>;
export declare function warmHealth(ctx: ProxyContext): Promise<void>;
//# sourceMappingURL=bootstrap.d.ts.map