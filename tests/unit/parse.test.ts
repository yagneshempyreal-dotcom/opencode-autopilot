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

  it("extracts /upgrade legacy slash command", () => {
    const result = parseRequest({
      model: "auto",
      messages: [{ role: "user", content: "/upgrade" }],
    }, "s2");
    expect(result.signals.upgradeRequested).toBe(true);
  });

  it("accepts router upgrade (bare prefix)", () => {
    const result = parseRequest({
      model: "auto",
      messages: [{ role: "user", content: "router upgrade" }],
    }, "s2b");
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
      messages: [{ role: "user", content: "/auto off" }],
    }, "s4");
    expect(result.signals.autoOff).toBe(true);
  });

  it("accepts router auto off (bare prefix)", () => {
    const result = parseRequest({
      model: "auto",
      messages: [{ role: "user", content: "router auto off" }],
    }, "s4b");
    expect(result.signals.autoOff).toBe(true);
  });

  it("detects /router reset (legacy)", () => {
    const result = parseRequest({
      model: "auto",
      messages: [{ role: "user", content: "/router reset" }],
    }, "s5");
    expect(result.signals.reset).toBe(true);
  });

  it("accepts router reset (bare prefix)", () => {
    const result = parseRequest({
      model: "auto",
      messages: [{ role: "user", content: "router reset" }],
    }, "s5b");
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

  it("router goal cost (bare)", () => {
    const r = parseRequest({
      model: "auto",
      messages: [{ role: "user", content: "router goal cost" }],
    }, "s7");
    expect(r.signals.goalSwitch).toBe("cost");
  });

  it("router goal quality (bare)", () => {
    const r = parseRequest({
      model: "auto",
      messages: [{ role: "user", content: "router goal quality" }],
    }, "s8");
    expect(r.signals.goalSwitch).toBe("quality");
  });

  it("/router goal balance (legacy)", () => {
    const r = parseRequest({
      model: "auto",
      messages: [{ role: "user", content: "/router goal balance" }],
    }, "s9");
    expect(r.signals.goalSwitch).toBe("balance");
  });

  it("ignores invalid goal value", () => {
    const r = parseRequest({
      model: "auto",
      messages: [{ role: "user", content: "router goal whatever" }],
    }, "s10");
    expect(r.signals.goalSwitch).toBeNull();
  });

  it("router status (bare)", () => {
    const r = parseRequest({
      model: "auto",
      messages: [{ role: "user", content: "router status" }],
    }, "s11");
    expect(r.signals.statusRequested).toBe(true);
  });

  it("router models (bare)", () => {
    const r = parseRequest({
      model: "auto",
      messages: [{ role: "user", content: "router models" }],
    }, "s12");
    expect(r.signals.modelsRequested).toBe(true);
  });

  it("accepts #router and :router and >router prefixes", () => {
    for (const p of ["#", ":", ">"]) {
      const r = parseRequest({
        model: "auto",
        messages: [{ role: "user", content: `${p}router goal balance` }],
      }, "p" + p);
      expect(r.signals.goalSwitch).toBe("balance");
    }
  });

  it("does not false-trigger on prose mentioning router", () => {
    const r1 = parseRequest({
      model: "auto",
      messages: [{ role: "user", content: "the router goal we discussed earlier needs review" }],
    }, "s17a");
    expect(r1.signals.goalSwitch).toBeNull();
    const r2 = parseRequest({
      model: "auto",
      messages: [{ role: "user", content: "please router this through the proxy" }],
    }, "s17b");
    expect(r2.signals.goalSwitch).toBeNull();
    expect(r2.signals.statusRequested).toBe(false);
  });

  it("does not false-trigger on bare 'upgrade' word", () => {
    const r = parseRequest({
      model: "auto",
      messages: [{ role: "user", content: "we should upgrade the dependency" }],
    }, "s18");
    expect(r.signals.upgradeRequested).toBe(false);
  });
});
