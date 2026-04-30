import { readFile } from "node:fs/promises";
import { logger } from "../util/log.js";
import { authJsonPath } from "../util/paths.js";
import type { OpenCodeAuth, AuthEntry } from "../types.js";
import { loadOpencodeConfig, OPENCODE_CONFIG_PATH } from "./opencode.js";

export const AUTH_PATH = authJsonPath();

export async function loadAuth(path: string = AUTH_PATH): Promise<OpenCodeAuth> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as OpenCodeAuth;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      logger.warn("auth.json not found", { path });
      return {};
    }
    logger.error("failed to read auth.json", { path, err: (err as Error).message });
    throw err;
  }
}

export function getCredential(auth: OpenCodeAuth, provider: string): AuthEntry | null {
  return auth[provider] ?? null;
}

function apiKeyFromOpencodeConfig(cfg: unknown, provider: string): string | null {
  try {
    const prov = (cfg as { provider?: Record<string, unknown> } | null | undefined)?.provider;
    const p = prov?.[provider] as { options?: { apiKey?: unknown } } | undefined;
    const key = p?.options?.apiKey;
    return typeof key === "string" && key.trim().length > 0 ? key.trim() : null;
  } catch {
    return null;
  }
}

function envVarCandidates(provider: string): string[] {
  const p = provider.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const out: string[] = [];
  // Common provider-specific names used by SDKs/CLIs.
  if (provider === "openai") out.push("OPENAI_API_KEY");
  if (provider === "openrouter") out.push("OPENROUTER_API_KEY");
  if (provider === "anthropic") out.push("ANTHROPIC_API_KEY");
  if (provider === "deepseek") out.push("DEEPSEEK_API_KEY");
  // Generic fallback.
  out.push(`${p}_API_KEY`);
  return Array.from(new Set(out));
}

function apiKeyFromEnv(provider: string): string | null {
  for (const k of envVarCandidates(provider)) {
    const v = process.env[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

export async function loadEffectiveAuth(opts?: {
  authPath?: string;
  opencodePath?: string;
  baseAuth?: OpenCodeAuth;
}): Promise<OpenCodeAuth> {
  const authPath = opts?.authPath ?? AUTH_PATH;
  const opencodePath = opts?.opencodePath ?? OPENCODE_CONFIG_PATH;
  const auth = await loadAuth(authPath);
  const opencodeCfg = await loadOpencodeConfig(opencodePath).catch(() => ({}) as unknown as Awaited<ReturnType<typeof loadOpencodeConfig>>);

  // Merge strategy (non-destructive):
  // - Prefer baseAuth + auth.json entries (explicit opencode login)
  // - If missing, use opencode.json provider.options.apiKey
  // - If still missing, use env vars (OPENAI_API_KEY, etc.)
  const merged: OpenCodeAuth = { ...(opts?.baseAuth ?? {}), ...auth };
  const providers = new Set<string>([
    "openai",
    "openrouter",
    "anthropic",
    "deepseek",
    ...Object.keys((opencodeCfg.provider ?? {}) as Record<string, unknown>),
    ...Object.keys(merged),
  ]);
  for (const provider of providers) {
    if (merged[provider]) continue;
    const fromCfg = apiKeyFromOpencodeConfig(opencodeCfg, provider);
    if (fromCfg) {
      merged[provider] = { type: "api", key: fromCfg };
      continue;
    }
    const fromEnv = apiKeyFromEnv(provider);
    if (fromEnv) merged[provider] = { type: "api", key: fromEnv };
  }
  return merged;
}

export function bearerToken(entry: AuthEntry | null): string | null {
  if (!entry) return null;
  if (entry.type === "api" || entry.type === "wellknown") return entry.key;
  if (entry.type === "oauth") {
    // `expires` should be ms-since-epoch, but some providers / older formats may
    // store it in seconds. Heuristic: anything "small" (< 1e12) is treated
    // as seconds and converted to ms.
    if (typeof entry.expires === "number") {
      const expiresMs = oauthExpiresMs(entry.expires);
      // Treat as expired with 30s safety margin.
      if (expiresMs - Date.now() < 30_000) return null;
    }
    return entry.access;
  }
  return null;
}

export function isOAuthExpired(entry: AuthEntry | null): boolean {
  if (!entry || entry.type !== "oauth") return false;
  if (typeof entry.expires !== "number") return false;
  return oauthExpiresMs(entry.expires) - Date.now() < 30_000;
}

function oauthExpiresMs(expires: number): number {
  if (!Number.isFinite(expires)) return NaN;
  // Current epoch seconds are ~1_700_000_000; current epoch millis are ~1_700_000_000_000.
  // 1e12 is a safe divider between those scales.
  return expires < 1e12 ? expires * 1000 : expires;
}
