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
    if (entry.type === "oauth") {
        // `expires` should be ms-since-epoch, but some providers / older formats may
        // store it in seconds. Heuristic: anything "small" (< 1e12) is treated
        // as seconds and converted to ms.
        if (typeof entry.expires === "number") {
            const expiresMs = oauthExpiresMs(entry.expires);
            // Treat as expired with 30s safety margin.
            if (expiresMs - Date.now() < 30_000)
                return null;
        }
        return entry.access;
    }
    return null;
}
export function isOAuthExpired(entry) {
    if (!entry || entry.type !== "oauth")
        return false;
    if (typeof entry.expires !== "number")
        return false;
    return oauthExpiresMs(entry.expires) - Date.now() < 30_000;
}
function oauthExpiresMs(expires) {
    if (!Number.isFinite(expires))
        return NaN;
    // Current epoch seconds are ~1_700_000_000; current epoch millis are ~1_700_000_000_000.
    // 1e12 is a safe divider between those scales.
    return expires < 1e12 ? expires * 1000 : expires;
}
//# sourceMappingURL=auth.js.map