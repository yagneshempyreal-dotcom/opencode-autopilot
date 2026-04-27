import { readFile } from "node:fs/promises";
import { logger } from "../util/log.js";
import { authJsonPath } from "../util/paths.js";
export const AUTH_PATH = authJsonPath();
export async function loadAuth(path = AUTH_PATH) {
    try {
        const raw = await readFile(path, "utf8");
        return JSON.parse(raw);
    }
    catch (err) {
        const e = err;
        if (e.code === "ENOENT") {
            logger.warn("auth.json not found", { path });
            return {};
        }
        logger.error("failed to read auth.json", { path, err: err.message });
        throw err;
    }
}
export function getCredential(auth, provider) {
    return auth[provider] ?? null;
}
export function bearerToken(entry) {
    if (!entry)
        return null;
    if (entry.type === "api" || entry.type === "wellknown")
        return entry.key;
    if (entry.type === "oauth")
        return entry.access;
    return null;
}
//# sourceMappingURL=auth.js.map