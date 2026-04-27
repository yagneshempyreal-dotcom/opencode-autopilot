import { homedir, platform } from "node:os";
import { join } from "node:path";
export function configHome() {
    if (process.env.XDG_CONFIG_HOME)
        return process.env.XDG_CONFIG_HOME;
    if (platform() === "win32" && process.env.APPDATA)
        return process.env.APPDATA;
    return join(homedir(), ".config");
}
export function dataHome() {
    if (process.env.XDG_DATA_HOME)
        return process.env.XDG_DATA_HOME;
    if (platform() === "win32" && process.env.LOCALAPPDATA)
        return process.env.LOCALAPPDATA;
    return join(homedir(), ".local", "share");
}
export function stateHome() {
    if (process.env.XDG_STATE_HOME)
        return process.env.XDG_STATE_HOME;
    if (platform() === "win32" && process.env.LOCALAPPDATA)
        return process.env.LOCALAPPDATA;
    return join(homedir(), ".local", "state");
}
export function opencodeConfigDir() {
    return join(configHome(), "opencode");
}
export function opencodeDataDir() {
    return join(dataHome(), "opencode");
}
export function opencodeHandoverDir() {
    if (process.env.OPENCODE_AUTOPILOT_HANDOVER_DIR)
        return process.env.OPENCODE_AUTOPILOT_HANDOVER_DIR;
    return join(homedir(), ".opencode", "handovers");
}
export function autopilotConfigPath() {
    if (process.env.OPENCODE_AUTOPILOT_CONFIG_PATH)
        return process.env.OPENCODE_AUTOPILOT_CONFIG_PATH;
    return join(opencodeConfigDir(), "autopilot.json");
}
export function autopilotLogPath() {
    if (process.env.OPENCODE_AUTOPILOT_LOG_PATH)
        return process.env.OPENCODE_AUTOPILOT_LOG_PATH;
    return join(opencodeDataDir(), "autopilot.log");
}
export function authJsonPath() {
    if (process.env.OPENCODE_AUTH_PATH)
        return process.env.OPENCODE_AUTH_PATH;
    return join(opencodeDataDir(), "auth.json");
}
export function opencodeJsonPath() {
    if (process.env.OPENCODE_CONFIG_PATH)
        return process.env.OPENCODE_CONFIG_PATH;
    return join(opencodeConfigDir(), "opencode.json");
}
//# sourceMappingURL=paths.js.map