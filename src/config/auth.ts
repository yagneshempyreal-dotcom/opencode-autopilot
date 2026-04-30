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

// Conventional env-var names per provider. Keep aligned with registry's
// PROVIDER_BASE_URLS list so any provider opencode supports also resolves
// from env. Order matters — first hit wins.
const PROVIDER_ENV_VARS: Record<string, string[]> = {
  openai: ["OPENAI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  groq: ["GROQ_API_KEY"],
  cerebras: ["CEREBRAS_API_KEY"],
  together: ["TOGETHER_API_KEY", "TOGETHER_AI_API_KEY"],
  zhipuai: ["ZHIPUAI_API_KEY", "ZAI_API_KEY", "BIGMODEL_API_KEY"],
  opencode: ["OPENCODE_API_KEY", "OPENCODE_ZEN_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  xai: ["XAI_API_KEY", "GROK_API_KEY"],
  google: ["GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
  "google-vertex": ["GOOGLE_VERTEX_API_KEY", "GOOGLE_API_KEY"],
  perplexity: ["PERPLEXITY_API_KEY"],
  fireworks: ["FIREWORKS_API_KEY"],
  cohere: ["COHERE_API_KEY"],
  azure: ["AZURE_API_KEY", "AZURE_OPENAI_API_KEY"],
  moonshot: ["MOONSHOT_API_KEY"],
};

// Universe of providers we know how to seed even when absent from auth.json
// and opencode.json — so an env-var-only setup still works.
const KNOWN_PROVIDERS: string[] = Object.keys(PROVIDER_ENV_VARS);

function envVarCandidates(provider: string): string[] {
  const generic = `${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
  const known = PROVIDER_ENV_VARS[provider] ?? [];
  return Array.from(new Set([...known, generic]));
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
    ...KNOWN_PROVIDERS,
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
