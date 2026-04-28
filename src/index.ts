import type { Plugin, Hooks, PluginInput } from "@opencode-ai/plugin";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig, saveConfig } from "./config/store.js";
import { loadAuth } from "./config/auth.js";
import { loadOpencodeConfig } from "./config/opencode.js";
import { buildRegistry } from "./registry/index.js";
import { startProxy, type ProxyServer } from "./proxy/server.js";
import { ProxyEventBus, type ProxyContext } from "./proxy/context.js";
import { logger } from "./util/log.js";
import { autopilotLogPath } from "./util/paths.js";
import { getLastHandover, readHandoverDoc } from "./handover/resume.js";
import type { ModelEntry } from "./types.js";

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
      runtime: typeof (globalThis as unknown as { Bun?: unknown }).Bun !== "undefined" ? "bun" : "node",
    }) + "\n");
  } catch { /* never throw at module load */ }
})();

const ROUTER_PROVIDER_ID = "openauto";
const ROUTER_MODEL_ID = "auto";

let proxyHandle: ProxyServer | null = null;
let autoEnabled = true;

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
    const [config, auth, opencodeCfg, recentModels] = await Promise.all([
      loadConfig(),
      loadAuth(),
      loadOpencodeConfig(),
      loadRecentModels(),
    ]);

    const registry = buildRegistry({
      auth,
      opencodeConfig: opencodeCfg,
      recentModels,
      configuredTiers: config.tiers,
    });
    const triageModel = pickTriageModel(registry.models);

    const events = new ProxyEventBus();
    const ctx: ProxyContext = {
      config,
      registry,
      auth,
      triageModel,
      events,
      autoEnabled: () => autoEnabled,
      setAutoEnabled: (v) => { autoEnabled = v; },
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
      } catch (err) {
        logger.error("failed to start proxy", { err: (err as Error).message });
      }
    }

    events.on((e) => {
      if (e.type === "handover") logger.info("handover signal", e);
    });

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

async function loadRecentModels(): Promise<Array<{ providerID: string; modelID: string }>> {
  try {
    const { readFile } = await import("node:fs/promises");
    const { homedir } = await import("node:os");
    const { join } = await import("node:path");
    const path = process.env.OPENCODE_MODEL_STATE_PATH ?? join(homedir(), ".local", "state", "opencode", "model.json");
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as { recent?: Array<{ providerID?: string; modelID?: string }> };
    if (!Array.isArray(parsed.recent)) return [];
    return parsed.recent
      .filter((m): m is { providerID: string; modelID: string } => typeof m?.providerID === "string" && typeof m?.modelID === "string");
  } catch {
    return [];
  }
}

function pickTriageModel(models: ModelEntry[]): ModelEntry | null {
  const free = models.filter((m) => m.tier === "free");
  if (free.length === 0) return null;
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
