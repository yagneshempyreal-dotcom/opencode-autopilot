import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    platform: () => "win32",
    homedir: () => "C:\\Users\\test",
  };
});

const originalEnv: Record<string, string | undefined> = {};
const KEYS = [
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "APPDATA",
  "LOCALAPPDATA",
  "OPENCODE_AUTOPILOT_HANDOVER_DIR",
] as const;

beforeEach(() => {
  for (const k of KEYS) {
    originalEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});

describe("paths on Windows (mocked platform)", () => {
  it("configHome uses APPDATA on Windows", async () => {
    process.env.APPDATA = "C:\\Users\\test\\AppData\\Roaming";
    const { configHome } = await import("../../src/util/paths.js?t=win-cfg");
    expect(configHome()).toBe("C:\\Users\\test\\AppData\\Roaming");
  });

  it("dataHome uses LOCALAPPDATA on Windows", async () => {
    process.env.LOCALAPPDATA = "C:\\Users\\test\\AppData\\Local";
    const { dataHome } = await import("../../src/util/paths.js?t=win-data");
    expect(dataHome()).toBe("C:\\Users\\test\\AppData\\Local");
  });

  it("stateHome uses LOCALAPPDATA on Windows", async () => {
    process.env.LOCALAPPDATA = "C:\\Users\\test\\AppData\\Local";
    const { stateHome } = await import("../../src/util/paths.js?t=win-state");
    expect(stateHome()).toBe("C:\\Users\\test\\AppData\\Local");
  });

  it("XDG_CONFIG_HOME still wins over APPDATA on Windows", async () => {
    process.env.XDG_CONFIG_HOME = "C:\\xdg";
    process.env.APPDATA = "C:\\appdata";
    const { configHome } = await import("../../src/util/paths.js?t=win-xdg-wins");
    expect(configHome()).toBe("C:\\xdg");
  });

  it("Windows fallback when APPDATA missing uses homedir", async () => {
    delete process.env.APPDATA;
    const { configHome } = await import("../../src/util/paths.js?t=win-no-appdata");
    expect(configHome()).toContain(".config");
  });

  it("Windows stateHome falls back to homedir when LOCALAPPDATA missing", async () => {
    delete process.env.LOCALAPPDATA;
    const { stateHome } = await import("../../src/util/paths.js?t=win-no-localapp");
    expect(stateHome()).toContain(".local");
  });
});
