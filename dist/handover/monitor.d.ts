import type { HandoverConfig } from "../types.js";
export type HandoverLevel = "ok" | "warn" | "save" | "emergency";
export declare function evaluate(utilization: number, cfg: HandoverConfig): HandoverLevel;
export declare function shouldTriggerSave(level: HandoverLevel): boolean;
//# sourceMappingURL=monitor.d.ts.map