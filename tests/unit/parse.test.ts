import { describe, it, expect } from "vitest";
import { parseRequest } from "../../src/proxy/parse.js";

describe("parseRequest", () => {
  it("extracts inline @model override", () => {
    const result = parseRequest({
      model: "auto",
      messages: [{ role: "user", content: "@gpt-5 fix this bug please" }],
    }, "session-1");
    expect(result.override).toEqual({ modelRef: "gpt-5" });
  });

  it("extracts /upgrade slash command", () => {
    const result = parseRequest({
      model: "auto",
      messages: [{ role: "user", content: "/upgrade and try again" }],
    }, "s2");
    expect(result.signals.upgradeRequested).toBe(true);
  });

  it("detects 'this is wrong' phrase", () => {
    const result = parseRequest({
      model: "auto",
      messages: [{ role: "user", content: "this is wrong, please redo" }],
    }, "s3");
    expect(result.signals.upgradeRequested).toBe(true);
  });

  it("detects 'try again'", () => {
    const result = parseRequest({
      model: "auto",
      messages: [{ role: "user", content: "Hmm, try again with a different approach." }],
    }, "s3");
    expect(result.signals.upgradeRequested).toBe(true);
  });

  it("detects /auto off", () => {
    const result = parseRequest({
      model: "auto",
      messages: [{ role: "user", content: "/auto off — pick model myself for now" }],
    }, "s4");
    expect(result.signals.autoOff).toBe(true);
  });

  it("detects /router reset", () => {
    const result = parseRequest({
      model: "auto",
      messages: [{ role: "user", content: "/router reset please" }],
    }, "s5");
    expect(result.signals.reset).toBe(true);
  });

  it("ignores override mention not at word boundary", () => {
    const result = parseRequest({
      model: "auto",
      messages: [{ role: "user", content: "email@example.com is the contact" }],
    }, "s6");
    expect(result.override).toBeNull();
  });

  it("uses sessionID header when provided", () => {
    const result = parseRequest({
      model: "auto",
      messages: [{ role: "user", content: "hello" }],
    }, "abcd-1234");
    expect(result.sessionID).toBe("abcd-1234");
  });

  it("falls back to default sessionID when header missing", () => {
    const result = parseRequest({
      model: "auto",
      messages: [{ role: "user", content: "hello" }],
    }, null);
    expect(result.sessionID).toMatch(/^session-/);
  });
});
