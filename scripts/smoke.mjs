import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { credentialFreeEnvironment } from "./credential-free-environment.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = join(root, "dist/cli.js");
const fixture = mkdtempSync(join(tmpdir(), "rocky-smoke-"));
const home = join(fixture, "home");
const project = join(fixture, "project");
const agentDir = join(fixture, "agent");
mkdirSync(home, { recursive: true });
mkdirSync(project, { recursive: true });

const rockySkillDir = join(agentDir, "skills", "rocky-smoke");
const globalSharedSkillDir = join(home, ".agents", "skills", "global-shared-poison");
const projectSharedSkillDir = join(project, ".agents", "skills", "project-shared-poison");
mkdirSync(rockySkillDir, { recursive: true });
mkdirSync(globalSharedSkillDir, { recursive: true });
mkdirSync(projectSharedSkillDir, { recursive: true });
writeFileSync(
  join(rockySkillDir, "SKILL.md"),
  "---\nname: rocky-smoke\ndescription: Rocky-owned smoke skill\n---\n\n# Rocky smoke\n",
  "utf8",
);
writeFileSync(
  join(globalSharedSkillDir, "SKILL.md"),
  "---\nname: global-shared-poison\ndescription: Must not load\n---\n",
  "utf8",
);
writeFileSync(
  join(projectSharedSkillDir, "SKILL.md"),
  "---\nname: project-shared-poison\ndescription: Must not load\n---\n",
  "utf8",
);
writeFileSync(join(project, "AGENTS.md"), "SHARED_CONTEXT_POISON\n", "utf8");

const env = credentialFreeEnvironment({
  HOME: home,
  ROCKY_CODING_AGENT_DIR: agentDir,
  ROCKY_CODING_AGENT_SESSION_DIR: join(fixture, "sessions"),
  PI_CODING_AGENT_DIR: join(fixture, "pi-poison"),
});

function run(args, extraEnv = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: project,
    encoding: "utf8",
    env: { ...env, ...extraEnv },
    timeout: 30_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `rocky ${args.join(" ")} failed (${result.status})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return `${result.stdout}${result.stderr}`;
}

try {
  const version = run(["--offline", "--version"]);
  if (version.trim() !== "0.1.0") throw new Error(`Unexpected version output: ${version}`);

  const help = run(["--offline", "--help"]);
  for (const text of ["rocky [options]", "~/.rocky/agent", "ROCKY_CODING_AGENT_DIR"]) {
    if (!help.includes(text)) throw new Error(`Help output is missing ${text}`);
  }
  if (help.includes("~/.pi/agent")) throw new Error("Help output advertises Pi's global directory");

  run(["--offline", "--list-models"]);

  let tuiResult = "skipped (requires Linux util-linux script)";
  if (process.platform === "linux") {
    const rockyCommand = [process.execPath, cli, "--offline", "--name", "permission-probe"]
      .map((part) => `'${part.replaceAll("'", `'\\''`)}'`)
      .join(" ");
    const command = `umask 0002 && ${rockyCommand}`;
    const tui = spawnSync("script", ["-q", "-e", "-c", command, "/dev/null"], {
      cwd: project,
      encoding: "utf8",
      env: { ...env, PI_STARTUP_BENCHMARK: "1" },
      timeout: 30_000,
    });
    if (tui.error) throw tui.error;
    if (tui.status !== 0) {
      throw new Error(`TUI startup smoke failed (${tui.status})\n${tui.stdout}\n${tui.stderr}`);
    }
    const tuiOutput = `${tui.stdout}${tui.stderr}`;
    if (!tuiOutput.includes("rocky-smoke")) {
      throw new Error(`TUI did not discover the Rocky-owned skill\n${tuiOutput}`);
    }
    for (const poison of ["global-shared-poison", "project-shared-poison", "AGENTS.md"]) {
      if (tuiOutput.includes(poison)) {
        throw new Error(`TUI auto-discovered cross-harness resource ${poison}\n${tuiOutput}`);
      }
    }
    const sessionDirectory = join(fixture, "sessions");
    if (!existsSync(sessionDirectory)) {
      throw new Error("ROCKY_CODING_AGENT_SESSION_DIR was not used by interactive startup");
    }
    const mode = (path) => statSync(path).mode & 0o777;
    if (mode(agentDir) !== 0o700 || mode(sessionDirectory) !== 0o700) {
      throw new Error("Rocky agent/session directories are not private");
    }
    const sessionFiles = readdirSync(sessionDirectory).filter((name) => name.endsWith(".jsonl"));
    if (sessionFiles.length !== 1 || mode(join(sessionDirectory, sessionFiles[0])) !== 0o600) {
      throw new Error("Rocky session file is missing or not mode 0600");
    }
    tuiResult = "passed";
  }

  console.log(`offline CLI checks passed; TUI startup ${tuiResult}`);
} finally {
  rmSync(fixture, { force: true, recursive: true });
}
