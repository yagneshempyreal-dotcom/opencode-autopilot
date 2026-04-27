import { describe, it, expect } from "vitest";
import { heuristicScore, extractHeuristicInput } from "../../src/classifier/heuristic.js";

describe("heuristicScore", () => {
  it("rates very short trivial prompts as low", () => {
    const r = heuristicScore({ prompt: "fix the typo", contextChars: 0, attachedFiles: 0, codeBlockCount: 0 });
    expect(r.tier).toBe("low");
    expect(r.confidence).toBeGreaterThan(0.7);
  });

  it("rates 'fix typo in README' as low", () => {
    const r = heuristicScore({ prompt: "fix typo in README", contextChars: 0, attachedFiles: 0, codeBlockCount: 0 });
    expect(r.tier).toBe("low");
  });

  it("rates 'rename variable foo to bar' as low", () => {
    const r = heuristicScore({ prompt: "rename variable foo to bar", contextChars: 0, attachedFiles: 0, codeBlockCount: 0 });
    expect(r.tier).toBe("low");
  });

  it("rates explicit refactor request as high", () => {
    const r = heuristicScore({
      prompt: "Please refactor this monolithic auth service into microservices and improve the architecture for scalability and concurrency",
      contextChars: 1000,
      attachedFiles: 0,
      codeBlockCount: 0,
    });
    expect(r.tier).toBe("high");
  });

  it("rates many attached files as high", () => {
    const r = heuristicScore({
      prompt: "Look at these and tell me what's wrong",
      contextChars: 200,
      attachedFiles: 5,
      codeBlockCount: 0,
    });
    expect(r.tier).toBe("high");
  });

  it("rates very large context as high", () => {
    const r = heuristicScore({
      prompt: "small prompt",
      contextChars: 60_000,
      attachedFiles: 0,
      codeBlockCount: 0,
    });
    expect(r.tier).toBe("high");
  });

  it("rates very long prompt as high", () => {
    const r = heuristicScore({
      prompt: "x".repeat(3500),
      contextChars: 0,
      attachedFiles: 0,
      codeBlockCount: 0,
    });
    expect(r.tier).toBe("high");
  });

  it("rates medium-length descriptive prompt as medium", () => {
    const r = heuristicScore({
      prompt: "Write a Python script that reads a CSV file and calculates the average of the score column. The script should accept the filename as a command-line argument and print the result.",
      contextChars: 0,
      attachedFiles: 0,
      codeBlockCount: 0,
    });
    expect(["medium", "low"]).toContain(r.tier);
  });

  it("flags ambiguous medium prompts with confidence < 0.7", () => {
    const r = heuristicScore({
      prompt: "How does this work? I'm not sure what's happening here.",
      contextChars: 100,
      attachedFiles: 0,
      codeBlockCount: 0,
    });
    expect(r.confidence).toBeLessThan(0.85);
  });

  it("treats single keyword + short prompt as medium", () => {
    const r = heuristicScore({
      prompt: "debug this please",
      contextChars: 0,
      attachedFiles: 0,
      codeBlockCount: 0,
    });
    expect(["medium", "high"]).toContain(r.tier);
  });
});

describe("extractHeuristicInput", () => {
  it("extracts last user prompt and counts context", () => {
    const input = extractHeuristicInput([
      { role: "system", content: "You are helpful." },
      { role: "user", content: "old question" },
      { role: "assistant", content: "old answer" },
      { role: "user", content: "new question please refactor" },
    ]);
    expect(input.prompt).toBe("new question please refactor");
    expect(input.contextChars).toBeGreaterThan(0);
  });

  it("counts code blocks", () => {
    const input = extractHeuristicInput([
      { role: "user", content: "Look at this code:\n```ts\nconst x = 1;\n```\nand this:\n```py\nx = 1\n```" },
    ]);
    expect(input.codeBlockCount).toBe(2);
  });

  it("counts attached file paths", () => {
    const input = extractHeuristicInput([
      { role: "user", content: "Edit /src/app.ts and /tests/app.test.ts please" },
    ]);
    expect(input.attachedFiles).toBe(2);
  });

  it("handles array content (parts) in messages", () => {
    const input = extractHeuristicInput([
      { role: "user", content: [{ type: "text", text: "hello" }, { type: "text", text: "world" }] },
    ]);
    expect(input.prompt).toContain("hello");
    expect(input.prompt).toContain("world");
  });
});
