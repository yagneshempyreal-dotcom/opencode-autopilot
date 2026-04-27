import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { autopilotLogPath } from "./paths.js";

const LOG_PATH = autopilotLogPath();

export type LogEntry = {
  ts: string;
  level: "info" | "warn" | "error" | "debug";
  msg: string;
  [k: string]: unknown;
};

let mkdirOnce: Promise<void> | null = null;
async function ensureDir(): Promise<void> {
  if (!mkdirOnce) mkdirOnce = mkdir(dirname(LOG_PATH), { recursive: true }).then(() => {});
  await mkdirOnce;
}

export async function log(level: LogEntry["level"], msg: string, extra: Record<string, unknown> = {}): Promise<void> {
  const entry: LogEntry = { ts: new Date().toISOString(), level, msg, ...extra };
  const line = JSON.stringify(entry) + "\n";
  try {
    await ensureDir();
    await appendFile(LOG_PATH, line, "utf8");
  } catch {
    // never throw from logger
  }
  if (process.env.OPENCODE_AUTOPILOT_DEBUG === "1") {
    process.stderr.write(`[autopilot ${level}] ${msg} ${Object.keys(extra).length ? JSON.stringify(extra) : ""}\n`);
  }
}

export const logger = {
  info: (msg: string, extra?: Record<string, unknown>) => log("info", msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => log("warn", msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => log("error", msg, extra),
  debug: (msg: string, extra?: Record<string, unknown>) => log("debug", msg, extra),
};
