import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { logger } from "../util/log.js";
import { autopilotConfigPath } from "../util/paths.js";
import type { AutopilotConfig } from "../types.js";
import { DEFAULT_PORT } from "../types.js";

export const CONFIG_PATH = autopilotConfigPath();

export const DEFAULT_CONFIG: AutopilotConfig = {
  goal: "balance",
  tiers: { free: [], "cheap-paid": [], "top-paid": [] },
  proxy: { port: DEFAULT_PORT, host: "127.0.0.1" },
  ux: { badge: true },
  triage: { enabled: true },
  handover: {
    enabled: true,
    thresholdWarn: 0.7,
    thresholdSave: 0.8,
    thresholdEmergency: 0.92,
    mode: "replace",
    autoResume: false,
    summaryModel: "policy",
  },
};

export async function loadConfig(path: string = CONFIG_PATH): Promise<AutopilotConfig> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<AutopilotConfig>;
    return mergeWithDefaults(parsed);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      return { ...DEFAULT_CONFIG };
    }
    if (e instanceof SyntaxError || (err as Error).message.includes("JSON")) {
      await backupCorrupted(path);
      logger.warn("config corrupted, using defaults", { path });
      return { ...DEFAULT_CONFIG };
    }
    throw err;
  }
}

export async function saveConfig(cfg: AutopilotConfig, path: string = CONFIG_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(cfg, null, 2), "utf8");
  await rename(tmp, path);
}

async function backupCorrupted(path: string): Promise<void> {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await rename(path, `${path}.corrupted.${stamp}`);
  } catch {
    // best-effort
  }
}

function mergeWithDefaults(partial: Partial<AutopilotConfig>): AutopilotConfig {
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    tiers: { ...DEFAULT_CONFIG.tiers, ...(partial.tiers ?? {}) },
    proxy: { ...DEFAULT_CONFIG.proxy, ...(partial.proxy ?? {}) },
    ux: { ...DEFAULT_CONFIG.ux, ...(partial.ux ?? {}) },
    triage: { ...DEFAULT_CONFIG.triage, ...(partial.triage ?? {}) },
    handover: { ...DEFAULT_CONFIG.handover, ...(partial.handover ?? {}) },
  };
}
