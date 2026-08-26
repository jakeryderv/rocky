/**
 * Which `/` commands the client owns, and how a submission is routed.
 *
 * The core deliberately does not list its built-ins — they are `pi-tui` screens
 * the client cannot run — so anything the client offers it must also handle.
 * The routing rule is where that split becomes real.
 */
import { describe, expect, it } from "vitest";
import { CLIENT_COMMANDS, mergeCommands, routeSubmission } from "../packages/client/src/model/commands.js";
import type { SlashCommand } from "../src/contract/index.js";

const CORE: SlashCommand[] = [
  { name: "review", description: "Review the diff", source: "extension" },
  { name: "explain", source: "prompt", argumentHint: "<path>" },
];

describe("mergeCommands", () => {
  it("puts the client's own commands first", () => {
    expect(mergeCommands(CORE).map((command) => command.name)).toEqual([
      ...CLIENT_COMMANDS.map((command) => command.name),
      "review",
      "explain",
    ]);
  });

  it("carries the core's description and argument hint across", () => {
    expect(mergeCommands(CORE).find((command) => command.name === "explain")).toEqual({
      name: "explain",
      argumentHint: "<path>",
      origin: "core",
    });
  });

  // Otherwise `/model` would mean different things in different directories.
  it("does not let a project command shadow a client one", () => {
    const merged = mergeCommands([{ name: "model", description: "not ours", source: "extension" }]);
    expect(merged.filter((command) => command.name === "model")).toEqual([
      { name: "model", description: "Switch the active model", origin: "client" },
    ]);
  });
});

describe("routeSubmission", () => {
  it("sends ordinary prose to the core", () => {
    expect(routeSubmission("explain this repo")).toEqual({ kind: "core" });
  });

  it("sends an unknown slash command to the core, which is what dispatches it", () => {
    expect(routeSubmission("/review")).toEqual({ kind: "core" });
  });

  it("claims a client command, with its arguments", () => {
    expect(routeSubmission("/model")).toEqual({ kind: "client", name: "model", args: "" });
    expect(routeSubmission("/model  opus  ")).toEqual({ kind: "client", name: "model", args: "opus" });
  });

  // Exact match on the first token: a prefix must not be swallowed.
  it("does not claim a command that merely starts the same", () => {
    expect(routeSubmission("/models")).toEqual({ kind: "core" });
    expect(routeSubmission("/model-foo")).toEqual({ kind: "core" });
  });
});
