/**
 * Slash-command completion rules.
 *
 * Lives in the Node suite alongside the transcript reducer, because the model
 * layer is free of OpenTUI and Solid on purpose: the ranking and the
 * "when is the popup open" rule are the parts most likely to be wrong.
 */
import { describe, expect, it } from "vitest";
import type { CommandEntry } from "../packages/client/src/model/commands.js";
import {
  applyCompletion,
  clampSelection,
  completionLabel,
  completionQuery,
  filterCommands,
  moveSelection,
} from "../packages/client/src/model/completion.js";

const COMMANDS: CommandEntry[] = [
  { name: "compact", description: "Compact the conversation", origin: "core" },
  { name: "explain", origin: "core", argumentHint: "<path>" },
  { name: "skill:git-commit", origin: "core" },
  { name: "copy", origin: "core" },
];

describe("completionQuery", () => {
  it("offers completion for a bare slash", () => {
    expect(completionQuery("/")).toBe("");
  });

  it("returns the token being typed", () => {
    expect(completionQuery("/comp")).toBe("comp");
  });

  it("stops once arguments start, so the arrows go back to history", () => {
    expect(completionQuery("/explain src/app.ts")).toBeUndefined();
    expect(completionQuery("/explain ")).toBeUndefined();
  });

  it("does not fire on ordinary prose containing a slash", () => {
    expect(completionQuery("what is in src/app.ts")).toBeUndefined();
    expect(completionQuery("")).toBeUndefined();
  });
});

describe("filterCommands", () => {
  it("lists everything for an empty query", () => {
    expect(filterCommands(COMMANDS, "").map((command) => command.name)).toEqual([
      "compact",
      "explain",
      "skill:git-commit",
      "copy",
    ]);
  });

  it("ranks prefix matches ahead of substring matches", () => {
    expect(filterCommands(COMMANDS, "co").map((command) => command.name)).toEqual([
      "compact",
      "copy",
      "skill:git-commit",
    ]);
  });

  it("matches case-insensitively", () => {
    expect(filterCommands(COMMANDS, "EXPL").map((command) => command.name)).toEqual(["explain"]);
  });

  it("caps the list", () => {
    expect(filterCommands(COMMANDS, "", 2)).toHaveLength(2);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterCommands(COMMANDS, "zzz")).toEqual([]);
  });
});

describe("selection", () => {
  it("clamps into a list that shrank", () => {
    expect(clampSelection(5, 2)).toBe(1);
    expect(clampSelection(-1, 2)).toBe(0);
    expect(clampSelection(3, 0)).toBe(0);
  });

  it("wraps in both directions", () => {
    expect(moveSelection(0, 3, -1)).toBe(2);
    expect(moveSelection(2, 3, 1)).toBe(0);
    expect(moveSelection(0, 0, 1)).toBe(0);
  });
});

describe("accepting a suggestion", () => {
  it("leaves a trailing space, which also closes the popup", () => {
    const text = applyCompletion(COMMANDS[1] as CommandEntry);
    expect(text).toBe("/explain ");
    expect(completionQuery(text)).toBeUndefined();
  });

  it("shows the argument hint in the label", () => {
    expect(completionLabel(COMMANDS[1] as CommandEntry)).toBe("/explain <path>");
    expect(completionLabel(COMMANDS[0] as CommandEntry)).toBe("/compact");
  });
});
