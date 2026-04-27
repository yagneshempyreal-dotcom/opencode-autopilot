import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOpencodeConfig } from "../../src/config/opencode.js";

describe("loadOpencodeConfig", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "opencode-cfg-"));
    path = join(dir, "opencode.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns empty object when file missing", async () => {
    const cfg = await loadOpencodeConfig(path);
    expect(cfg).toEqual({});
  });

  it("parses valid opencode.json", async () => {
    await writeFile(path, JSON.stringify({
      model: "router/auto",
      provider: { openai: { models: { "gpt-5.4": {} } } },
    }));
    const cfg = await loadOpencodeConfig(path);
    expect(cfg.model).toBe("router/auto");
    expect(cfg.provider?.openai?.models?.["gpt-5.4"]).toEqual({});
  });

  it("preserves npm + options for providers", async () => {
    await writeFile(path, JSON.stringify({
      provider: { zhipuai: { npm: "@anthropic-ai/sdk", options: { baseURL: "https://x.test" } } },
    }));
    const cfg = await loadOpencodeConfig(path);
    expect(cfg.provider?.zhipuai?.npm).toBe("@anthropic-ai/sdk");
    expect(cfg.provider?.zhipuai?.options?.baseURL).toBe("https://x.test");
  });
});
