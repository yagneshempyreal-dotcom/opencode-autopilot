import { bootstrap } from "../../bootstrap.js";
import { saveConfig } from "../../config/store.js";
import { verifyAll, saveHealth } from "../../registry/health.js";
import { isPremiumGoal } from "../../policy/premium.js";
export async function runVerify(args) {
    const { ctx } = await bootstrap();
    const text = await formatVerifyReport(ctx, args.includes("--no-pin"));
    console.log(text);
}
export async function formatVerifyReport(ctx, noPin = false) {
    const models = ctx.registry.models;
    if (models.length === 0)
        return "(no models in registry — run `openauto init`)";
    const report = await verifyAll(models, ctx.auth, ctx.health, { concurrency: 4, timeoutMs: 8000 });
    await saveHealth(ctx.health).catch(() => { });
    let autoPinned = false;
    if (!noPin && report.ok.length > 0 && !isPremiumGoal(ctx.config)) {
        ctx.config.allowlist = report.ok;
        await saveConfig(ctx.config).catch(() => { });
        autoPinned = true;
    }
    const lines = [
        `**verify** (${(report.durationMs / 1000).toFixed(1)}s)`,
        "",
        `OK    ${report.ok.length}/${report.total}`,
        `Down  ${report.down.length}/${report.total}`,
        "",
    ];
    if (report.ok.length > 0) {
        lines.push("working:");
        for (const id of report.ok)
            lines.push(`  ✓ ${id}`);
        lines.push("");
    }
    if (report.down.length > 0) {
        lines.push("failing:");
        for (const d of report.down) {
            lines.push(`  ✗ ${d.id}  (status=${d.status}${d.error ? ` · ${d.error.slice(0, 60)}` : ""})`);
        }
        lines.push("");
    }
    if (autoPinned) {
        lines.push(`✓ auto-pinned ${report.ok.length} model(s)`);
        lines.push("Override: `openauto pick clear` or `openauto pick a/b, c/d`");
    }
    else if (isPremiumGoal(ctx.config)) {
        lines.push("(premium goal — not auto-pinning; set `premium.models` in config)");
    }
    return lines.join("\n");
}
//# sourceMappingURL=verify.js.map