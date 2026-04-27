#!/usr/bin/env node
"use strict";

// Runs automatically after `npm install opencode-autopilot`.
// Patches the user's ~/.config/opencode/{opencode,autopilot}.json so that
// `router/auto` shows up in the model picker on next opencode launch.
// Idempotent. Never fails the install — logs a warning and exits 0 on error.

const { readFile, writeFile, mkdir } = require("node:fs/promises");
const { homedir, platform } = require("node:os");
const { join, dirname, resolve } = require("node:path");

if (process.env.OPENCODE_AUTOPILOT_SKIP_POSTINSTALL === "1") {
  process.exit(0);
}
if (process.env.CI === "true" || process.env.CI === "1") {
  process.exit(0);
}

// Skip when running inside the package's own dev tree (avoid patching the
// developer's real opencode config when they `npm install` to develop).
const initCwd = process.env.INIT_CWD ?? process.cwd();
const pkgRoot = resolve(__dirname, "..");
if (initCwd === pkgRoot) {
  process.exit(0);
}

const FREE_PATTERNS = [/:free$/i, /-free$/i, /-free[/-]/i];
const TOP_PATTERNS = [
  /opus/i,
  /gpt-?5(?!\.\d?-mini|\.\d?-nano)/i,
  /gpt-?4o(?!-mini)/i,
  /o1(?:-preview|-pro)?/i,
  /o3(?:-pro|-deep)?/i,
  /reasoner/i,
  /\b(?:glm|chatglm)-4-plus/i,
  /\b(?:glm|chatglm)-5\b/i,
  /sonnet-4/i,
  /sonnet-5/i,
  /claude-(?:opus|sonnet)-[0-9]/i,
  /gemini-(?:1\.5|2)-pro/i,
  /gemini-advanced/i,
];
const CHEAP_PATTERNS = [
  /mini/i, /nano/i, /haiku/i, /flash/i, /turbo/i, /small/i,
  /\bgrok-code-fast/i, /\bglm-4\.5/i, /-codex-/i,
];

function configHome() {
  if (process.env.XDG_CONFIG_HOME) return process.env.XDG_CONFIG_HOME;
  if (platform() === "win32" && process.env.APPDATA) return process.env.APPDATA;
  return join(homedir(), ".config");
}
function dataHome() {
  if (process.env.XDG_DATA_HOME) return process.env.XDG_DATA_HOME;
  if (platform() === "win32" && process.env.LOCALAPPDATA) return process.env.LOCALAPPDATA;
  return join(homedir(), ".local", "share");
}

function classify(id) {
  if (FREE_PATTERNS.some((re) => re.test(id))) return "free";
  if (TOP_PATTERNS.some((re) => re.test(id))) return "top-paid";
  if (CHEAP_PATTERNS.some((re) => re.test(id))) return "cheap-paid";
  return "cheap-paid";
}

async function readJsonOr(path, fallback) {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT" || err instanceof SyntaxError) return fallback;
    throw err;
  }
}

async function main() {
  const cfgDir = join(configHome(), "opencode");
  const dataDir = join(dataHome(), "opencode");
  const opencodePath = join(cfgDir, "opencode.json");
  const autopilotPath = join(cfgDir, "autopilot.json");
  const authPath = join(dataDir, "auth.json");

  const auth = await readJsonOr(authPath, {});
  const opencode = await readJsonOr(opencodePath, {});
  const existingAutopilot = await readJsonOr(autopilotPath, null);

  // Auto-classify models from three sources:
  //   1. inline declarations in opencode.json provider.<x>.models
  //   2. recent models picked through opencode (~/.local/state/opencode/model.json)
  //   3. tier lists already present in autopilot.json (preserve user's curated set)
  const tiers = { free: [], "cheap-paid": [], "top-paid": [] };
  const seen = new Set();
  const seed = (provider, modelID) => {
    if (!provider || !modelID) return;
    const id = `${provider}/${modelID}`;
    if (seen.has(id)) return;
    seen.add(id);
    tiers[classify(id)].push(id);
  };

  const providers = (opencode.provider && typeof opencode.provider === "object") ? opencode.provider : {};
  for (const provider of Object.keys(auth)) {
    const cfgModels = (providers[provider] && providers[provider].models) || {};
    for (const modelID of Object.keys(cfgModels)) seed(provider, modelID);
  }
  // Recent models from opencode's own state.
  try {
    const stateDir = process.env.XDG_STATE_HOME
      ? join(process.env.XDG_STATE_HOME, "opencode")
      : platform() === "win32" && process.env.LOCALAPPDATA
        ? join(process.env.LOCALAPPDATA, "opencode")
        : join(homedir(), ".local", "state", "opencode");
    const recent = await readJsonOr(join(stateDir, "model.json"), null);
    if (recent && Array.isArray(recent.recent)) {
      for (const m of recent.recent) seed(m && m.providerID, m && m.modelID);
    }
  } catch { /* ignore */ }

  const port = (existingAutopilot && existingAutopilot.proxy && existingAutopilot.proxy.port) || 4317;

  const autopilotCfg = existingAutopilot ?? {
    goal: "balance",
    tiers: { free: [], "cheap-paid": [], "top-paid": [] },
    proxy: { port, host: "127.0.0.1" },
    ux: { badge: true },
    triage: { enabled: true },
    handover: {
      enabled: true,
      thresholdWarn: 0.7,
      thresholdSave: 0.8,
      thresholdEmergency: 0.92,
      mode: "replace",
      autoResume: false,
      summaryModel: "policy",
    },
  };
  // Merge detected tiers in (preserve user edits).
  for (const tier of ["free", "cheap-paid", "top-paid"]) {
    autopilotCfg.tiers = autopilotCfg.tiers || { free: [], "cheap-paid": [], "top-paid": [] };
    const existing = new Set(autopilotCfg.tiers[tier] || []);
    for (const id of tiers[tier]) existing.add(id);
    autopilotCfg.tiers[tier] = Array.from(existing);
  }

  await mkdir(dirname(autopilotPath), { recursive: true });
  await writeFile(autopilotPath, JSON.stringify(autopilotCfg, null, 2), "utf8");

  // Patch opencode.json: add plugin + provider (idempotent).
  // opencode resolves plugins via its own package cache using version
  // specifiers (see ~/.cache/opencode/packages/), NOT via bare names from
  // ~/.config/opencode/node_modules. So we register with a git URL.
  const PLUGIN_SPEC = "opencode-autopilot@git+https://github.com/yagneshempyreal-dotcom/opencode-autopilot.git";
  const plugins = Array.isArray(opencode.plugin) ? opencode.plugin : [];
  const matchesAutopilot = (p) => {
    if (typeof p === "string") return p === "opencode-autopilot" || p.startsWith("opencode-autopilot@");
    return Array.isArray(p) && (p[0] === "opencode-autopilot" || (typeof p[0] === "string" && p[0].startsWith("opencode-autopilot@")));
  };
  const idx = plugins.findIndex(matchesAutopilot);
  if (idx >= 0) plugins[idx] = PLUGIN_SPEC;
  else plugins.push(PLUGIN_SPEC);
  opencode.plugin = plugins;

  const provider = (opencode.provider && typeof opencode.provider === "object") ? opencode.provider : {};
  // Migrate legacy "router" key to "openauto".
  if (provider.router && !provider.openauto) {
    provider.openauto = provider.router;
    delete provider.router;
  }
  if (!provider.openauto) {
    provider.openauto = {
      npm: "@ai-sdk/openai-compatible",
      name: "OpenAuto Router",
      options: { baseURL: `http://127.0.0.1:${port}/v1`, apiKey: "no-auth-needed" },
      models: { auto: { name: "OpenAuto" } },
    };
  } else {
    provider.openauto.options = provider.openauto.options || {};
    provider.openauto.options.baseURL = `http://127.0.0.1:${port}/v1`;
    provider.openauto.options.apiKey = provider.openauto.options.apiKey || "no-auth-needed";
    provider.openauto.npm = provider.openauto.npm || "@ai-sdk/openai-compatible";
    provider.openauto.name = provider.openauto.name || "OpenAuto Router";
    provider.openauto.models = provider.openauto.models || { auto: { name: "OpenAuto" } };
  }
  opencode.provider = provider;

  await mkdir(dirname(opencodePath), { recursive: true });
  await writeFile(opencodePath, JSON.stringify(opencode, null, 2), "utf8");

  const total = tiers.free.length + tiers["cheap-paid"].length + tiers["top-paid"].length;
  console.log("");
  console.log("✓ opencode-autopilot installed and configured");
  console.log(`  · autopilot.json: ${autopilotPath}`);
  console.log("  · opencode.json patched: plugin + openauto/auto provider");
  console.log(`  · detected models: ${total} (free=${tiers.free.length}, cheap=${tiers["cheap-paid"].length}, top=${tiers["top-paid"].length})`);
  console.log(`  · proxy port: ${port}`);
  console.log("");
  console.log("Next: restart opencode and pick model 'openauto/auto' (search: openauto).");
  console.log("Customize anytime: opencode-autopilot init  |  opencode-autopilot status");
  console.log("");
}

main().catch((err) => {
  console.warn(`opencode-autopilot postinstall: ${err && err.message ? err.message : err}`);
  console.warn("(continuing — run `opencode-autopilot init` later to retry)");
  process.exit(0);
});
