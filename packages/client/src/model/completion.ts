/**
 * Slash-command completion: which commands match what is being typed.
 *
 * Pure and free of OpenTUI and Solid, so the matching and ranking rules — the
 * part most likely to be wrong — are tested in the Node suite alongside the
 * transcript reducer. The UI layer only renders the result.
 */
import type { SlashCommand } from "@rocky/contract";

/** How many suggestions a popup shows at once. */
export const COMPLETION_LIMIT = 8;

/**
 * The command prefix being typed, or undefined when completion does not apply.
 *
 * Completion is offered only while the whole input is one unbroken `/token`:
 * once there is whitespace the user is writing arguments, and a popup that
 * stayed open would hijack the arrow keys for the rest of the line. A bare `/`
 * returns an empty query, which lists everything.
 */
export function completionQuery(text: string): string | undefined {
  if (!text.startsWith("/")) {
    return undefined;
  }
  const rest = text.slice(1);
  return /\s/.test(rest) ? undefined : rest;
}

/**
 * Rank commands against a query.
 *
 * Prefix matches come before substring matches, because typing `/co` means the
 * user is far more likely to want `compact` than `skill:git-commit`. Within a
 * tier the core's own order is preserved: extensions, then prompt templates,
 * then skills, which is the order the inherited TUI shows them in.
 */
export function filterCommands(
  commands: readonly SlashCommand[],
  query: string,
  limit: number = COMPLETION_LIMIT,
): SlashCommand[] {
  const needle = query.toLowerCase();
  const prefix: SlashCommand[] = [];
  const substring: SlashCommand[] = [];
  for (const command of commands) {
    const name = command.name.toLowerCase();
    if (name.startsWith(needle)) {
      prefix.push(command);
    } else if (needle.length > 0 && name.includes(needle)) {
      substring.push(command);
    }
  }
  return [...prefix, ...substring].slice(0, limit);
}

/** Keep a selection inside a list that just changed size. */
export function clampSelection(index: number, length: number): number {
  if (length === 0) {
    return 0;
  }
  return Math.min(Math.max(index, 0), length - 1);
}

/** Move a selection, wrapping, so holding a key never dead-ends. */
export function moveSelection(index: number, length: number, delta: number): number {
  if (length === 0) {
    return 0;
  }
  return (((index + delta) % length) + length) % length;
}

/**
 * The input text after accepting a suggestion.
 *
 * A trailing space is appended so arguments can be typed straight away — and,
 * because a space ends the completion query, accepting also closes the popup
 * rather than leaving it matching its own result.
 */
export function applyCompletion(command: SlashCommand): string {
  return `/${command.name} `;
}

/** One rendered suggestion row. */
export function completionLabel(command: SlashCommand): string {
  const hint = command.argumentHint ? ` ${command.argumentHint}` : "";
  return `/${command.name}${hint}`;
}
