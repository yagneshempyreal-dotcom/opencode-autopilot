import type { AutopilotConfig, ModelEntry, OpenCodeAuth } from "../types.js";
import type { Registry } from "../registry/index.js";
import type { HealthStore } from "../registry/health.js";

export interface ProxyContext {
  config: AutopilotConfig;
  registry: Registry;
  auth: OpenCodeAuth;
  triageModel: ModelEntry | null;
  events: ProxyEventBus;
  autoEnabled: () => boolean;
  setAutoEnabled: (v: boolean) => void;
  health: HealthStore;
}

export type ProxyEvent =
  | { type: "route"; sessionID: string; modelID: string; tier: string; escalated: boolean }
  | { type: "sticky-bump"; sessionID: string; from: string | null; to: string }
  | { type: "ctx"; sessionID: string; utilization: number; modelID: string }
  | { type: "handover"; sessionID: string; reason: string }
  | { type: "error"; sessionID?: string; message: string };

export class ProxyEventBus {
  private listeners: Array<(e: ProxyEvent) => void> = [];

  on(listener: (e: ProxyEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  emit(e: ProxyEvent): void {
    for (const l of this.listeners) {
      try { l(e); } catch { /* ignore listener errors */ }
    }
  }
}
