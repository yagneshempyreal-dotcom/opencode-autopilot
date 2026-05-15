import { bootstrap } from "../../bootstrap.js";
export async function runHealth() {
    const { ctx } = await bootstrap();
    const records = Object.entries(ctx.health.records);
    if (records.length === 0) {
        console.log("(no health records — run `openauto verify`)");
        return;
    }
    records.sort(([a], [b]) => a.localeCompare(b));
    console.log(`health (${records.length} records)\n`);
    for (const [id, r] of records) {
        const ageMs = Date.now() - r.lastChecked;
        const age = ageMs < 60_000 ? `${Math.round(ageMs / 1000)}s` : `${Math.round(ageMs / 60_000)}m`;
        const sym = r.status === "ok" ? "✓" : r.status === "down" ? "✗" : "?";
        const lat = r.latencyMs ? ` ${r.latencyMs}ms` : "";
        const reason = r.lastError ? `  ${r.lastError.slice(0, 80)}` : "";
        console.log(`  ${sym} ${id}${lat}  (${age} ago)${reason}`);
    }
}
//# sourceMappingURL=health.js.map