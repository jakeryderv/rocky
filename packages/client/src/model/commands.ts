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
