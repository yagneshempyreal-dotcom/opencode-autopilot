import type { Plugin, Hooks, PluginInput } from "@opencode-ai/plugin";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { saveConfig } from "./config/store.js";
import { ensureRouterProvider } from "./config/opencode.js";
import { startProxy, type ProxyServer } from "./proxy/server.js";
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
      runtime: typeof (globalThis as unknown as { Bun?: unknown }).Bun !== "undefined" ? "bun" : "node",
    }) + "\n");
  } catch { /* never throw at module load */ }
})();

const ROUTER_PROVIDER_ID = "openauto";
const ROUTER_MODEL_ID = "auto";

let proxyHandle: ProxyServer | null = null;

const plugin: Plugin = async (_input: PluginInput): Promise<Hooks> => {
  try {
    try {
      const path = autopilotLogPath();
      appendFileSync(path, JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        msg: "plugin function called",
        pid: process.pid,
      }) + "\n");
    } catch { /* */ }

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
          if (r.patched) logger.info("patched opencode.json", { reason: r.reason, path: r.path });
        } catch (err) {
          logger.warn("failed to patch opencode.json", { err: (err as Error).message });
        }
      } catch (err) {
        logger.error("failed to start proxy", { err: (err as Error).message });
      }
    }

    if (process.env.OPENCODE_OPENAUTO_SKIP_VERIFY !== "1") {
      queueMicrotask(() => {
        void warmHealth(ctx).catch((err) => {
          logger.warn("background verify failed", { err: (err as Error).message });
        });
      });
    }

    const hooks: Hooks = {
      config: async (cfg) => {
        try {
          if (!proxyHandle) return;
          const port = proxyHandle.port;
          const host = ctx.config.proxy.host;
          const baseURL = `http://${host}:${port}/v1`;
          const providerMap = (cfg.provider ?? {}) as Record<string, unknown>;
          const existing = (providerMap[ROUTER_PROVIDER_ID] ?? {}) as Record<string, unknown>;
          const existingOptions = (existing.options ?? {}) as Record<string, unknown>;
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
              ...((existing.models as Record<string, unknown>) ?? {}),
            },
          };
          (cfg as { provider?: Record<string, unknown> }).provider = providerMap;
        } catch (err) {
          logger.warn("config hook error", { err: (err as Error).message });
        }
      },

      "chat.message": async (info, output) => {
        try {
          if (!info.sessionID) return;
          const parts = output.parts ?? [];
          const text = parts
            .map((p) => {
              const candidate = p as { text?: unknown };
              return typeof candidate.text === "string" ? candidate.text : "";
            })
            .join("\n");
          if (/\/router\s+resume\b/i.test(text)) {
            const last = await getLastHandover();
            if (last) {
              const doc = await readHandoverDoc(last.path);
              const note = `\n[router] auto-resume context loaded from ${last.path}\n\n${doc}`;
              (output.parts as Array<Record<string, unknown>>).push({ type: "text", text: note });
            }
          }
        } catch (err) {
          logger.warn("chat.message hook error", { err: (err as Error).message });
        }
      },
    };

    return hooks;
  } catch (err) {
    logger.error("plugin init failed (returning empty hooks)", {
      err: (err as Error).message,
      stack: (err as Error).stack,
    });
    return {};
  }
};

export default plugin;
export { plugin };
export const server = plugin;
