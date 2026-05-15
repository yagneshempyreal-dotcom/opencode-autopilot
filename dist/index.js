import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { saveConfig } from "./config/store.js";
import { ensureRouterProvider } from "./config/opencode.js";
import { startProxy } from "./proxy/server.js";
import { logger } from "./util/log.js";
import { autopilotLogPath } from "./util/paths.js";
import { getLastHandover, readHandoverDoc } from "./handover/resume.js";
import { bootstrap, warmHealth } from "./bootstrap.js";
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
        const { ctx } = await bootstrap();
        if (ctx.registry.models.length === 0) {
            logger.warn("registry empty — autopilot will not route. run `openauto init` first.");
        }
        if (!proxyHandle) {
            try {
                const requested = ctx.config.proxy.port;
                proxyHandle = await startProxy(ctx);
                ctx.config.proxy.port = proxyHandle.port;
                if (proxyHandle.port === requested) {
                    await saveConfig(ctx.config);
                }
                logger.info("autopilot proxy ready", {
                    port: proxyHandle.port,
                    requested,
                    ...(proxyHandle.port !== requested ? { note: "fallback — not persisted" } : {}),
                });
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
        if (process.env.OPENCODE_OPENAUTO_SKIP_VERIFY !== "1") {
            queueMicrotask(() => {
                void warmHealth(ctx).catch((err) => {
                    logger.warn("background verify failed", { err: err.message });
                });
            });
        }
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
export default plugin;
export { plugin };
export const server = plugin;
//# sourceMappingURL=index.js.map