/**
 * Prompt-editor rules that do not need a terminal.
 *
 * The interesting decisions here are about keys and geometry, and both are
 * cheap to get wrong in a way no rendered frame makes obvious.
 */
import type { KeyBinding } from "@opentui/core";

/** Most rows the prompt editor may occupy before it scrolls internally. */
export const MAX_EDITOR_ROWS = 10;

/**
 * How tall the editor should be for this text.
 *
 * Counts logical lines, not wrapped ones: a wrapped long line is rarer than a
 * pasted block, and reading the renderable's own visual line count would make
 * the height depend on a value that is only correct after a layout pass.
 */
export function editorRows(text: string, max: number = MAX_EDITOR_ROWS): number {
  const lines = text.split("\n").length;
  return Math.min(Math.max(lines, 1), max);
}

/**
 * Rocky's prompt bindings, replacing the textarea's Enter handling.
 *
 * Upstream's default is the editor convention — Enter inserts a newline, Alt+
 * Enter submits. A prompt is the other way round: Enter sends, and a newline is
 * the deliberate act. Three ways to reach one are offered because terminals
 * disagree about which they can even report: Shift+Enter needs an enhanced
 * keyboard protocol, Alt+Enter is widely available, and Ctrl+J arrives as a
 * bare linefeed and works essentially everywhere.
 *
 * Built by replacing the Enter-family bindings rather than appending to them,
 * so the result does not depend on which end of the list wins a conflict.
 */
export function promptKeyBindings(defaults: readonly KeyBinding[]): KeyBinding[] {
  const enterKeys = new Set(["return", "kpenter", "linefeed"]);
  const kept = defaults.filter((binding) => !enterKeys.has(binding.name));
  return [
    ...kept,
    { name: "return", action: "submit" },
    { name: "kpenter", action: "submit" },
    { name: "return", shift: true, action: "newline" },
    { name: "kpenter", shift: true, action: "newline" },
    { name: "return", meta: true, action: "newline" },
    { name: "kpenter", meta: true, action: "newline" },
    { name: "linefeed", action: "newline" },
  ];
}
