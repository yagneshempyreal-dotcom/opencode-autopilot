import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { opencodeJsonPath } from "../util/paths.js";
export const OPENCODE_CONFIG_PATH = opencodeJsonPath();
export async function loadOpencodeConfig(path = OPENCODE_CONFIG_PATH) {
    try {
        const raw = await readFile(path, "utf8");
        return JSON.parse(raw);
    }
    catch (err) {
        const e = err;
        if (e.code === "ENOENT")
            return {};
        throw err;
    }
}
export const ROUTER_PROVIDER_KEY = "openauto";
export const ROUTER_MODEL_KEY = "auto";
// Make sure opencode.json declares the openauto provider with the right
// baseURL. Without this entry opencode's model picker doesn't list the
// router, and the user has no way to select it. Idempotent: only writes
// when the file is absent, the provider block is missing, or the cached
// baseURL points to a different port than the live proxy.
export async function ensureRouterProvider(port, path = OPENCODE_CONFIG_PATH) {
    const desiredBaseURL = `http://127.0.0.1:${port}/v1`;
    let cfg = {};
    let reason = "missing-file";
    try {
        cfg = JSON.parse(await readFile(path, "utf8"));
        reason = "missing-provider";
    }
    catch (err) {
        const e = err;
        if (e.code !== "ENOENT")
            throw err;
    }
    const provider = (cfg.provider ?? {});
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
        name: existing?.name ?? "OpenAuto Router",
        options: {
            ...(existing?.options ?? {}),
            baseURL: desiredBaseURL,
            apiKey: existing?.options?.apiKey ?? "no-auth-needed",
        },
        models: {
            [ROUTER_MODEL_KEY]: { name: "OpenAuto" },
            ...(existing?.models ?? {}),
        },
    };
    cfg.provider = provider;
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(cfg, null, 2), "utf8");
    const { rename } = await import("node:fs/promises");
    await rename(tmp, path);
    return { path, patched: true, reason };
}
//# sourceMappingURL=opencode.js.map