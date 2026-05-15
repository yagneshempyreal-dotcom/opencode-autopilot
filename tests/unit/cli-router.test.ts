import { describe, it, expect } from "vitest";
import { printHelp } from "../../src/cli/router.js";
import { flag, parsePort } from "../../src/cli/args.js";

describe("cli router", () => {
  it("printHelp does not throw", () => {
    expect(() => printHelp()).not.toThrow();
  });

  it("parses flags", () => {
    expect(flag(["--port=4318", "x"], "port")).toBe("4318");
    expect(parsePort(["--port=4318"], 4317)).toBe(4318);
  });
});
