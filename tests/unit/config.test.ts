import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig, DEFAULT_CONFIG } from "../../src/config/store.js";
import { loadAuth, getCredential, bearerToken, isOAuthExpired } from "../../src/config/auth.js";

describe("config store", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "autopilot-cfg-"));
    path = join(dir, "autopilot.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns defaults when config does not exist", async () => {
    const cfg = await loadConfig(path);
    expect(cfg.goal).toBe(DEFAULT_CONFIG.goal);
    expect(cfg.handover.thresholdSave).toBe(0.8);
  });

  it("round-trips a saved config", async () => {
    const cfg = { ...DEFAULT_CONFIG, goal: "cost" as const };
    await saveConfig(cfg, path);
    const loaded = await loadConfig(path);
    expect(loaded.goal).toBe("cost");
  });

  it("merges partial config with defaults", async () => {
    await writeFile(path, JSON.stringify({ goal: "quality" }));
    const cfg = await loadConfig(path);
    expect(cfg.goal).toBe("quality");
    expect(cfg.proxy.port).toBe(DEFAULT_CONFIG.proxy.port);
    expect(cfg.handover.enabled).toBe(true);
  });

  it("backs up corrupted config and returns defaults", async () => {
    await writeFile(path, "this is not { valid json");
    const cfg = await loadConfig(path);
    expect(cfg.goal).toBe(DEFAULT_CONFIG.goal);
  });
});

describe("auth", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "autopilot-auth-"));
    path = join(dir, "auth.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns empty when auth.json missing", async () => {
    const auth = await loadAuth(path);
    expect(auth).toEqual({});
  });

  it("reads valid auth.json", async () => {
    await writeFile(path, JSON.stringify({ openai: { type: "api", key: "sk-x" } }));
    const auth = await loadAuth(path);
    expect(auth.openai).toEqual({ type: "api", key: "sk-x" });
  });

  it("getCredential + bearerToken extract correctly", () => {
    const farFuture = Date.now() + 60 * 60 * 1000;
    const auth = {
      openai: { type: "api" as const, key: "sk-1" },
      anthropic: { type: "oauth" as const, access: "tok-2", refresh: "ref", expires: farFuture },
      missing: { type: "wellknown" as const, key: "wk-3" },
    };
    expect(bearerToken(getCredential(auth, "openai"))).toBe("sk-1");
    expect(bearerToken(getCredential(auth, "anthropic"))).toBe("tok-2");
    expect(bearerToken(getCredential(auth, "missing"))).toBe("wk-3");
    expect(bearerToken(getCredential(auth, "nope"))).toBeNull();
  });

  it("bearerToken returns null for expired OAuth tokens", () => {
    const expired = { type: "oauth" as const, access: "tok-stale", refresh: "ref", expires: 1 };
    expect(bearerToken(expired)).toBeNull();
  });

  it("treats OAuth expires as seconds when it's a small epoch", () => {
    const expiresSeconds = Math.floor(Date.now() / 1000) + 60 * 60; // 1h in the future (seconds)
    const oauth = { type: "oauth" as const, access: "tok-ok", refresh: "ref", expires: expiresSeconds };
    expect(bearerToken(oauth)).toBe("tok-ok");
    expect(isOAuthExpired(oauth)).toBe(false);
  });

  it("marks OAuth seconds tokens as expired near the 30s safety margin", () => {
    const expiresSeconds = Math.floor(Date.now() / 1000) + 10; // within 30s safety margin
    const oauth = { type: "oauth" as const, access: "tok-near-expiry", refresh: "ref", expires: expiresSeconds };
    expect(isOAuthExpired(oauth)).toBe(true);
    expect(bearerToken(oauth)).toBeNull();
  });
});
