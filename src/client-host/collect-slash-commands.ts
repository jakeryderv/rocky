/**
 * Assemble the session's `/name` commands from the three registries that hold
 * them.
 *
 * The harness merges these in a private closure it never exposes
 * (`core/agent-session.ts`, the `getCommands()` passed to `bindCore`), so a
 * host that is not the RPC mode has to reassemble the list. The field names and
 * the `skill:` prefix follow that closure deliberately: this is a copy of an
 * upstream shape, not a Rocky invention, which is what keeps the client's
 * command list identical to the inherited TUI's.
 *
 * Built-in commands are not included, and that is the seam: the core's builtins
 * are `pi-tui` screens the client cannot run. Commands the client implements
 * itself belong to the client.
 */

/** The slice of `AgentSession` this reads. Structural, so it is testable with a fake. */
export interface SlashCommandSources {
  readonly promptTemplates?: readonly {
    name: string;
    description?: string;
    argumentHint?: string;
    sourceInfo?: { scope?: string };
  }[];
  readonly extensionRunner?: {
    getRegisteredCommands(): readonly {
      invocationName: string;
      description?: string;
      sourceInfo?: { scope?: string };
    }[];
  };
  readonly resourceLoader?: {
    getSkills(): {
      skills: readonly { name: string; description?: string; sourceInfo?: { scope?: string } }[];
    };
  };
}

export interface HarnessSlashCommand {
  name: string;
  description?: string | undefined;
  source: string;
  argumentHint?: string | undefined;
  sourceInfo?: { scope?: string } | undefined;
}

/**
 * Read all three registries, tolerating any of them being unavailable.
 *
 * A registry that throws is skipped rather than failing the whole list: an
 * extension that fails to load must not cost the user their skills and prompt
 * templates too.
 */
export function collectSlashCommands(session: SlashCommandSources): HarnessSlashCommand[] {
  const commands: HarnessSlashCommand[] = [];

  try {
    for (const command of session.extensionRunner?.getRegisteredCommands() ?? []) {
      // `invocationName`, not `name`: the runner disambiguates same-named
      // commands from different extensions by suffixing, and the invocation
      // name is the one that actually resolves.
      commands.push({
        name: command.invocationName,
        description: command.description,
        source: "extension",
        sourceInfo: command.sourceInfo,
      });
    }
  } catch {
    // A broken extension registry costs its own commands, nothing else.
  }

  try {
    for (const template of session.promptTemplates ?? []) {
      commands.push({
        name: template.name,
        description: template.description,
        source: "prompt",
        argumentHint: template.argumentHint,
        sourceInfo: template.sourceInfo,
      });
    }
  } catch {
    // As above.
  }

  try {
    for (const skill of session.resourceLoader?.getSkills().skills ?? []) {
      commands.push({
        name: `skill:${skill.name}`,
        description: skill.description,
        source: "skill",
        sourceInfo: skill.sourceInfo,
      });
    }
  } catch {
    // As above.
  }

  return commands;
}
