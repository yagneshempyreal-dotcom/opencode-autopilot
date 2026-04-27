import type { AutopilotConfig } from "../types.js";
export declare const CONFIG_PATH: string;
export declare const DEFAULT_CONFIG: AutopilotConfig;
export declare function loadConfig(path?: string): Promise<AutopilotConfig>;
export declare function saveConfig(cfg: AutopilotConfig, path?: string): Promise<void>;
//# sourceMappingURL=store.d.ts.map