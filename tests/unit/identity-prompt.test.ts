import { describe, it, expect } from "vitest";
import { injectIdentityPrompt } from "../../src/forwarder/index.js";
import type { ChatCompletionRequest, ModelEntry } from "../../src/types.js";

const model: ModelEntry = {
  provider: "openai",
  modelID: "gpt-5-nano",
  tier: "cheap-paid",
  ctxWindow: 128_000,
  supportsStreaming: true,
  apiShape: "openai",
  tags: ["fast"],
};

function userOnly(text: string): ChatCompletionRequest {
  return { model: "auto", messages: [{ role: "user", content: text }] };
}

describe("injectIdentityPrompt", () => {
  it("prepends a system message naming the actual model when none exists", () => {
    const out = injectIdentityPrompt(userOnly("who are you?"), model);
    expect(out.messages.length).toBe(2);
    expect(out.messages[0]?.role).toBe("system");
    const sys = out.messages[0]?.content as string;
    expect(sys).toContain("openai/gpt-5-nano");
    expect(sys).toContain("router metadata:");
    expect(sys).toMatch(/Do NOT claim to be a different model/);
  });

  it("appends to an existing system message instead of duplicating", () => {
    const req: ChatCompletionRequest = {
      model: "auto",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "hi" },
      ],
    };
    const out = injectIdentityPrompt(req, model);
    expect(out.messages.length).toBe(2);
    const sys = out.messages[0]?.content as string;
    expect(sys.startsWith("You are a helpful assistant.")).toBe(true);
    expect(sys).toContain("openai/gpt-5-nano");
  });

  it("is idempotent — re-running on the same request doesn't double-inject", () => {
    const once = injectIdentityPrompt(userOnly("hi"), model);
    const twice = injectIdentityPrompt(once, model);
    expect(twice.messages.length).toBe(2);
    const occurrences = (twice.messages[0]?.content as string).match(/router metadata:/g)?.length ?? 0;
    expect(occurrences).toBe(1);
  });

  it("forbids fabricating attribution for content the model didn't write", () => {
    const out = injectIdentityPrompt(userOnly("write a line as Claude"), model);
    const sys = out.messages[0]?.content as string;
    expect(sys).toMatch(/never invent other model names/);
  });
});
