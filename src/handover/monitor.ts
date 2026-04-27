import type { HandoverConfig } from "../types.js";

export type HandoverLevel = "ok" | "warn" | "save" | "emergency";

export function evaluate(utilization: number, cfg: HandoverConfig): HandoverLevel {
  if (!cfg.enabled) return utilization >= cfg.thresholdEmergency ? "emergency" : "ok";
  if (utilization >= cfg.thresholdEmergency) return "emergency";
  if (utilization >= cfg.thresholdSave) return "save";
  if (utilization >= cfg.thresholdWarn) return "warn";
  return "ok";
}

export function shouldTriggerSave(level: HandoverLevel): boolean {
  return level === "save" || level === "emergency";
}
