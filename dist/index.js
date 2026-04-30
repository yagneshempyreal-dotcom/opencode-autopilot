import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig, saveConfig } from "./config/store.js";
import { loadAuth, loadEffectiveAuth } from "./config/auth.js";
import { loadOpencodeConfig, ensureRouterProvider } from "./config/opencode.js";
import { buildRegistry } from "./registry/index.js";
import { startProxy } from "./proxy/server.js";
import { ProxyEventBus } from "./proxy/context.js";
import { logger } from "./util/log.js";
import { autopilotLogPath } from "./util/paths.js";
import { getLastHandover, readHandoverDoc } from "./handover/resume.js";
import { loadHealth, saveHealth, verifyAll } from "./registry/health.js";
// Top-level diagnostic: if we see this in autopilot.log, opencode imported our
// module. If we see "plugin function called" later, opencode also invoked our
// Plugin function. If both are missing, opencode never loaded the package.
(() => {
    try {
        const path = autopilotLogPath();
        mkdirSync(dirname(path), { recursive: true });
        appendFileSync(path, JSON.stringify({
            ts: new Date().toISOString(),
            level: "info",
            msg: "module imported",
            pid: process.pid,
            runtime: typeof globalThis.Bun !== "undefined" ? "bun" : "node",
        }) + "\n");
    }
    catch { /* never throw at module load */ }
})();
const ROUTER_PROVIDER_ID = "openauto";
const ROUTER_MODEL_ID = "auto";
let proxyHandle = null;
let autoEnabled = true;
const plugin = async (_input) => {
    try {
        try {
            const path = autopilotLogPath();
            appendFileSync(path, JSON.stringify({
                ts: new Date().toISOString(),
                level: "info",
                msg: "plugin function called",
                pid: process.pid,
            }) + "\n");
        }
        catch { /* */ }
        // Use effective auth (auth.json + opencode.json provider.options.apiKey
        // + env vars) so the registry sees every provider the user has any
        // credential for — not just opencode-login entries. This is what makes
        // env-var-only setups (OPENAI_API_KEY etc) light up at startup.
        const [config, auth, opencodeCfg, recentModels, health] = await Promise.all([
            loadConfig(),
            loadEffectiveAuth().catch(() => loadAuth()),
            loadOpencodeConfig(),
            loadRecentModels(),
            loadHealth(),
        ]);
        const registry = buildRegistry({
            auth,
            opencodeConfig: opencodeCfg,
            recentModels,
            configuredTiers: config.tiers,
        });
        const triageModel = pickTriageModel(registry.models);
        const events = new ProxyEventBus();
        const ctx = {
            config,
            registry,
            auth,
            triageModel,
            events,
            autoEnabled: () => autoEnabled,
            setAutoEnabled: (v) => { autoEnabled = v; },
            health,
        };
        if (registry.models.length === 0) {
            logger.warn("registry empty — autopilot will not route. run `opencode-openauto init` first.");
        }
        if (!proxyHandle) {
            try {
                const requestedPort = ctx.config.proxy.port;
                proxyHandle = await startProxy(ctx);
                // Track the actual port in memory so the config hook can patch
                // opencode.json's openauto baseURL correctly. Persist back to
                // disk only if the request matched (= user explicitly chose port);
                // otherwise leave config alone so we re-try the requested port
                // next launch instead of getting stuck on a fallback.
                ctx.config.proxy.port = proxyHandle.port;
                if (proxyHandle.port === requestedPort) {
                    await saveConfig(ctx.config);
                }
                logger.info("autopilot proxy ready", {
                    port: proxyHandle.port,
                    requested: requestedPort,
                    ...(proxyHandle.port !== requestedPort ? { note: "fallback — not persisted" } : {}),
                });
                // Make sure opencode.json declares the openauto provider on the
                // live port. Without this users don't see "OpenAuto Router" in
                // the model picker — the in-memory config hook isn't enough on
                // some opencode versions.
                try {
                    const r = await ensureRouterProvider(proxyHandle.port);
                    if (r.patched)
                        logger.info("patched opencode.json", { reason: r.reason, path: r.path });
                }
                catch (err) {
                    logger.warn("failed to patch opencode.json", { err: err.message });
                }
            }
            catch (err) {
                logger.error("failed to start proxy", { err: err.message });
            }
        }
        // Background warm-up: probe every model on every startup so the
        // user's first prompt routes straight to a working model instead of
        // cascading through dead/expired ones. Doesn't block plugin init —
        // runs detached. Set OPENCODE_OPENAUTO_SKIP_VERIFY=1 to disable.
        if (process.env.OPENCODE_OPENAUTO_SKIP_VERIFY !== "1") {
            queueMicrotask(() => {
                void warmHealth(ctx).catch((err) => {
                    logger.warn("background verify failed", { err: err.message });
                });
            });
        }
        events.on((e) => {
            if (e.type === "handover")
                logger.info("handover signal", e);
        });
        const hooks = {
            config: async (cfg) => {
                try {
                    if (!proxyHandle)
                        return;
                    const port = proxyHandle.port;
                    const host = ctx.config.proxy.host;
                    const baseURL = `http://${host}:${port}/v1`;
                    const providerMap = (cfg.provider ?? {});
                    const existing = (providerMap[ROUTER_PROVIDER_ID] ?? {});
                    const existingOptions = (existing.options ?? {});
                    providerMap[ROUTER_PROVIDER_ID] = {
                        ...existing,
                        npm: existing.npm ?? "@ai-sdk/openai-compatible",
                        name: existing.name ?? "OpenAuto Router",
                        options: {
                            ...existingOptions,
                            baseURL,
                            apiKey: existingOptions.apiKey ?? "no-auth-needed",
                        },
                        models: {
                            [ROUTER_MODEL_ID]: { name: "OpenAuto" },
                            ...(existing.models ?? {}),
                        },
                    };
                    cfg.provider = providerMap;
                }
                catch (err) {
                    logger.warn("config hook error", { err: err.message });
                }
            },
            "chat.message": async (info, output) => {
                try {
                    if (!info.sessionID)
                        return;
                    const parts = output.parts ?? [];
                    const text = parts
                        .map((p) => {
                        const candidate = p;
                        return typeof candidate.text === "string" ? candidate.text : "";
                    })
                        .join("\n");
                    if (/\/router\s+resume\b/i.test(text)) {
                        const last = await getLastHandover();
                        if (last) {
                            const doc = await readHandoverDoc(last.path);
                            const note = `\n[router] auto-resume context loaded from ${last.path}\n\n${doc}`;
                            output.parts.push({ type: "text", text: note });
                        }
                    }
                }
                catch (err) {
                    logger.warn("chat.message hook error", { err: err.message });
                }
            },
        };
        return hooks;
    }
    catch (err) {
        logger.error("plugin init failed (returning empty hooks)", {
            err: err.message,
            stack: err.stack,
        });
        return {};
    }
};
// Probe every registry model in the background and auto-pin the OK set
// so the first real request goes directly to a working model without
// cascading through dead ones. Runs on every plugin start.
async function warmHealth(ctx) {
    if (ctx.registry.models.length === 0)
        return;
    logger.info("background verify starting", { models: ctx.registry.models.length });
    const report = await verifyAll(ctx.registry.models, ctx.auth, ctx.health, {
        concurrency: 4,
        timeoutMs: 8000,
    });
    await saveHealth(ctx.health).catch(() => { });
    // Auto-pin only when the user hasn't already curated a list.
    const userPinned = (ctx.config.allowlist?.length ?? 0) > 0 &&
        !ctx.config.allowlist?.every((id) => report.ok.includes(id) || ctx.health.records[id]?.status === "down");
    if (!userPinned && report.ok.length > 0) {
        ctx.config.allowlist = report.ok;
        await saveConfig(ctx.config).catch(() => { });
        logger.info("auto-pinned ok models", { count: report.ok.length });
    }
    logger.info("background verify done", {
        ok: report.ok.length,
        down: report.down.length,
        pinned: ctx.config.allowlist?.length ?? 0,
        durationMs: report.durationMs,
    });
}
async function loadRecentModels() {
    try {
        const { readFile } = await import("node:fs/promises");
        const { homedir } = await import("node:os");
        const { join } = await import("node:path");
        const path = process.env.OPENCODE_MODEL_STATE_PATH ?? join(homedir(), ".local", "state", "opencode", "model.json");
        const raw = await readFile(path, "utf8");
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed.recent))
            return [];
        return parsed.recent
            .filter((m) => typeof m?.providerID === "string" && typeof m?.modelID === "string");
    }
    catch {
        return [];
    }
}
function pickTriageModel(models) {
    const free = models.filter((m) => m.tier === "free");
    if (free.length === 0)
        return null;
    const ranked = free.sort((a, b) => {
        const aSmall = /(nano|mini|tiny|small|flash|haiku)/i.test(a.modelID) ? 0 : 1;
        const bSmall = /(nano|mini|tiny|small|flash|haiku)/i.test(b.modelID) ? 0 : 1;
        return aSmall - bSmall;
    });
    return ranked[0] ?? null;
}
export default plugin;
export { plugin };
export const server = plugin;
//# sourceMappingURL=index.js.map