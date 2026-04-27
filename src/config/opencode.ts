import { readFile } from "node:fs/promises";
import { opencodeJsonPath } from "../util/paths.js";

export const OPENCODE_CONFIG_PATH = opencodeJsonPath();

export interface OpencodeConfig {
  $schema?: string;
  model?: string;
  provider?: Record<string, OpencodeProviderConfig>;
  plugin?: Array<string | [string, Record<string, unknown>]>;
  [k: string]: unknown;
}

export interface OpencodeProviderConfig {
  npm?: string;
  options?: { baseURL?: string; [k: string]: unknown };
  models?: Record<string, { id?: string; ctx?: number }>;
  [k: string]: unknown;
}

export async function loadOpencodeConfig(path: string = OPENCODE_CONFIG_PATH): Promise<OpencodeConfig> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as OpencodeConfig;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return {};
    throw err;
  }
}
