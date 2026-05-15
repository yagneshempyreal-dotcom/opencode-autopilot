import { bootstrap, warmHealth } from "../../bootstrap.js";
import { loadConfig, saveConfig } from "../../config/store.js";
import { ensureRouterProvider } from "../../config/opencode.js";
import { startProxy } from "../../proxy/server.js";
import { flag, hasFlag } from "../args.js";
export async function runServe(args) {
    const fileCfg = await loadConfig();
    const portRaw = flag(args, "port");
    const port = portRaw ? Number(portRaw) : fileCfg.proxy.port;
    if (!Number.isFinite(port) || port < 0 || port > 65535) {
        throw new Error(`invalid --port=${portRaw}`);
    }
    const { ctx } = await bootstrap({ port });
    const requested = ctx.config.proxy.port;
    const patchOpencode = !hasFlag(args, "no-opencode-patch");
    const skipVerify = hasFlag(args, "skip-verify") || process.env.OPENCODE_OPENAUTO_SKIP_VERIFY === "1";
    const server = await startProxy(ctx);
    if (server.port !== requested) {
        ctx.config.proxy.port = server.port;
        if (requested !== 0)
            await saveConfig(ctx.config).catch(() => { });
    }
    else if (requested !== 0) {
        await saveConfig(ctx.config).catch(() => { });
    }
    if (patchOpencode) {
        try {
            const r = await ensureRouterProvider(server.port);
            if (r.patched)
                console.log(`✓ patched opencode.json (${r.reason})`);
        }
        catch (err) {
            console.warn(`⚠ could not patch opencode.json: ${err.message}`);
        }
    }
    if (!skipVerify) {
        void warmHealth(ctx).catch((err) => {
            console.warn(`background verify failed: ${err.message}`);
        });
    }
    const base = `http://${ctx.config.proxy.host}:${server.port}`;
    console.log(`
OpenAuto router running (standalone)

  API:     ${base}/v1
  Health:  ${base}/health
  Model:   auto

Point any OpenAI-compatible client here, or run:
  openauto chat "your prompt"
  openauto setup

Press Ctrl+C to stop.
`);
    const shutdown = async () => {
        console.log("\nShutting down…");
        await server.close();
        process.exit(0);
    };
    process.on("SIGINT", () => { void shutdown(); });
    process.on("SIGTERM", () => { void shutdown(); });
    await new Promise(() => { });
}
//# sourceMappingURL=serve.js.map