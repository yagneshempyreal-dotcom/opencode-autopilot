import { describe, it, expect } from "vitest";
import { sseLines, extractDeltaText, extractUsage, extractFinishReason } from "../../src/proxy/sse.js";

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

describe("sseLines", () => {
  it("yields complete lines across chunk boundaries", async () => {
    const stream = streamFrom(["data: {\"a\":1}\n", "data: {\"b\":", "2}\n\n", "data: [DONE]\n"]);
    const lines: string[] = [];
    for await (const l of sseLines(stream)) lines.push(l);
    expect(lines).toContain('data: {"a":1}');
    expect(lines).toContain('data: {"b":2}');
    expect(lines).toContain("data: [DONE]");
  });

  it("yields trailing partial line at end", async () => {
    const stream = streamFrom(["data: hello"]);
    const lines: string[] = [];
    for await (const l of sseLines(stream)) lines.push(l);
    expect(lines).toEqual(["data: hello"]);
  });
});

describe("extractDeltaText", () => {
  it("extracts content from openai chunk", () => {
    const line = `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}`;
    expect(extractDeltaText(line)).toBe("Hello");
  });

  it("returns empty for [DONE]", () => {
    expect(extractDeltaText("data: [DONE]")).toBe("");
  });

  it("returns empty for non-data lines", () => {
    expect(extractDeltaText(": ping")).toBe("");
    expect(extractDeltaText("event: x")).toBe("");
  });

  it("returns empty for malformed json", () => {
    expect(extractDeltaText("data: {not json")).toBe("");
  });
});

describe("extractUsage", () => {
  it("pulls token counts when present", () => {
    const line = `data: ${JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}`;
    expect(extractUsage(line)).toEqual({ in: 10, out: 5 });
  });

  it("returns null when usage absent", () => {
    expect(extractUsage(`data: ${JSON.stringify({ choices: [] })}`)).toBeNull();
  });
});

describe("extractFinishReason", () => {
  it("returns finish_reason when present", () => {
    const line = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "length" }] })}`;
    expect(extractFinishReason(line)).toBe("length");
  });

  it("returns null when absent or non-data", () => {
    expect(extractFinishReason(`data: ${JSON.stringify({ choices: [{ delta: { content: "x" } }] })}`)).toBeNull();
    expect(extractFinishReason("data: [DONE]")).toBeNull();
    expect(extractFinishReason(": ping")).toBeNull();
  });
});
