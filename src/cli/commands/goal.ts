import { loadConfig, saveConfig } from "../../config/store.js";
import type { Goal } from "../../types.js";

const GOALS: Goal[] = ["cost", "balance", "quality", "premium", "custom"];

export async function runGoal(args: string[]): Promise<void> {
  const name = args[0]?.toLowerCase();
  if (!name || !GOALS.includes(name as Goal)) {
    console.error(`Usage: openauto goal <${GOALS.join("|")}>`);
    process.exit(2);
  }
  const cfg = await loadConfig();
  const before = cfg.goal;
  cfg.goal = name as Goal;
  await saveConfig(cfg);
  console.log(`✓ goal: ${before} → ${cfg.goal}`);
  if (cfg.goal === "premium") {
    console.log("  Premium mode: expert models first; on exhaustion run `openauto free` in chat or use router free in TUI.");
  }
}
