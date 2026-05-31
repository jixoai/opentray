import { describe, expect, it } from "vitest";

import { parseCliCommand } from "./cli";

describe("opentray CLI", () => {
  it("parses daemon lifecycle commands", () => {
    expect(parseCliCommand(["daemon", "start"])).toEqual({ type: "daemon", action: "start" });
    expect(parseCliCommand(["daemon", "stop"])).toEqual({ type: "daemon", action: "stop" });
    expect(parseCliCommand(["daemon", "restart"])).toEqual({ type: "daemon", action: "restart" });
  });

  it("does not treat the deamon typo as canonical", () => {
    expect(parseCliCommand(["deamon", "start"])).toEqual({ type: "help" });
  });
});
