import {
  accessSync,
  chmodSync,
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  statSync,
} from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";

const ROCKY_CONFIG_DIR = ".rocky";
const ROCKY_TRUST_RESOURCES = [
  "settings.json",
  "extensions",
  "skills",
  "prompts",
  "themes",
  "SYSTEM.md",
  "APPEND_SYSTEM.md",
] as const;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const rockyPiPackageDir = join(packageRoot, "pi-package");

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

function ensurePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  applyMode(path, PRIVATE_DIRECTORY_MODE);
}

/** Ensure Pi's lazily written session file already exists with a private mode. */
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
  const descriptor = openSync(sessionFile, "a", PRIVATE_FILE_MODE);
  closeSync(descriptor);
  applyMode(sessionFile, PRIVATE_FILE_MODE);
}

function beginPrivateCreationMask(): () => void {
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

function executableNames(name: string): string[] {
  if (process.platform !== "win32") {
    return [name];
  }
  const extensions = (process.env["PATHEXT"] ?? ".EXE;.CMD;.BAT;.COM").split(";");
  return extensions.map((extension) => `${name}${extension.toLowerCase()}`);
}

export function findExecutable(
  names: readonly string[],
  pathValue = process.env["PATH"],
): string | undefined {
  for (const directory of pathValue?.split(delimiter) ?? []) {
    if (!directory) continue;
    for (const name of names) {
      for (const executableName of executableNames(name)) {
        const candidate = join(directory, executableName);
        try {
          if (statSync(candidate).isFile()) {
            accessSync(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
            return candidate;
          }
        } catch {
          // Continue searching PATH.
        }
      }
    }
  }
  return undefined;
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

function hasRockyProjectResources(cwd: string): boolean {
  const projectConfigDir = join(cwd, ROCKY_CONFIG_DIR);
  return ROCKY_TRUST_RESOURCES.some((entry) => existsSync(join(projectConfigDir, entry)));
}

function getRockyProjectTrustDecision(cwd: string): "no" | "undecided" {
  return hasRockyProjectResources(cwd) ? "undecided" : "no";
}

/**
 * Disable Pi's cross-harness skill/context discovery for agent sessions. Rocky
 * skills are added back by rockySkillDiscoveryExtension after project trust.
 */
export function applyRockyDiscoveryPolicy(args: readonly string[]): string[] {
  if (!requiresCodingRuntime(args)) {
    return [...args];
  }

  const isolatedArgs = [...args];
  if (!isolatedArgs.some((argument) => argument === "--no-skills" || argument === "-ns")) {
    isolatedArgs.push("--no-skills");
  }
  if (!isolatedArgs.some((argument) => argument === "--no-context-files" || argument === "-nc")) {
    isolatedArgs.push("--no-context-files");
  }

  return isolatedArgs;
}

function assertSystemCodingTools(agentDir: string): void {
  const managedBinDir = join(agentDir, "bin");
  const managedNames = process.platform === "win32" ? ["fd.exe", "rg.exe"] : ["fd", "rg"];
  const managedTool = managedNames.find((name) => existsSync(join(managedBinDir, name)));
  if (managedTool) {
    throw new RockyRuntimeError(
      `Refusing unmanaged executable ${join(managedBinDir, managedTool)}. ` +
        "Remove Rocky's bin directory and install fd and ripgrep through your system package manager.",
    );
  }

  const missing: string[] = [];
  if (!findExecutable(["fd", "fdfind"])) missing.push("fd (or fdfind)");
  if (!findExecutable(["rg"])) missing.push("ripgrep (rg)");
  if (missing.length > 0) {
    throw new RockyRuntimeError(
      `Missing required system tool${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. ` +
        "Rocky does not download executables; install them through your system package manager.",
    );
  }
}

/**
 * Establish the distribution metadata before Pi is imported. Pi reads these
 * values once at module initialization, so all Pi imports stay behind this boundary.
 */
export function prepareRockyEnvironment(): void {
  const metadataPath = join(rockyPiPackageDir, "package.json");
  if (!existsSync(metadataPath)) {
    throw new RockyRuntimeError(`Missing Rocky Pi metadata: ${metadataPath}`);
  }

  // PI_PACKAGE_DIR is reserved internally: it makes the dependency read Rocky's
  // piConfig metadata and packaged Pi assets without modifying node_modules.
  process.env["PI_PACKAGE_DIR"] = rockyPiPackageDir;

  if (isTruthy(process.env["ROCKY_OFFLINE"])) {
    process.env["PI_OFFLINE"] = "1";
  }
  if (process.env["ROCKY_TELEMETRY"] !== undefined) {
    process.env["PI_TELEMETRY"] = process.env["ROCKY_TELEMETRY"];
  } else if (process.env["PI_TELEMETRY"] === undefined) {
    process.env["PI_TELEMETRY"] = "0";
  }

  // Rocky has no update endpoint yet. Never interpret Pi's release feed as a
  // Rocky release feed; explicit provider/model requests remain available.
  process.env["PI_SKIP_VERSION_CHECK"] = "1";
}

export async function loadPiRuntime(): Promise<typeof import("@earendil-works/pi-coding-agent")> {
  prepareRockyEnvironment();
  const pi = await import("@earendil-works/pi-coding-agent");

  if (pi.CONFIG_DIR_NAME !== ROCKY_CONFIG_DIR) {
    throw new RockyRuntimeError(
      `Pi initialized with ${JSON.stringify(pi.CONFIG_DIR_NAME)} instead of ${JSON.stringify(ROCKY_CONFIG_DIR)}. ` +
        "Import Rocky's runtime boundary before importing Pi.",
    );
  }

  return pi;
}

export function requestsUnsupportedSelfUpdate(args: readonly string[]): boolean {
  if (args[0] !== "update" || args.includes("--help") || args.includes("-h")) {
    return false;
  }

  const rest = args.slice(1);
  if (rest.includes("--all") || rest.includes("--self")) {
    return true;
  }

  const target = rest.find((argument) => !argument.startsWith("-"));
  if (target !== undefined) {
    return ["self", "pi", "rocky"].includes(target);
  }

  return !rest.includes("--extensions") && !rest.includes("--models");
}

export function rewriteRockyHelp(text: string): string {
  return text
    .replace(
      "rocky update [source|self|pi] [--self|--extensions|--models|--all]",
      "rocky update [source] [--extensions|--models]",
    )
    .replace(
      "rocky update [source|self|pi]   Update pi, extensions, or model catalogs",
      "rocky update [source]           Update managed packages or model catalogs",
    )
    .replace(
      "PI_PACKAGE_DIR                   - Override package directory (for Nix/Guix store paths)",
      "PI_PACKAGE_DIR                   - Reserved internally by Rocky; incoming values are ignored",
    )
    .replace(
      "Update pi, installed packages, or model catalogs.",
      "Update installed packages or model catalogs.",
    )
    .replace(/^ {2}--self.*$/gm, "  --self                  Unsupported by Rocky")
    .replace(/^ {2}--all.*$/gm, "  --all                   Unsupported by Rocky (would include self-update)")
    .replace(
      /^ {2}--force.*$/gm,
      "  --force                 Applies only to supported package update targets",
    )
    .replace(
      /^ {2}rocky update\s+Update pi only$/gm,
      "  rocky update                Unsupported; update Rocky with its package manager",
    )
    .replace(/^ {2}rocky update --all.*$/gm, "  rocky update --extensions   Update installed packages")
    .replace(/^ {2}rocky update pi.*$/gm, "  rocky update pi             Unsupported by Rocky")
    .replace("Update pi only (default when no target is given)", "Unsupported by Rocky")
    .replace("Update pi only (self works as alias to pi)", "Unsupported by Rocky");
}

function installHelpRewriter(args: readonly string[]): () => void {
  if (!args.includes("--help") && !args.includes("-h")) {
    return () => {};
  }
  const original = console.log;
  console.log = (...values: unknown[]) => {
    original(...values.map((value) => (typeof value === "string" ? rewriteRockyHelp(value) : value)));
  };
  return () => {
    console.log = original;
  };
}

/** Run the stock Pi CLI composition, including its official InteractiveMode. */
export async function runRocky(args: readonly string[]): Promise<void> {
  if (requestsUnsupportedSelfUpdate(args)) {
    throw new RockyRuntimeError(
      "Rocky self-update is not available yet. Use your package manager to update Rocky; " +
        "use `rocky update --extensions` or `rocky update --models` for managed resources.",
    );
  }

  process.title = "rocky";
  process.env["ROCKY_CODING_AGENT"] = "true";
  process.env["PI_CODING_AGENT"] = "true";
  process.env["AI_AGENT"] = "rocky";

  const restoreCreationMask = beginPrivateCreationMask();
  const restoreHelp = installHelpRewriter(args);
  try {
    const pi = await loadPiRuntime();
    const agentDir = pi.getAgentDir();
    ensurePrivateDirectory(agentDir);
    if (requiresCodingRuntime(args)) {
      assertSystemCodingTools(agentDir);
    }
    const runtimeArgs = applyRockyDiscoveryPolicy(args);
    await pi.main(runtimeArgs, {
      extensionFactories: [
        privateStorageExtension(restoreCreationMask),
        rockySkillDiscoveryExtension(agentDir),
      ],
    });
  } finally {
    restoreHelp();
    restoreCreationMask();
  }
}
