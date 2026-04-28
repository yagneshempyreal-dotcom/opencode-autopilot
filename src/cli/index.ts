#!/usr/bin/env node
import { loadConfig, saveConfig, CONFIG_PATH, DEFAULT_CONFIG } from "../config/store.js";
import { loadAuth, AUTH_PATH } from "../config/auth.js";
import { loadOpencodeConfig } from "../config/opencode.js";
import { buildRegistry } from "../registry/index.js";
import { ask, askChoice, askYesNo } from "./prompt.js";
import { listHandovers, readHandoverDoc } from "../handover/resume.js";
import type { AutopilotConfig, Goal, Tier } from "../types.js";

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  switch (cmd) {
    case undefined:
    case "help":
    case "-h":
    case "--help":
      printHelp();
      return;
    case "init":
      await runInit();
      return;
    case "status":
      await runStatus();
      return;
    case "tiers":
      await runTiers();
      return;
    case "resume":
      await runResume(rest);
      return;
    case "handovers":
      await runHandovers();
      return;
    case "handover-now":
      await runHandoverNow();
      return;
    case "quiet":
      await runUx({ badge: false });
      return;
    case "verbose":
      await runUx({ badge: true });
      return;
    case "refresh":
      await runRefresh(rest);
      return;
    default:
      console.error(`Unknown command: ${cmd}`);
      printHelp();
      process.exit(2);
  }
}

function printHelp(): void {
  console.log(`opencode-openauto — automatic model routing for opencode

Usage:
  opencode-openauto <command>

Commands:
  init           interactive first-run setup wizard
  status         show current goal, tiers, recent telemetry
  tiers          re-scan auth.json + opencode.json, refresh model classification
  resume [--last]  list saved handovers and resume in fresh opencode session
  handovers      list saved handover docs
  handover-now   force a handover at the current point (requires running session)
  quiet          disable per-turn badge in responses
  verbose        enable per-turn badge in responses
  refresh [--yes]  pull latest plugin: kill opencode TUIs, clear caches, restart
  help           show this message

Config: ${CONFIG_PATH}
Auth:   ${AUTH_PATH}
`);
}

async function runInit(): Promise<void> {
  console.log("opencode-openauto — first-run setup\n");

  const goal = (await askChoice<Goal>(
    "What is your primary optimization goal?",
    ["cost", "quality", "balance", "custom"],
    2,
  )) as Goal;

  console.log("\nScanning available models from opencode auth, config, and recent state…");
  const auth = await loadAuth();
  const opencodeCfg = await loadOpencodeConfig();
  const recentModels = await loadRecentModelsCli();
  const registry = buildRegistry({ auth, opencodeConfig: opencodeCfg, recentModels });

  if (registry.models.length === 0) {
    console.log("\n  ⚠ no models detected. Make sure you have run `opencode auth login <provider>` for at least one provider.");
  } else {
    const groups: Record<Tier, string[]> = { free: [], "cheap-paid": [], "top-paid": [] };
    for (const m of registry.models) groups[m.tier].push(`${m.provider}/${m.modelID}`);
    console.log("");
    for (const tier of ["free", "cheap-paid", "top-paid"] as Tier[]) {
      console.log(`  ${tier} (${groups[tier].length}):`);
      for (const id of groups[tier].slice(0, 8)) console.log(`    - ${id}`);
      if (groups[tier].length > 8) console.log(`    … +${groups[tier].length - 8} more`);
    }
    if (registry.flagged.length > 0) {
      console.log(`\n  ⚠ ${registry.flagged.length} model(s) couldn't be auto-classified — defaulted to cheap-paid:`);
      for (const m of registry.flagged.slice(0, 5)) console.log(`    - ${m.provider}/${m.modelID}`);
    }
  }

  const editTiers = await askYesNo("\nEdit tiers manually? (otherwise auto-classification is used)", false);

  const cfg: AutopilotConfig = {
    ...DEFAULT_CONFIG,
    goal,
    tiers: {
      free: registry.models.filter((m) => m.tier === "free").map((m) => `${m.provider}/${m.modelID}`),
      "cheap-paid": registry.models.filter((m) => m.tier === "cheap-paid").map((m) => `${m.provider}/${m.modelID}`),
      "top-paid": registry.models.filter((m) => m.tier === "top-paid").map((m) => `${m.provider}/${m.modelID}`),
    },
  };

  if (editTiers) {
    for (const tier of ["free", "cheap-paid", "top-paid"] as Tier[]) {
      const current = cfg.tiers[tier].join(", ");
      const updated = await ask(`Comma-separated models for ${tier}`, current);
      cfg.tiers[tier] = updated.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }

  console.log("\nHandover settings:");
  cfg.handover.enabled = await askYesNo("  Enable auto-handover at high context utilization?", true);
  if (cfg.handover.enabled) {
    cfg.handover.autoResume = await askYesNo("  Auto-resume in fresh session after handover?", false);
    cfg.handover.mode = (await askChoice("  Compaction mode", ["replace", "augment"], 0)) as "replace" | "augment";
  }

  console.log("\nPrivacy:");
  cfg.triage.enabled = await askYesNo("  Allow router to call a free LLM for ambiguous-prompt triage?", true);

  cfg.ux.badge = await askYesNo("\nShow per-turn badge in responses?", true);

  await saveConfig(cfg);
  console.log(`\n✓ Saved ${CONFIG_PATH}`);

  const patchOpencode = await askYesNo(
    "\nPatch ~/.config/opencode/opencode.json to register openauto/auto provider + plugin?",
    true,
  );
  if (patchOpencode) {
    try {
      const path = await patchOpencodeJson(cfg.proxy.port);
      console.log(`✓ Patched ${path}`);
    } catch (err) {
      console.log(`⚠ Could not patch opencode.json: ${(err as Error).message}`);
      console.log("  Add manually:");
      console.log(`    "plugin": ["opencode-openauto@git+https://github.com/yagneshempyreal-dotcom/opencode-autopilot.git"],`);
      console.log(`    "provider": { "openauto": { "npm": "@ai-sdk/openai-compatible", "options": { "baseURL": "http://127.0.0.1:${cfg.proxy.port}/v1", "apiKey": "no-auth-needed" }, "models": { "auto": { "name": "OpenAuto" } } } }`);
    }
  }

  console.log(`\nNext: start (or restart) opencode and pick model 'openauto/auto'.`);
}

async function loadRecentModelsCli(): Promise<Array<{ providerID: string; modelID: string }>> {
  try {
    const { readFile } = await import("node:fs/promises");
    const { homedir } = await import("node:os");
    const { join } = await import("node:path");
    const path = process.env.OPENCODE_MODEL_STATE_PATH ?? join(homedir(), ".local", "state", "opencode", "model.json");
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as { recent?: Array<{ providerID?: string; modelID?: string }> };
    if (!Array.isArray(parsed.recent)) return [];
    return parsed.recent.filter((m): m is { providerID: string; modelID: string } =>
      typeof m?.providerID === "string" && typeof m?.modelID === "string");
  } catch { return []; }
}

async function patchOpencodeJson(port: number): Promise<string> {
  const { readFile, writeFile, mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const { opencodeJsonPath } = await import("../util/paths.js");
  const path = opencodeJsonPath();
  let cfg: Record<string, unknown> = {};
  try {
    cfg = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") throw err;
  }
  // opencode resolves plugins via its own package cache using version
  // specifiers, not bare names. Use a git URL so it fetches and caches.
  const PLUGIN_SPEC = "opencode-openauto@git+https://github.com/yagneshempyreal-dotcom/opencode-autopilot.git";
  let plugins = (cfg.plugin as Array<string | [string, unknown]>) ?? [];
  const isOurs = (p: string | [string, unknown]) => {
    const name = typeof p === "string" ? p : p[0];
    return typeof name === "string" && (
      name === "opencode-openauto" ||
      name === "opencode-autopilot" ||
      name.startsWith("opencode-openauto@") ||
      name.startsWith("opencode-autopilot@")
    );
  };
  plugins = plugins.filter((p) => !isOurs(p));
  plugins.push(PLUGIN_SPEC);
  cfg.plugin = plugins;

  const provider = (cfg.provider as Record<string, unknown>) ?? {};
  if ((provider as { router?: unknown }).router && !(provider as { openauto?: unknown }).openauto) {
    (provider as { openauto: unknown }).openauto = (provider as { router: unknown }).router;
    delete (provider as { router?: unknown }).router;
  }
  (provider as { openauto: unknown }).openauto = {
    npm: "@ai-sdk/openai-compatible",
    name: "OpenAuto Router",
    options: { baseURL: `http://127.0.0.1:${port}/v1`, apiKey: "no-auth-needed" },
    models: { auto: { name: "OpenAuto" } },
  };
  cfg.provider = provider;

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(cfg, null, 2), "utf8");
  return path;
}

async function runStatus(): Promise<void> {
  const cfg = await loadConfig();
  const auth = await loadAuth();
  const opencodeCfg = await loadOpencodeConfig();
  const recentModels = await loadRecentModelsCli();
  const registry = buildRegistry({
    auth,
    opencodeConfig: opencodeCfg,
    recentModels,
    configuredTiers: cfg.tiers,
  });

  console.log("opencode-openauto status\n");
  console.log(`Goal:           ${cfg.goal}`);
  console.log(`Badge:          ${cfg.ux.badge ? "on" : "off"}`);
  console.log(`Triage:         ${cfg.triage.enabled ? "on" : "off"}`);
  console.log(`Handover:       ${cfg.handover.enabled ? `on (save@${cfg.handover.thresholdSave}, mode=${cfg.handover.mode}, auto-resume=${cfg.handover.autoResume})` : "off"}`);
  console.log(`Proxy port:     ${cfg.proxy.port}`);
  console.log("");
  console.log("Tiers (configured / detected):");
  for (const tier of ["free", "cheap-paid", "top-paid"] as Tier[]) {
    const cfgIds = cfg.tiers[tier];
    const detected = registry.models.filter((m) => m.tier === tier);
    console.log(`  ${tier}: ${cfgIds.length} configured / ${detected.length} detected`);
  }
}

async function runTiers(): Promise<void> {
  const cfg = await loadConfig();
  const auth = await loadAuth();
  const opencodeCfg = await loadOpencodeConfig();
  const recentModels = await loadRecentModelsCli();
  const registry = buildRegistry({
    auth,
    opencodeConfig: opencodeCfg,
    recentModels,
    configuredTiers: cfg.tiers,
  });
  cfg.tiers = {
    free: registry.models.filter((m) => m.tier === "free").map((m) => `${m.provider}/${m.modelID}`),
    "cheap-paid": registry.models.filter((m) => m.tier === "cheap-paid").map((m) => `${m.provider}/${m.modelID}`),
    "top-paid": registry.models.filter((m) => m.tier === "top-paid").map((m) => `${m.provider}/${m.modelID}`),
  };
  await saveConfig(cfg);
  console.log(`✓ Refreshed tiers (${registry.models.length} models)`);
}

async function runResume(args: string[]): Promise<void> {
  const useLast = args.includes("--last");
  const handovers = await listHandovers(20);
  if (handovers.length === 0) {
    console.log("No handovers found.");
    return;
  }
  let chosen = handovers[0];
  if (!useLast) {
    console.log("Recent handovers:");
    handovers.forEach((h, i) => {
      console.log(`  ${i + 1}. [${h.ts}] ${h.sessionID} — ${h.goalOneliner}`);
    });
    const raw = await ask("Pick number to resume (or empty to cancel)", "1");
    if (!raw) return;
    const idx = parseInt(raw, 10) - 1;
    chosen = handovers[idx];
  }
  if (!chosen) {
    console.log("Invalid choice.");
    return;
  }
  console.log(`\n--- Handover document (${chosen.path}) ---\n`);
  const doc = await readHandoverDoc(chosen.path);
  console.log(doc);
  console.log("\n--- end ---\n");
  console.log("Copy the above into your next opencode session, or set OPENCODE_AUTOPILOT_AUTO_RESUME=1 to inject automatically.");
}

async function runHandovers(): Promise<void> {
  const handovers = await listHandovers(50);
  if (handovers.length === 0) {
    console.log("No handovers saved yet.");
    return;
  }
  for (const h of handovers) {
    console.log(`[${h.ts}] ${h.sessionID}`);
    console.log(`  goal: ${h.goalOneliner}`);
    console.log(`  ctx:  ${h.ctxAtSave}/${h.ctxWindow}`);
    console.log(`  path: ${h.path}`);
    console.log("");
  }
}

async function runHandoverNow(): Promise<void> {
  console.log("To force a handover, type '/router handover' inside an opencode session.");
  console.log("(Direct CLI trigger requires a running plugin process; this command is informational only.)");
}

async function runUx(patch: { badge: boolean }): Promise<void> {
  const cfg = await loadConfig();
  cfg.ux.badge = patch.badge;
  await saveConfig(cfg);
  console.log(`✓ badge ${patch.badge ? "enabled" : "disabled"}`);
}

async function runRefresh(args: string[]): Promise<void> {
  const yes = args.includes("--yes") || args.includes("-y");

  const { homedir } = await import("node:os");
  const { join } = await import("node:path");
  const { rm, readdir, writeFile } = await import("node:fs/promises");

  console.log("opencode-openauto refresh\n");

  const pids = await detectOpencodePids();
  if (pids.length > 0) {
    console.log(`Detected ${pids.length} running opencode process(es):`);
    for (const p of pids) console.log(`  · pid=${p.pid}  tty=${p.tty}  cmd=${p.cmd}`);
    const ok = yes || (await askYesNo("\nKill them so the plugin can reload?", true));
    if (!ok) {
      console.log("Aborted. (Refresh requires opencode to be down.)");
      return;
    }
    for (const p of pids) {
      try { process.kill(p.pid, "SIGTERM"); } catch { /* gone */ }
    }
    await new Promise((r) => setTimeout(r, 1500));
    const stragglers = await detectOpencodePids();
    for (const p of stragglers) {
      try { process.kill(p.pid, "SIGKILL"); } catch { /* gone */ }
    }
    console.log("✓ opencode processes stopped");
  } else {
    console.log("No opencode processes running.");
  }

  // Clear plugin caches.
  const ocCache = join(homedir(), ".cache", "opencode", "packages");
  try {
    const entries = await readdir(ocCache).catch(() => [] as string[]);
    for (const e of entries) {
      if (e.startsWith("opencode-openauto") || e.includes("openauto") || e.includes("autopilot")) {
        await rm(join(ocCache, e), { recursive: true, force: true });
      }
    }
  } catch { /* ignore */ }

  const bunCache = join(homedir(), ".bun", "install", "cache");
  try {
    const entries = await readdir(bunCache).catch(() => [] as string[]);
    for (const e of entries) {
      if (/openauto|autopilot/i.test(e)) {
        await rm(join(bunCache, e), { recursive: true, force: true });
      }
    }
  } catch { /* ignore */ }
  console.log("✓ caches cleared (~/.cache/opencode/packages, ~/.bun/install/cache)");

  // Truncate runtime log for a clean view.
  try {
    await writeFile(join(homedir(), ".local", "share", "opencode", "autopilot.log"), "", "utf8");
    console.log("✓ autopilot.log truncated");
  } catch { /* ignore */ }

  console.log(`
Ready. Start opencode in your terminal:
  $ opencode

Then in the TUI (model picker → "OpenAuto / OpenAuto Router"), type plain
text — no leading "/" or "!" since opencode TUI captures those:

  router verify                  probe every model, mark working / dead
  router pick all-ok             pin all models that just passed
  router pick a/b, c/d           pin a specific list (provider/modelID)
  router pick clear              remove the pin (use full registry)
  router health                  show last-known per-model health
  router status                  goal + health + matrix summary
  router goal cost|balance|quality   switch routing strategy
  router models                  list models per tier
  router upgrade / router reset  bump / reset session sticky floor
  router auto on / router auto off   enable / disable router
`);
}

interface RunningProc { pid: number; tty: string; cmd: string; }

async function detectOpencodePids(): Promise<RunningProc[]> {
  const { execSync } = await import("node:child_process");
  try {
    const raw = execSync("ps -axo pid=,tty=,command=", { encoding: "utf8" });
    const out: RunningProc[] = [];
    for (const line of raw.split("\n")) {
      const m = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line);
      if (!m) continue;
      const [, pidStr, tty, cmd] = m;
      if (!cmd) continue;
      if (cmd.includes("language_server") || cmd.includes("claude")) continue;
      // Match the opencode binary itself (not any path containing the word).
      const isOpencode = /(?:^|\/)opencode(?:\s|$)/.test(cmd) || /(?:^|\/)opencode\s+serve\b/.test(cmd);
      if (!isOpencode) continue;
      if (process.pid === Number(pidStr)) continue;
      out.push({ pid: Number(pidStr), tty: tty ?? "?", cmd });
    }
    return out;
  } catch { return []; }
}

main().catch((err) => {
  console.error("Error:", (err as Error).message);
  process.exit(1);
});
