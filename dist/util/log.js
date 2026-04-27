import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { autopilotLogPath } from "./paths.js";
const LOG_PATH = autopilotLogPath();
let mkdirOnce = null;
async function ensureDir() {
    if (!mkdirOnce)
        mkdirOnce = mkdir(dirname(LOG_PATH), { recursive: true }).then(() => { });
    await mkdirOnce;
}
export async function log(level, msg, extra = {}) {
    const entry = { ts: new Date().toISOString(), level, msg, ...extra };
    const line = JSON.stringify(entry) + "\n";
    try {
        await ensureDir();
        await appendFile(LOG_PATH, line, "utf8");
    }
    catch {
        // never throw from logger
    }
    if (process.env.OPENCODE_AUTOPILOT_DEBUG === "1") {
        process.stderr.write(`[autopilot ${level}] ${msg} ${Object.keys(extra).length ? JSON.stringify(extra) : ""}\n`);
    }
}
export const logger = {
    info: (msg, extra) => log("info", msg, extra),
    warn: (msg, extra) => log("warn", msg, extra),
    error: (msg, extra) => log("error", msg, extra),
    debug: (msg, extra) => log("debug", msg, extra),
};
//# sourceMappingURL=log.js.map