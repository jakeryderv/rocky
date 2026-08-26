/**
 * Prompt-editor rules.
 *
 * The Enter binding is the one most likely to be silently wrong: the textarea's
 * default is the editor convention (Enter inserts, Alt+Enter submits) and a
 * prompt needs the opposite.
 */
import { describe, expect, it } from "vitest";
import { editorRows, MAX_EDITOR_ROWS, promptKeyBindings } from "../packages/client/src/model/editor.js";

describe("editorRows", () => {
  it("keeps one row for an empty or single-line draft", () => {
    expect(editorRows("")).toBe(1);
    expect(editorRows("just one line")).toBe(1);
  });

  it("grows with the number of logical lines", () => {
    expect(editorRows("a\nb\nc")).toBe(3);
  });

  // A long paste must not swallow the transcript.
  it("stops at the bound", () => {
    expect(editorRows("x\n".repeat(200))).toBe(MAX_EDITOR_ROWS);
  });
});

describe("promptKeyBindings", () => {
  const defaults = [
    { name: "return", action: "newline" },
    { name: "kpenter", action: "newline" },
    { name: "linefeed", action: "newline" },
    { name: "return", meta: true, action: "submit" },
    { name: "backspace", action: "backspace" },
  ] as never;

  const bindings = () => promptKeyBindings(defaults);
  const find = (name: string, modifier?: "shift" | "meta") =>
    bindings().filter(
      (binding) =>
        binding.name === name &&
        (modifier === "shift" ? binding.shift === true : binding.shift !== true) &&
        (modifier === "meta" ? binding.meta === true : binding.meta !== true),
    );

  it("makes a bare Enter submit", () => {
    expect(find("return").map((binding) => binding.action)).toEqual(["submit"]);
    expect(find("kpenter").map((binding) => binding.action)).toEqual(["submit"]);
  });

  it("offers three ways to reach a newline, because terminals disagree", () => {
    expect(find("return", "shift").map((binding) => binding.action)).toEqual(["newline"]);
    expect(find("return", "meta").map((binding) => binding.action)).toEqual(["newline"]);
    expect(find("linefeed").map((binding) => binding.action)).toEqual(["newline"]);
  });

  // Replacing rather than appending, so the result does not depend on which
  // end of the list wins a conflict.
  it("leaves exactly one binding per Enter combination", () => {
    for (const [name, modifier] of [
      ["return", undefined],
      ["kpenter", undefined],
      ["return", "shift"],
      ["linefeed", undefined],
    ] as const) {
      expect(find(name, modifier)).toHaveLength(1);
    }
  });

  it("keeps every non-Enter binding untouched", () => {
    expect(bindings().filter((binding) => binding.name === "backspace")).toEqual([
      { name: "backspace", action: "backspace" },
    ]);
  });
});
