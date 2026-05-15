import { CONFIG_PATH } from "../config/store.js";
import { AUTH_PATH } from "../config/auth.js";
import { runServe } from "./commands/serve.js";
import { runVerify } from "./commands/verify.js";
import { runModels } from "./commands/models.js";
import { runGoal } from "./commands/goal.js";
import { runPick } from "./commands/pick.js";
import { runHealth } from "./commands/health.js";
import { runChat } from "./commands/chat.js";
import {
  runInit,
  runStatus,
  runTiers,
  runResume,
  runHandovers,
  runHandoverNow,
  runUx,
  runSetup,
  runRefresh,
} from "./legacy.js";

const VERSION = "0.1.0";

export function printHelp(): void {
  console.log(`openauto — standalone LLM router CLI (OpenAuto)

Usage:
  openauto <command> [options]

Router daemon:
  serve [--port=4317] [--skip-verify] [--no-opencode-patch]
              Run the OpenAI-compatible proxy (foreground)
  chat "prompt" [--session=id] [--no-stream]
              Send one prompt through a running serve instance

Routing config:
  init              Interactive setup wizard
  status            Show goal, tiers, proxy port
  models            List models by tier
  goal <name>       Set goal: cost|balance|quality|premium|custom
  pick <arg>        Pin models: clear | all-ok | provider/model,...
  verify [--no-pin] Probe all models; optional auto-pin
  health            Show per-model health records
  tiers             Re-scan and refresh tier lists in config

Opencode integration:
  setup [--port=4317]   Register plugin + openauto provider in opencode.json
  refresh [--yes]       Kill opencode, clear caches, print next steps

Other:
  resume [--last]   Show saved handover documents
  handovers         List handovers
  quiet | verbose   Toggle response badge
  help              This message

Config: ${CONFIG_PATH}
Auth:   ${AUTH_PATH}
`);
}

export async function runCli(argv: string[]): Promise<void> {
  const [, , cmd, ...rest] = argv;

  switch (cmd) {
    case undefined:
    case "help":
    case "-h":
    case "--help":
      printHelp();
      return;
    case "version":
    case "-v":
    case "--version":
      console.log(VERSION);
      return;
    case "serve":
    case "start":
    case "run":
      await runServe(rest);
      return;
    case "chat":
    case "ask":
      await runChat(rest);
      return;
    case "verify":
      await runVerify(rest);
      return;
    case "models":
      await runModels();
      return;
    case "goal":
      await runGoal(rest);
      return;
    case "pick":
      await runPick(rest);
      return;
    case "health":
      await runHealth();
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
    case "setup":
      await runSetup(rest);
      return;
    default:
      console.error(`Unknown command: ${cmd}`);
      printHelp();
      process.exit(2);
  }
}
