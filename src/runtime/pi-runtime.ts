import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI, InlineExtension } from "@jakeryderv/rocky-harness";

const ROCKY_CONFIG_DIR = ".rocky";
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

class RockyRuntimeError extends Error {
  override readonly name = "RockyRuntimeError";
}

export interface SessionStoragePaths {
  getSessionDir(): string;
  getSessionFile(): string | undefined;
}

function isTruthy(value: string | undefined): boolean {
  return value !== undefined && ["1", "true", "yes"].includes(value.toLowerCase());
}

function applyMode(path: string, mode: number): void {
  if (process.platform !== "win32") {
    chmodSync(path, mode);
  }
}

export function ensurePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  applyMode(path, PRIVATE_DIRECTORY_MODE);
}

/**
 * Enforce private modes on session storage.
 *
 * The session file itself must not be created here: the harness writes it
 * lazily on the first assistant message using an exclusive-create (`wx`), so
 * pre-creating the path makes that flush fail with EEXIST. The harness creates
 * its own session files owner-only; this only covers the directories and any
 * file that already exists (resumed or imported sessions).
 */
export function enforcePrivateSessionStorage(sessionManager: SessionStoragePaths): void {
  const sessionDirectory = sessionManager.getSessionDir();
  if (sessionDirectory) {
    ensurePrivateDirectory(sessionDirectory);
  }

  const sessionFile = sessionManager.getSessionFile();
  if (!sessionFile) {
    return;
  }
  ensurePrivateDirectory(dirname(sessionFile));
  if (existsSync(sessionFile)) {
    applyMode(sessionFile, PRIVATE_FILE_MODE);
  }
}

export function beginPrivateCreationMask(): () => void {
  if (process.platform === "win32") {
    return () => {};
  }
  const previous = process.umask(0o077);
  let restored = false;
  return () => {
    if (!restored) {
      process.umask(previous);
      restored = true;
    }
  };
}

function privateStorageExtension(restoreCreationMask: () => void): InlineExtension {
  return {
    name: "rocky-private-session-storage",
    hidden: true,
    factory: (extension: ExtensionAPI) => {
      extension.on("session_start", (_event, context) => {
        try {
          enforcePrivateSessionStorage(context.sessionManager);
        } finally {
          restoreCreationMask();
        }
      });
    },
  };
}

/** Return only Rocky-owned skill roots that exist for this session. */
export function getRockySkillPaths(agentDir: string, cwd: string, projectTrusted: boolean): string[] {
  const paths = [join(agentDir, "skills")];
  if (projectTrusted) {
    paths.push(join(cwd, ROCKY_CONFIG_DIR, "skills"));
  }
  return paths.filter((path) => existsSync(path));
}

function rockySkillDiscoveryExtension(agentDir: string): InlineExtension {
  return {
    name: "rocky-skill-discovery",
    hidden: true,
    factory: (extension: ExtensionAPI) => {
      extension.on("project_trust", (event) => ({
        trusted: getRockyProjectTrustDecision(event.cwd),
      }));
      extension.on("resources_discover", (_event, context) => ({
        skillPaths: getRockySkillPaths(agentDir, context.cwd, context.isProjectTrusted()),
      }));
    },
  };
}

export function requiresCodingRuntime(args: readonly string[]): boolean {
  const command = args[0];
  if (["auth", "config", "install", "remove", "uninstall", "update", "list"].includes(command ?? "")) {
    return false;
  }
  return !args.some((argument) =>
    ["--help", "-h", "--version", "-v", "--list-models", "--export"].includes(argument),
  );
}

const ROCKY_TRUST_RESOURCES = [
  "settings.json",
  "extensions",
  "skills",
  "prompts",
  "themes",
  "SYSTEM.md",
  "APPEND_SYSTEM.md",
] as const;

function hasRockyProjectResources(cwd: string): boolean {
  const projectConfigDir = join(cwd, ROCKY_CONFIG_DIR);
  return ROCKY_TRUST_RESOURCES.some((entry) => existsSync(join(projectConfigDir, entry)));
}

function getRockyProjectTrustDecision(cwd: string): "no" | "undecided" {
  return hasRockyProjectResources(cwd) ? "undecided" : "no";
}

/**
 * Disable the harness's cross-harness skill discovery for agent sessions. Rocky
 * skills are added back by rockySkillDiscoveryExtension after project trust. Hierarchy
 * context files (AGENTS.md/CLAUDE.md) stay on standard discovery, which is not gated
 * by project trust (ADR 0002); --no-context-files remains a user opt-out.
 */
export function applyRockyDiscoveryPolicy(args: readonly string[]): string[] {
  if (!requiresCodingRuntime(args)) {
    return [...args];
  }

  const isolatedArgs = [...args];
  if (!isolatedArgs.some((argument) => argument === "--no-skills" || argument === "-ns")) {
    isolatedArgs.push("--no-skills");
  }

  return isolatedArgs;
}

/** Map Rocky-named environment controls onto the harness's compatibility variables. */
export function prepareRockyEnvironment(): void {
  if (isTruthy(process.env["ROCKY_OFFLINE"])) {
    process.env["PI_OFFLINE"] = "1";
  }
  if (process.env["ROCKY_TELEMETRY"] !== undefined) {
    process.env["PI_TELEMETRY"] = process.env["ROCKY_TELEMETRY"];
  } else if (process.env["PI_TELEMETRY"] === undefined) {
    process.env["PI_TELEMETRY"] = "0";
  }
}

/**
 * Session options that carry Rocky's discovery and trust policy.
 *
 * Returned as a plain value rather than applied inside a session factory so a
 * test can assert the policy without loading the harness, starting a session,
 * or touching `~/.rocky/agent`. Every entry point that creates a session —
 * the CLI and the headless client host — must build its options from here, or
 * the two silently diverge on exactly the questions that matter: which skills
 * load, and whether a project is trusted.
 */
export interface RockySessionOptions {
  resourceLoaderOptions: {
    noSkills: true;
    extensionFactories: InlineExtension[];
  };
  resourceLoaderReloadOptions: {
    resolveProjectTrust: (input: { extensionsResult?: unknown }) => Promise<boolean>;
  };
}

export interface BuildRockySessionOptionsInput {
  cwd: string;
  agentDir: string;
  /** Resolves trust the way the harness does. Injected so tests stay offline. */
  resolveTrust: (input: { cwd: string; extensionsResult?: unknown }) => Promise<boolean>;
  /** Restores the startup umask once session storage exists. */
  restoreCreationMask?: () => void;
}

export function buildRockySessionOptions(input: BuildRockySessionOptionsInput): RockySessionOptions {
  const restore = input.restoreCreationMask ?? (() => {});
  return {
    resourceLoaderOptions: {
      // Rocky replaces the harness's general skill discovery entirely; the
      // inline extension adds back only Rocky-owned roots after trust.
      noSkills: true,
      extensionFactories: [privateStorageExtension(restore), rockySkillDiscoveryExtension(input.agentDir)],
    },
    resourceLoaderReloadOptions: {
      // Without this, the extensions' project_trust handler is never consulted
      // and every project silently reads as untrusted.
      resolveProjectTrust: ({ extensionsResult }) =>
        input.resolveTrust({
          cwd: input.cwd,
          ...(extensionsResult !== undefined ? { extensionsResult } : {}),
        }),
    },
  };
}

export async function loadPiRuntime(): Promise<typeof import("@jakeryderv/rocky-harness")> {
  prepareRockyEnvironment();
  const harness = await import("@jakeryderv/rocky-harness");

  if (harness.CONFIG_DIR_NAME !== ROCKY_CONFIG_DIR) {
    throw new RockyRuntimeError(
      `Harness initialized with ${JSON.stringify(harness.CONFIG_DIR_NAME)} instead of ${JSON.stringify(ROCKY_CONFIG_DIR)}.`,
    );
  }

  return harness;
}

/** Run the harness CLI composition, including its official InteractiveMode. */
/**
 * The identity every Rocky entry point must establish before a session exists.
 *
 * Shared rather than duplicated because these are not cosmetic: `AI_AGENT` and
 * the `*_CODING_AGENT` pair are inherited by every bash subprocess the agent
 * runs, so a tool that branches on "am I inside a coding agent" behaves
 * differently depending on which front end started the session. That divergence
 * is what issue #29 recorded.
 */
export function applyRockyProcessIdentity(): void {
  process.title = "rocky";
  process.env["ROCKY_CODING_AGENT"] = "true";
  process.env["PI_CODING_AGENT"] = "true";
  process.env["AI_AGENT"] = "rocky";
}

export async function runRocky(args: readonly string[]): Promise<void> {
  applyRockyProcessIdentity();

  const restoreCreationMask = beginPrivateCreationMask();
  try {
    const harness = await loadPiRuntime();
    ensurePrivateDirectory(harness.getAgentDir());
    const runtimeArgs = applyRockyDiscoveryPolicy(args);
    await harness.main(runtimeArgs, {
      extensionFactories: [
        privateStorageExtension(restoreCreationMask),
        rockySkillDiscoveryExtension(harness.getAgentDir()),
      ],
    });
  } finally {
    restoreCreationMask();
  }
}
