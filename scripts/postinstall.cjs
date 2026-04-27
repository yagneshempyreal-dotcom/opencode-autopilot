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

  // Auto-classify available models from auth × opencode provider config.
  const tiers = { free: [], "cheap-paid": [], "top-paid": [] };
  const providers = (opencode.provider && typeof opencode.provider === "object") ? opencode.provider : {};
  for (const provider of Object.keys(auth)) {
    const cfgModels = (providers[provider] && providers[provider].models) || {};
    for (const modelID of Object.keys(cfgModels)) {
      const id = `${provider}/${modelID}`;
      tiers[classify(id)].push(id);
    }
  }

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

  // Patch opencode.json: add plugin + router provider (idempotent).
  const plugins = Array.isArray(opencode.plugin) ? opencode.plugin : [];
  const hasPlugin = plugins.some((p) =>
    typeof p === "string" ? p === "opencode-autopilot" : Array.isArray(p) && p[0] === "opencode-autopilot",
  );
  if (!hasPlugin) plugins.push("opencode-autopilot");
  opencode.plugin = plugins;

  const provider = (opencode.provider && typeof opencode.provider === "object") ? opencode.provider : {};
  if (!provider.router) {
    provider.router = {
      npm: "@ai-sdk/openai-compatible",
      name: "Autopilot Router",
      options: { baseURL: `http://127.0.0.1:${port}/v1`, apiKey: "no-auth-needed" },
      models: { auto: { name: "Autopilot (auto)" } },
    };
  } else {
    // Update baseURL only if port changed.
    provider.router.options = provider.router.options || {};
    provider.router.options.baseURL = `http://127.0.0.1:${port}/v1`;
    provider.router.options.apiKey = provider.router.options.apiKey || "no-auth-needed";
  }
  opencode.provider = provider;

  await mkdir(dirname(opencodePath), { recursive: true });
  await writeFile(opencodePath, JSON.stringify(opencode, null, 2), "utf8");

  const total = tiers.free.length + tiers["cheap-paid"].length + tiers["top-paid"].length;
  console.log("");
  console.log("✓ opencode-autopilot installed and configured");
  console.log(`  · autopilot.json: ${autopilotPath}`);
  console.log("  · opencode.json patched: plugin + router/auto provider");
  console.log(`  · detected models: ${total} (free=${tiers.free.length}, cheap=${tiers["cheap-paid"].length}, top=${tiers["top-paid"].length})`);
  console.log(`  · proxy port: ${port}`);
  console.log("");
  console.log("Next: restart opencode and pick model 'router/auto'.");
  console.log("Customize anytime: opencode-autopilot init  |  opencode-autopilot status");
  console.log("");
}

main().catch((err) => {
  console.warn(`opencode-autopilot postinstall: ${err && err.message ? err.message : err}`);
  console.warn("(continuing — run `opencode-autopilot init` later to retry)");
  process.exit(0);
});
