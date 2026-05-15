import { loadConfig, saveConfig } from "./config/store.js";
import { loadAuth, loadEffectiveAuth } from "./config/auth.js";
import { loadOpencodeConfig } from "./config/opencode.js";
import { buildRegistry } from "./registry/index.js";
import { ProxyEventBus } from "./proxy/context.js";
import { loadHealth, saveHealth, verifyAll } from "./registry/health.js";
import { logger } from "./util/log.js";
export async function loadRecentModels() {
    try {
        const { readFile } = await import("node:fs/promises");
        const { homedir } = await import("node:os");
        const { join } = await import("node:path");
        const path = process.env.OPENCODE_MODEL_STATE_PATH ?? join(homedir(), ".local", "state", "opencode", "model.json");
        const raw = await readFile(path, "utf8");
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed.recent))
            return [];
        return parsed.recent.filter((m) => typeof m?.providerID === "string" && typeof m?.modelID === "string");
    }
    catch {
        return [];
    }
}
export function pickTriageModel(models) {
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
/** Load config, auth, registry, and health — shared by plugin and standalone CLI. */
export async function bootstrap(opts = {}) {
    const [config, auth, opencodeCfg, recentModels, health] = await Promise.all([
        loadConfig(),
        loadEffectiveAuth().catch(() => loadAuth()),
        loadOpencodeConfig(),
        loadRecentModels(),
        loadHealth(),
    ]);
    if (typeof opts.port === "number")
        config.proxy.port = opts.port;
    if (opts.host)
        config.proxy.host = opts.host;
    const registry = buildRegistry({
        auth,
        opencodeConfig: opencodeCfg,
        recentModels,
        configuredTiers: config.tiers,
    });
    let autoOn = true;
    const events = new ProxyEventBus();
    const ctx = {
        config,
        registry,
        auth,
        triageModel: pickTriageModel(registry.models),
        events,
        autoEnabled: () => autoOn,
        setAutoEnabled: (v) => { autoOn = v; },
        health,
    };
    return {
        ctx,
        autoEnabled: { get: () => autoOn, set: (v) => { autoOn = v; } },
    };
}
export async function warmHealth(ctx) {
    if (ctx.registry.models.length === 0)
        return;
    logger.info("background verify starting", { models: ctx.registry.models.length });
    const report = await verifyAll(ctx.registry.models, ctx.auth, ctx.health, {
        concurrency: 4,
        timeoutMs: 8000,
    });
    await saveHealth(ctx.health).catch(() => { });
    const userPinned = (ctx.config.allowlist?.length ?? 0) > 0 &&
        !ctx.config.allowlist?.every((id) => report.ok.includes(id) || ctx.health.records[id]?.status === "down");
    if (!userPinned && report.ok.length > 0 && ctx.config.goal !== "premium") {
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
//# sourceMappingURL=bootstrap.js.map