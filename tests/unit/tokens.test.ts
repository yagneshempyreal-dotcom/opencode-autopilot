import { describe, it, expect } from "vitest";
import { estimateStringTokens, estimateMessageTokens, estimateRequestTokens } from "../../src/util/tokens.js";

describe("token estimation", () => {
  it("estimateStringTokens scales with length", () => {
    expect(estimateStringTokens("")).toBe(0);
    expect(estimateStringTokens("hello")).toBeGreaterThan(0);
    expect(estimateStringTokens("a".repeat(100))).toBeGreaterThan(estimateStringTokens("a".repeat(10)));
  });

  it("estimateMessageTokens handles string content", () => {
    const tok = estimateMessageTokens({ role: "user", content: "Hello world" });
    expect(tok).toBeGreaterThan(4);
  });

  it("estimateMessageTokens handles parts content", () => {
    const tok = estimateMessageTokens({
      role: "user",
      content: [{ type: "text", text: "Hello" }, { type: "text", text: "world" }],
    });
    expect(tok).toBeGreaterThan(4);
  });

  it("estimateRequestTokens sums messages", () => {
    const total = estimateRequestTokens([
      { role: "system", content: "x".repeat(100) },
      { role: "user", content: "y".repeat(50) },
    ]);
    expect(total).toBeGreaterThan(estimateStringTokens("x".repeat(100)));
  });
});
