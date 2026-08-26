/**
 * Which front end an invocation belongs to.
 *
 * Pure, and driven by the harness's own parser rather than by substring
 * matching on argv. Matching strings is how `rocky "please use --legacy-tui"`
 * becomes a legacy launch instead of a prompt, and how `--model --legacy-tui`
 * becomes one — the parser knows which tokens are flags and which are values,
 * and this has no business guessing.
 *
 * Three outcomes, not two. Refusing is a real answer: the client cannot yet
 * honour most session-shaping flags, and routing to it anyway would silently
 * drop something the user typed. Naming the flag and the escape hatch is worth
 * more than a launch that quietly ignores half the command line.
 */

/** Subcommands the harness owns outright. Each is only a subcommand as argv[0]. */
export const HARNESS_SUBCOMMANDS = [
  "auth",
  "config",
  "install",
  "list",
  "remove",
  "uninstall",
  "update",
] as const;

/** The flag that keeps the inherited TUI reachable while it still exists. */
export const LEGACY_TUI_FLAG = "legacy-tui";

/** The slice of the harness's parsed arguments this needs. */
export interface ParsedInvocation {
  help?: boolean | undefined;
  version?: boolean | undefined;
  print?: boolean | undefined;
  export?: string | undefined;
  listModels?: string | true | undefined;
  mode?: string | undefined;
  offline?: boolean | undefined;
  sessionDir?: string | undefined;
  messages: string[];
  fileArgs: string[];
  unknownFlags: Map<string, boolean | string>;
}

export interface RouteInput {
  argv: readonly string[];
  parse: (args: string[]) => ParsedInvocation;
  /** Both streams are a terminal. The client cannot run without one. */
  isInteractive: boolean;
  /**
   * Whether the client may be chosen at all.
   *
   * False keeps every invocation on the harness, so the router can land and be
   * tested without changing what anyone gets. Flipping this is the one-way
   * door, and it is deliberately a single flag.
   */
  clientEnabled: boolean;
  /** `PI_STARTUP_BENCHMARK` is InteractiveMode-only and must reach it. */
  startupBenchmark?: boolean | undefined;
}

export type RockyRoute =
  | { target: "harness"; args: string[]; reason: string }
  | {
      target: "client";
      args: string[];
      reason: string;
      options: { sessionDir?: string; offline?: boolean };
    }
  | { target: "refuse"; message: string; reason: string };

/**
 * Everything the client cannot honour, mapped to what it can offer instead.
 *
 * Keyed by the flag as a user types it, because that is what the message has to
 * name back to them.
 */
const UNSUPPORTED_FLAGS: Record<string, string> = {
  "--model": "pick a model with /model once running",
  "--provider": "pick a model with /model once running",
  "--api-key": "sign in with /login once running",
  "--thinking": "set it with /thinking once running",
  "--continue": "resume with /resume once running",
  "--resume": "resume with /resume once running",
  "--session": "resume with /resume once running",
  "--session-id": "resume with /resume once running",
  "--fork": "fork with /fork once running",
  "--name": "name the session with /name once running",
};

/**
 * Remove `--legacy-tui` before the harness parser sees it.
 *
 * It is an unknown flag to that parser, and an unknown flag swallows the next
 * token when that token does not itself look like a flag — so `--legacy-tui hi`
 * would lose the message entirely. Stripping first means the rest of argv
 * parses exactly as it would have without the flag.
 */
export function stripLegacyTuiFlag(argv: readonly string[]): { args: string[]; requested: boolean } {
  const args: string[] = [];
  let requested = false;
  for (const arg of argv) {
    if (arg === `--${LEGACY_TUI_FLAG}` || arg.startsWith(`--${LEGACY_TUI_FLAG}=`)) {
      requested = true;
      continue;
    }
    args.push(arg);
  }
  return { args, requested };
}

export function routeRockyInvocation(input: RouteInput): RockyRoute {
  const { args, requested: legacyRequested } = stripLegacyTuiFlag(input.argv);
  const toHarness = (reason: string): RockyRoute => ({ target: "harness", args: [...input.argv], reason });

  // Subcommands are only subcommands in first position, so that a message
  // beginning with the word "list" is still a message.
  const subcommand = args[0];
  if (subcommand !== undefined && (HARNESS_SUBCOMMANDS as readonly string[]).includes(subcommand)) {
    return toHarness(`\`${subcommand}\` is a harness subcommand`);
  }

  if (legacyRequested) {
    return toHarness("--legacy-tui was requested");
  }

  const parsed = input.parse(args);

  if (parsed.help) {
    return toHarness("--help is answered by the harness");
  }
  if (parsed.version) {
    return toHarness("--version is answered by the harness");
  }
  if (parsed.listModels !== undefined) {
    return toHarness("--list-models is answered by the harness");
  }
  if (parsed.export !== undefined) {
    return toHarness("--export is answered by the harness");
  }
  if (parsed.print) {
    return toHarness("--print is non-interactive");
  }
  if (parsed.mode !== undefined && parsed.mode !== "interactive") {
    return toHarness(`--mode ${parsed.mode} is non-interactive`);
  }
  if (input.startupBenchmark) {
    // Only InteractiveMode reports it; anywhere else it is an error.
    return toHarness("PI_STARTUP_BENCHMARK measures the inherited TUI");
  }
  if (!input.isInteractive) {
    // The client cannot run without a terminal, and the harness at least fails
    // with a message rather than writing escape sequences into a pipe.
    return toHarness("no terminal is attached");
  }

  if (!input.clientEnabled) {
    return toHarness("the client is not the default yet");
  }

  // Everything from here is an interactive session the client would take.
  const unsupported = collectUnsupported(args, parsed);
  if (unsupported.length > 0) {
    return {
      target: "refuse",
      reason: "the client cannot honour every argument given",
      message: refusalMessage(unsupported),
    };
  }

  return {
    target: "client",
    args,
    reason: "an interactive session",
    options: {
      ...(parsed.sessionDir !== undefined ? { sessionDir: parsed.sessionDir } : {}),
      ...(parsed.offline ? { offline: true } : {}),
    },
  };
}

/** What the user typed that the client would otherwise silently ignore. */
function collectUnsupported(args: readonly string[], parsed: ParsedInvocation): string[] {
  const found: string[] = [];
  for (const [flag, alternative] of Object.entries(UNSUPPORTED_FLAGS)) {
    // Read from argv rather than from the parsed shape, so the message names
    // the flag the way it was written.
    if (args.some((arg) => arg === flag || arg.startsWith(`${flag}=`))) {
      found.push(`${flag} — ${alternative}`);
    }
  }
  if (parsed.messages.length > 0) {
    found.push("an initial message — type it once running");
  }
  if (parsed.fileArgs.length > 0) {
    found.push("@file attachments — attach them once running");
  }
  for (const flag of parsed.unknownFlags.keys()) {
    found.push(`--${flag} — an extension flag the client does not forward`);
  }
  return found;
}

function refusalMessage(unsupported: readonly string[]): string {
  return [
    "The Rocky client does not accept these yet:",
    ...unsupported.map((entry) => `  ${entry}`),
    "",
    "Run the same command with --legacy-tui to use the previous interface.",
  ].join("\n");
}
