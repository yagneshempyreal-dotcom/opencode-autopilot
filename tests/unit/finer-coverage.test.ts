import { describe, it, expect, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tierToOrder, heuristicScore } from "../../src/classifier/heuristic.js";
import { bearerToken } from "../../src/config/auth.js";
import { loadOpencodeConfig } from "../../src/config/opencode.js";
import { ProxyEventBus } from "../../src/proxy/context.js";
import { extractDeltaText } from "../../src/proxy/sse.js";
import { forwardOpenAICompat } from "../../src/forwarder/openai.js";
import { forwardAnthropic } from "../../src/forwarder/anthropic.js";
import { dispatch } from "../../src/forwarder/index.js";
import type { ModelEntry, OpenCodeAuth, RouteDecision } from "../../src/types.js";
import { createServer, type Server } from "node:http";

describe("tierToOrder", () => {
  it("orders complexity tiers", () => {
    expect(tierToOrder("low")).toBe(0);
    expect(tierToOrder("medium")).toBe(1);
    expect(tierToOrder("high")).toBe(2);
  });
});

describe("bearerToken null safety", () => {
  it("returns null when entry is null", () => {
    expect(bearerToken(null)).toBeNull();
  });
  it("returns null for unknown auth shape", () => {
    expect(bearerToken({ type: "weird" } as unknown as Parameters<typeof bearerToken>[0])).toBeNull();
  });
});

describe("loadOpencodeConfig non-ENOENT errors", () => {
  it("rethrows when path is a directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oc-"));
    try {
      const dirAsFile = join(dir, "as-file");
      await mkdir(dirAsFile);
      await expect(loadOpencodeConfig(dirAsFile)).rejects.toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("heuristic missing branches", () => {
  it("rates 'how does this work' style ambiguous prompt", () => {
    const r = heuristicScore({ prompt: "how does this work in detail what is happening", contextChars: 0, attachedFiles: 0, codeBlockCount: 0 });
    expect(r.tier).toBeDefined();
  });

  it("returns medium fallback when prompt is exactly at MEDIUM_CHAR boundary", () => {
    const promptBody = "x".repeat(450);
    const r = heuristicScore({ prompt: promptBody, contextChars: 0, attachedFiles: 0, codeBlockCount: 0 });
    expect(r.tier).toBe("medium");
  });

  it("medium-default when very long but no triggers", () => {
    const promptBody = "x".repeat(700);
    const r = heuristicScore({ prompt: promptBody, contextChars: 0, attachedFiles: 0, codeBlockCount: 0 });
    expect(r.tier).toBe("medium");
  });
});

describe("ProxyEventBus listener errors don't propagate", () => {
  it("emits to other listeners even if one throws", () => {
    const bus = new ProxyEventBus();
    let goodCalls = 0;
    bus.on(() => { throw new Error("bad listener"); });
    bus.on(() => { goodCalls++; });
    bus.emit({ type: "error", message: "x" });
    expect(goodCalls).toBe(1);
  });

  it("unsubscribe removes listener", () => {
    const bus = new ProxyEventBus();
    let calls = 0;
    const off = bus.on(() => { calls++; });
    bus.emit({ type: "error", message: "x" });
    off();
    bus.emit({ type: "error", message: "y" });
    expect(calls).toBe(1);
  });
});

describe("extractDeltaText fallthrough", () => {
  it("extractDeltaText returns '' for empty data after data:", () => {
    expect(extractDeltaText("data:")).toBe("");
    expect(extractDeltaText("data: ")).toBe("");
  });
});

describe("forwarder openai missing baseURL", () => {
  it("ForwardError when no baseURL", async () => {
    const auth: OpenCodeAuth = { p: { type: "api", key: "k" } };
    const model: ModelEntry = {
      provider: "p",
      modelID: "m",
      tier: "free",
      ctxWindow: 32_000,
      supportsStreaming: true,
      apiShape: "openai",
    };
    await expect(
      forwardOpenAICompat({ request: { model: "auto", messages: [{ role: "user", content: "x" }] }, model, auth }),
    ).rejects.toMatchObject({ status: 500 });
  });
});

describe("forwarder anthropic edge", () => {
  it("missing credentials throws ForwardError 401", async () => {
    const model: ModelEntry = {
      provider: "anthropic",
      modelID: "claude",
      tier: "cheap-paid",
      ctxWindow: 200_000,
      supportsStreaming: true,
      apiShape: "anthropic",
      baseURL: "http://127.0.0.1:1/v1",
    };
    await expect(
      forwardAnthropic({ request: { model: "auto", messages: [{ role: "user", content: "x" }] }, model, auth: {} }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("converts tool messages to user role", async () => {
    let receivedBody: string | null = null;
    const server: Server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        receivedBody = body;
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ content: [{ type: "text", text: "ok" }] }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    try {
      const auth: OpenCodeAuth = { anthropic: { type: "api", key: "k" } };
      const model: ModelEntry = {
        provider: "anthropic",
        modelID: "claude",
        tier: "cheap-paid",
        ctxWindow: 200_000,
        supportsStreaming: true,
        apiShape: "anthropic",
        baseURL: `http://127.0.0.1:${addr.port}/v1`,
      };
      await forwardAnthropic({
        request: {
          model: "auto",
          messages: [
            { role: "tool", content: "tool result" },
            { role: "user", content: "thanks" },
          ],
        },
        model,
        auth,
      });
      const sent = JSON.parse(receivedBody ?? "{}");
      expect(sent.messages.find((m: { role: string }) => m.role === "tool")).toBeUndefined();
      expect(sent.messages[0].role).toBe("user");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("HTTP 503 from anthropic throws retriable ForwardError", async () => {
    const server: Server = createServer((_req, res) => {
      res.statusCode = 503;
      res.setHeader("content-type", "application/json");
      res.end("{}");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    try {
      const auth: OpenCodeAuth = { anthropic: { type: "api", key: "k" } };
      const model: ModelEntry = {
        provider: "anthropic",
        modelID: "claude",
        tier: "cheap-paid",
        ctxWindow: 200_000,
        supportsStreaming: true,
        apiShape: "anthropic",
        baseURL: `http://127.0.0.1:${addr.port}/v1`,
      };
      await expect(
        forwardAnthropic({ request: { model: "auto", messages: [{ role: "user", content: "x" }] }, model, auth }),
      ).rejects.toMatchObject({ status: 503, retriable: true });
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

describe("dispatch generic error path", () => {
  it("captures non-ForwardError exceptions and reports them in attempts", async () => {
    const auth: OpenCodeAuth = { p: { type: "api", key: "k" } };
    const model: ModelEntry = {
      provider: "p",
      modelID: "m",
      tier: "free",
      ctxWindow: 32_000,
      supportsStreaming: true,
      apiShape: "openai",
      baseURL: "http://does-not-resolve.invalid:9999/v1",
    };
    const registry = {
      models: [model],
      byID: new Map([[`${model.provider}/${model.modelID}`, model]]),
      flagged: [],
    };
    const decision: RouteDecision = {
      modelID: model.modelID,
      provider: model.provider,
      tier: "free",
      reason: "test",
      escalated: false,
      override: false,
    };
    await expect(
      dispatch({
        decision,
        request: { model: "auto", messages: [{ role: "user", content: "x" }] },
        registry,
        auth,
        allowEscalation: false,
      }),
    ).rejects.toBeDefined();
  }, 20_000);
});
