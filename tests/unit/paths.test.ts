import { describe, it, expect, afterEach } from "vitest";
import {
  configHome,
  dataHome,
  stateHome,
  opencodeConfigDir,
  opencodeDataDir,
  opencodeHandoverDir,
  autopilotConfigPath,
  autopilotLogPath,
  authJsonPath,
  opencodeJsonPath,
} from "../../src/util/paths.js";

const ENV_KEYS = [
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "OPENCODE_AUTOPILOT_CONFIG_PATH",
  "OPENCODE_AUTOPILOT_LOG_PATH",
  "OPENCODE_AUTOPILOT_HANDOVER_DIR",
  "OPENCODE_AUTH_PATH",
  "OPENCODE_CONFIG_PATH",
] as const;

const saved: Record<string, string | undefined> = {};

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
    delete saved[k];
  }
});

function snap(...keys: (typeof ENV_KEYS)[number][]): void {
  for (const k of keys) saved[k] = process.env[k];
}

describe("path helpers", () => {
  it("XDG_CONFIG_HOME wins over default", () => {
    snap("XDG_CONFIG_HOME");
    process.env.XDG_CONFIG_HOME = "/tmp/cfg";
    expect(configHome()).toBe("/tmp/cfg");
    expect(opencodeConfigDir()).toContain("/tmp/cfg");
  });

  it("XDG_DATA_HOME wins over default", () => {
    snap("XDG_DATA_HOME");
    process.env.XDG_DATA_HOME = "/tmp/data";
    expect(dataHome()).toBe("/tmp/data");
    expect(opencodeDataDir()).toContain("/tmp/data");
  });

  it("XDG_STATE_HOME wins over default", () => {
    snap("XDG_STATE_HOME");
    process.env.XDG_STATE_HOME = "/tmp/state";
    expect(stateHome()).toBe("/tmp/state");
  });

  it("autopilotConfigPath honors override env var", () => {
    snap("OPENCODE_AUTOPILOT_CONFIG_PATH");
    process.env.OPENCODE_AUTOPILOT_CONFIG_PATH = "/custom/path/x.json";
    expect(autopilotConfigPath()).toBe("/custom/path/x.json");
  });

  it("autopilotLogPath honors override env var", () => {
    snap("OPENCODE_AUTOPILOT_LOG_PATH");
    process.env.OPENCODE_AUTOPILOT_LOG_PATH = "/custom/log.log";
    expect(autopilotLogPath()).toBe("/custom/log.log");
  });

  it("authJsonPath honors override", () => {
    snap("OPENCODE_AUTH_PATH");
    process.env.OPENCODE_AUTH_PATH = "/custom/auth.json";
    expect(authJsonPath()).toBe("/custom/auth.json");
  });

  it("opencodeJsonPath honors override", () => {
    snap("OPENCODE_CONFIG_PATH");
    process.env.OPENCODE_CONFIG_PATH = "/custom/opencode.json";
    expect(opencodeJsonPath()).toBe("/custom/opencode.json");
  });

  it("opencodeHandoverDir honors override", () => {
    snap("OPENCODE_AUTOPILOT_HANDOVER_DIR");
    process.env.OPENCODE_AUTOPILOT_HANDOVER_DIR = "/custom/handovers";
    expect(opencodeHandoverDir()).toBe("/custom/handovers");
  });

  it("defaults are absolute paths", () => {
    snap(...ENV_KEYS);
    for (const k of ENV_KEYS) delete process.env[k];
    expect(configHome()).toMatch(/^([A-Za-z]:[\\/]|\/)/);
    expect(dataHome()).toMatch(/^([A-Za-z]:[\\/]|\/)/);
    expect(autopilotConfigPath()).toMatch(/^([A-Za-z]:[\\/]|\/)/);
  });
});
