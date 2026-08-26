/**
 * The client's own `/` commands, merged with the core's for completion.
 *
 * The core deliberately does not list its built-in commands: they are `pi-tui`
 * screens the client cannot run (`core/slash-commands.ts`). So a `/model` or a
 * `/compact` offered here is the client's to implement, and `origin` is what
 * tells the two apart at submit time — a core command is sent as a `prompt`,
 * which is what dispatches it; a client command never reaches the core.
 *
 * Pure, so the routing rule is tested without a terminal.
 */
import type { SlashCommand } from "@rocky/contract";

export interface CommandEntry {
  name: string;
  description?: string;
  argumentHint?: string;
  origin: "core" | "client";
}

/** Commands the client handles itself. */
export const CLIENT_COMMANDS: readonly CommandEntry[] = [
  { name: "model", description: "Switch the active model", origin: "client" },
  { name: "resume", description: "Resume a previous session", origin: "client" },
  { name: "new", description: "Start a new session", origin: "client" },
  {
    name: "compact",
    description: "Summarize the conversation so far",
    argumentHint: "[what to keep]",
    origin: "client",
  },
  { name: "autocompact", description: "Toggle automatic compaction", origin: "client" },
  { name: "steering", description: "Toggle how steering messages are released", origin: "client" },
  { name: "followup", description: "Toggle how follow-up messages are released", origin: "client" },
  { name: "fork", description: "Continue from an earlier message", origin: "client" },
  { name: "clone", description: "Copy this session and continue in the copy", origin: "client" },
  {
    name: "export",
    description: "Write the conversation out as HTML",
    argumentHint: "[path]",
    origin: "client",
  },
  { name: "name", description: "Name this session", argumentHint: "<name>", origin: "client" },
  { name: "stats", description: "Show what this session has cost", origin: "client" },
  { name: "settings", description: "Show this session's settings", origin: "client" },
  { name: "theme", description: "Switch the colour theme", origin: "client" },
  { name: "thinking", description: "Set how much the model reasons", origin: "client" },
  { name: "keys", description: "Show what the keys do", origin: "client" },
];

/**
 * Client commands first: they are few, always available, and shadowing one with
 * a project command would make `/model` mean different things in different
 * directories.
 */
export function mergeCommands(core: readonly SlashCommand[]): CommandEntry[] {
  const claimed = new Set(CLIENT_COMMANDS.map((command) => command.name));
  const merged: CommandEntry[] = [...CLIENT_COMMANDS];
  for (const command of core) {
    if (claimed.has(command.name)) {
      continue;
    }
    merged.push({
      name: command.name,
      ...(command.description !== undefined ? { description: command.description } : {}),
      ...(command.argumentHint !== undefined ? { argumentHint: command.argumentHint } : {}),
      origin: "core",
    });
  }
  return merged;
}

/**
 * A shell command typed at the prompt.
 *
 * `!cmd` runs it and shows it to the model; `!!cmd` keeps both out of context.
 * The doubled prefix is the inherited TUI's convention, kept so the two front
 * ends do not disagree about what `!!` means.
 */
export function parseBashPrefix(text: string): { command: string; excludeFromContext: boolean } | undefined {
  if (!text.startsWith("!")) {
    return undefined;
  }
  const excludeFromContext = text.startsWith("!!");
  const command = text.slice(excludeFromContext ? 2 : 1).trim();
  return command.length === 0 ? undefined : { command, excludeFromContext };
}

/**
 * Route submitted text: a client command, or something for the core.
 *
 * Matching is exact on the first token, so `/models` and `/model-foo` go to the
 * core rather than being swallowed by `/model`.
 */
export function routeSubmission(
  text: string,
  commands: readonly CommandEntry[] = CLIENT_COMMANDS,
): { kind: "client"; name: string; args: string } | { kind: "core" } {
  if (!text.startsWith("/")) {
    return { kind: "core" };
  }
  const body = text.slice(1);
  const separator = body.search(/\s/);
  const name = separator === -1 ? body : body.slice(0, separator);
  const args = separator === -1 ? "" : body.slice(separator + 1).trim();
  const match = commands.find((command) => command.origin === "client" && command.name === name);
  return match ? { kind: "client", name, args } : { kind: "core" };
}
