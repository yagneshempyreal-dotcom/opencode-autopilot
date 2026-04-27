import { readFile } from "node:fs/promises";
import { logger } from "../util/log.js";
import { authJsonPath } from "../util/paths.js";
import type { OpenCodeAuth, AuthEntry } from "../types.js";

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

export function bearerToken(entry: AuthEntry | null): string | null {
  if (!entry) return null;
  if (entry.type === "api" || entry.type === "wellknown") return entry.key;
  if (entry.type === "oauth") return entry.access;
  return null;
}
