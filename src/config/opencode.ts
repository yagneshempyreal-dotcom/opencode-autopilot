import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
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

export const ROUTER_PROVIDER_KEY = "openauto";
export const ROUTER_MODEL_KEY = "auto";

export interface EnsureRouterResult {
  path: string;
  patched: boolean;
  reason: "missing-file" | "missing-provider" | "port-mismatch" | "already-correct";
}

// Make sure opencode.json declares the openauto provider with the right
// baseURL. Without this entry opencode's model picker doesn't list the
// router, and the user has no way to select it. Idempotent: only writes
// when the file is absent, the provider block is missing, or the cached
// baseURL points to a different port than the live proxy.
export async function ensureRouterProvider(
  port: number,
  path: string = OPENCODE_CONFIG_PATH,
): Promise<EnsureRouterResult> {
  const desiredBaseURL = `http://127.0.0.1:${port}/v1`;
  let cfg: OpencodeConfig = {};
  let reason: EnsureRouterResult["reason"] = "missing-file";
  try {
    cfg = JSON.parse(await readFile(path, "utf8")) as OpencodeConfig;
    reason = "missing-provider";
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") throw err;
  }

  const provider = (cfg.provider ?? {}) as Record<string, OpencodeProviderConfig>;
  const existing = provider[ROUTER_PROVIDER_KEY];
  if (existing) {
    const existingBase = existing.options?.baseURL;
    const hasModel = !!existing.models?.[ROUTER_MODEL_KEY];
    if (hasModel && existingBase === desiredBaseURL) {
      return { path, patched: false, reason: "already-correct" };
    }
    reason = existingBase && existingBase !== desiredBaseURL ? "port-mismatch" : "missing-provider";
  }

  provider[ROUTER_PROVIDER_KEY] = {
    npm: existing?.npm ?? "@ai-sdk/openai-compatible",
    name: (existing as { name?: string } | undefined)?.name ?? "OpenAuto Router",
    options: {
      ...(existing?.options ?? {}),
      baseURL: desiredBaseURL,
      apiKey: existing?.options?.apiKey ?? "no-auth-needed",
    },
    models: {
      [ROUTER_MODEL_KEY]: { name: "OpenAuto" } as { name: string },
      ...(existing?.models ?? {}),
    },
  } as OpencodeProviderConfig;

  cfg.provider = provider;

  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(cfg, null, 2), "utf8");
  const { rename } = await import("node:fs/promises");
  await rename(tmp, path);
  return { path, patched: true, reason };
}
