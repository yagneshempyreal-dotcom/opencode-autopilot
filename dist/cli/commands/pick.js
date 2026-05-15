import { bootstrap } from "../../bootstrap.js";
import { saveConfig } from "../../config/store.js";
export async function runPick(args) {
    const arg = args.join(" ").trim();
    if (!arg) {
        console.error("Usage: openauto pick clear | all-ok | provider/model, ...");
        process.exit(2);
    }
    const { ctx } = await bootstrap();
    if (/^clear$|^reset$|^none$/i.test(arg)) {
        ctx.config.allowlist = [];
        await saveConfig(ctx.config);
        console.log("✓ pick cleared — full registry eligible.");
        return;
    }
    let picks;
    if (/^all-?ok$/i.test(arg)) {
        picks = Object.entries(ctx.health.records)
            .filter(([, r]) => r.status === "ok")
            .map(([id]) => id);
        if (picks.length === 0) {
            console.log("No models with status=ok. Run `openauto verify` first.");
            return;
        }
    }
    else {
        picks = arg.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    }
    const valid = [];
    const invalid = [];
    for (const id of picks) {
        if (ctx.registry.byID.has(id))
            valid.push(id);
        else
            invalid.push(id);
    }
    if (valid.length === 0) {
        console.error("No valid model IDs. Use provider/modelID. Run `openauto models`.");
        process.exit(2);
    }
    ctx.config.allowlist = valid;
    await saveConfig(ctx.config);
    console.log(`✓ pinned ${valid.length} model(s):`);
    for (const id of valid)
        console.log(`  · ${id}`);
    if (invalid.length > 0)
        console.log(`Skipped: ${invalid.join(", ")}`);
}
//# sourceMappingURL=pick.js.map