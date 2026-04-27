import { describe, it, expect, vi } from "vitest";
import { isRetriableStatus, ForwardError } from "../../src/forwarder/types.js";
import { extractText, lastUserIndex, parseRequest } from "../../src/proxy/parse.js";
import { extractUsage, extractDeltaText } from "../../src/proxy/sse.js";
import { heuristicScore } from "../../src/classifier/heuristic.js";
import { triageScore } from "../../src/classifier/triage.js";
import type { ChatMessage, ModelEntry } from "../../src/types.js";

describe("isRetriableStatus", () => {
  it("returns true for 408, 429, 500-599", () => {
    expect(isRetriableStatus(408)).toBe(true);
    expect(isRetriableStatus(429)).toBe(true);
    expect(isRetriableStatus(500)).toBe(true);
    expect(isRetriableStatus(503)).toBe(true);
    expect(isRetriableStatus(599)).toBe(true);
  });
  it("returns false for 200, 400, 401, 403, 404, 600+", () => {
    expect(isRetriableStatus(200)).toBe(false);
    expect(isRetriableStatus(400)).toBe(false);
    expect(isRetriableStatus(401)).toBe(false);
    expect(isRetriableStatus(403)).toBe(false);
    expect(isRetriableStatus(404)).toBe(false);
    expect(isRetriableStatus(600)).toBe(false);
  });
});

describe("ForwardError construction", () => {
  it("preserves status, detail, retriable", () => {
    const e = new ForwardError(503, "upstream", true);
    expect(e.status).toBe(503);
    expect(e.detail).toBe("upstream");
    expect(e.retriable).toBe(true);
    expect(e.message).toContain("503");
  });
});

describe("proxy parse extractors", () => {
  it("extractText returns '' for undefined / null content", () => {
    expect(extractText(undefined)).toBe("");
    expect(extractText(null as unknown as ChatMessage["content"])).toBe("");
  });

  it("extractText handles parts array with missing text", () => {
    const result = extractText([{ type: "text" }, { type: "text", text: "hello" }] as ChatMessage["content"]);
    expect(result).toContain("hello");
  });

  it("lastUserIndex returns -1 when no user message exists", () => {
    expect(lastUserIndex([{ role: "system", content: "x" }])).toBe(-1);
    expect(lastUserIndex([])).toBe(-1);
  });

  it("parseRequest handles message with array content", () => {
    const r = parseRequest({
      model: "auto",
      messages: [{ role: "user", content: [{ type: "text", text: "hello /upgrade" }] }],
    }, "s1");
    expect(r.signals.upgradeRequested).toBe(true);
  });

  it("parseRequest with no user messages still returns a session", () => {
    const r = parseRequest({
      model: "auto",
      messages: [{ role: "system", content: "be helpful" }],
    }, "s2");
    expect(r.sessionID).toBe("s2");
    expect(r.override).toBeNull();
  });
});

describe("SSE extractUsage edge cases", () => {
  it("returns null for malformed JSON", () => {
    expect(extractUsage("data: {not json}")).toBeNull();
  });
  it("returns null for non-data prefixed line", () => {
    expect(extractUsage("event: ping")).toBeNull();
  });
  it("returns null for [DONE]", () => {
    expect(extractUsage("data: [DONE]")).toBeNull();
  });
  it("extractDeltaText handles missing delta gracefully", () => {
    expect(extractDeltaText(`data: ${JSON.stringify({ choices: [{}] })}`)).toBe("");
  });
});

describe("heuristic edge branches", () => {
  it("medium prompt with one code block + over 400 chars", () => {
    const promptBody = `Please review this code:\n\n\`\`\`ts\nconst x = 1;\nconst y = 2;\nconst z = x + y;\nconsole.log(z);\n\`\`\`\n\nWhat improvements would you suggest? Lots of text here. ${"detail ".repeat(40)}`;
    const r = heuristicScore({ prompt: promptBody, contextChars: 0, attachedFiles: 0, codeBlockCount: 1 });
    expect(["medium", "high"]).toContain(r.tier);
  });
  it("medium-default fallback for empty prompt", () => {
    const r = heuristicScore({ prompt: "", contextChars: 0, attachedFiles: 0, codeBlockCount: 0 });
    expect(r.tier).toBe("low");
  });
  it("multi code blocks + long prompt → high", () => {
    const promptBody = `Look at this:\n\`\`\`\nA\n\`\`\`\nand:\n\`\`\`\nB\n\`\`\`\n\n${"x ".repeat(500)}`;
    const r = heuristicScore({ prompt: promptBody, contextChars: 0, attachedFiles: 0, codeBlockCount: 2 });
    expect(r.tier).toBe("high");
  });
});

describe("triage error path", () => {
  it("returns medium fallback when fetch throws (bad URL)", async () => {
    const model: ModelEntry = {
      provider: "p",
      modelID: "tiny",
      tier: "free",
      ctxWindow: 32_000,
      supportsStreaming: true,
      apiShape: "openai",
      baseURL: "http://127.0.0.1:1/v1",
    };
    const r = await triageScore({
      prompt: "hello world this is a longer prompt for triage testing",
      triageModel: model,
      auth: { p: { type: "api", key: "k" } },
    });
    expect(r.tier).toBe("medium");
    expect(r.reason).toMatch(/error/);
  });

  it("returns medium fallback when triage call aborts on timeout", async () => {
    vi.useFakeTimers();
    const model: ModelEntry = {
      provider: "p",
      modelID: "tiny",
      tier: "free",
      ctxWindow: 32_000,
      supportsStreaming: true,
      apiShape: "openai",
      baseURL: "http://127.0.0.1:1/v1",
    };
    const promise = triageScore({
      prompt: "hello world this is a longer prompt for triage testing",
      triageModel: model,
      auth: { p: { type: "api", key: "k" } },
    });
    await vi.advanceTimersByTimeAsync(9000);
    vi.useRealTimers();
    const r = await promise;
    expect(r.tier).toBe("medium");
  });
});
