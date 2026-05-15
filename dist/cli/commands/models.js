import { bootstrap } from "../../bootstrap.js";
import { modelsForTier } from "../../registry/index.js";
export async function runModels() {
    const { ctx } = await bootstrap();
    console.log(`goal: ${ctx.config.goal}\n`);
    for (const tier of ["free", "cheap-paid", "top-paid"]) {
        const ms = modelsForTier(ctx.registry, tier);
        console.log(`${tier} (${ms.length}):`);
        if (ms.length === 0) {
            console.log("  · (none)");
        }
        else {
            for (const m of ms.slice(0, 20))
                console.log(`  · ${m.provider}/${m.modelID}`);
            if (ms.length > 20)
                console.log(`  · …+${ms.length - 20} more`);
        }
        console.log("");
    }
    const premium = ctx.config.premium?.models;
    if (premium && premium.length > 0) {
        console.log(`premium.models (${premium.length}):`);
        for (const id of premium)
            console.log(`  · ${id}`);
    }
}
//# sourceMappingURL=models.js.map