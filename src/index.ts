import type { Plugin, Hooks, PluginInput } from "@opencode-ai/plugin";
import { loadConfig, saveConfig } from "./config/store.js";
import { loadAuth } from "./config/auth.js";
import { loadOpencodeConfig } from "./config/opencode.js";
import { buildRegistry } from "./registry/index.js";
import { startProxy, type ProxyServer } from "./proxy/server.js";
import { ProxyEventBus, type ProxyContext } from "./proxy/context.js";
import { logger } from "./util/log.js";
import { getLastHandover, readHandoverDoc } from "./handover/resume.js";
import type { ModelEntry } from "./types.js";

const ROUTER_PROVIDER_ID = "router";
const ROUTER_MODEL_ID = "auto";

let proxyHandle: ProxyServer | null = null;
let autoEnabled = true;

const plugin: Plugin = async (input: PluginInput): Promise<Hooks> => {
  const [config, auth, opencodeCfg] = await Promise.all([
    loadConfig(),
    loadAuth(),
    loadOpencodeConfig(),
  ]);

  const registry = buildRegistry({ auth, opencodeConfig: opencodeCfg });
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
    logger.warn("registry empty — autopilot will not route. run `opencode-autopilot init` first.");
  }

  if (!proxyHandle) {
    try {
      proxyHandle = await startProxy(ctx);
      ctx.config.proxy.port = proxyHandle.port;
      await saveConfig(ctx.config);
    } catch (err) {
      logger.error("failed to start proxy", { err: (err as Error).message });
    }
  }

  events.on((e) => {
    if (e.type === "handover") {
      logger.info("handover signal", e);
    }
  });

  const hooks: Hooks = {
    config: async (cfg) => {
      if (!proxyHandle) return;
      const port = proxyHandle.port;
      const host = ctx.config.proxy.host;
      const baseURL = `http://${host}:${port}/v1`;
      cfg.provider = cfg.provider ?? {};
      const existing = cfg.provider[ROUTER_PROVIDER_ID] ?? {};
      cfg.provider[ROUTER_PROVIDER_ID] = {
        ...existing,
        npm: existing.npm ?? "@ai-sdk/openai-compatible",
        options: { ...(existing.options ?? {}), baseURL },
        models: { [ROUTER_MODEL_ID]: { name: "Autopilot (auto)" }, ...(existing.models ?? {}) },
      } as never;
    },

    "chat.message": async (info, output) => {
      try {
        const sessionID = info.sessionID;
        if (!sessionID) return;
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
            output.parts.push({ type: "text", text: `\n[router] auto-resume context loaded from ${last.path}\n\n${doc}` } as never);
          }
        }
      } catch (err) {
        logger.warn("chat.message hook error", { err: (err as Error).message });
      }
    },

    "experimental.chat.system.transform": async (input, output) => {
      try {
        const last = await getLastHandover();
        if (last && process.env.OPENCODE_AUTOPILOT_AUTO_RESUME === "1") {
          const doc = await readHandoverDoc(last.path);
          output.system.unshift(`# Resumed session\n\nThe following handover document captures prior session context. Use it to continue seamlessly.\n\n${doc}`);
        }
      } catch (err) {
        logger.debug("system.transform skip", { err: (err as Error).message });
      }
    },

    provider: {
      id: ROUTER_PROVIDER_ID,
      models: async () => {
        return {
          [ROUTER_MODEL_ID]: {
            id: ROUTER_MODEL_ID,
            name: "Autopilot (auto)",
            release_date: new Date().toISOString().slice(0, 10),
            attachment: false,
            cost: { input: 0, output: 0 },
            limit: { context: 200_000, output: 32_000 },
            reasoning: false,
            temperature: true,
            tool_call: true,
          } as never,
        };
      },
    },
  };

  return hooks;
};

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
