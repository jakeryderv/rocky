import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyRockyDiscoveryPolicy,
  enforcePrivateSessionStorage,
  findExecutable,
  getRockySkillPaths,
  loadPiRuntime,
  prepareRockyEnvironment,
  requestsUnsupportedSelfUpdate,
  requiresCodingRuntime,
  rewriteRockyHelp,
  runRocky,
} from "../src/runtime/pi-runtime.js";

let fixtureRoot: string;
let homeDir: string;
let projectDir: string;
let agentDir: string;
let pi: Awaited<ReturnType<typeof loadPiRuntime>>;
const originalEnvironment = {
  HOME: process.env["HOME"],
  PI_CODING_AGENT_DIR: process.env["PI_CODING_AGENT_DIR"],
  PI_PACKAGE_DIR: process.env["PI_PACKAGE_DIR"],
  ROCKY_CODING_AGENT_DIR: process.env["ROCKY_CODING_AGENT_DIR"],
};

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function extension(command: string): string {
  return `export default function (pi) {
  pi.registerCommand(${JSON.stringify(command)}, {
    description: "fixture command",
    handler: async () => {},
  });
}\n`;
}

function skill(name: string): string {
  return `---
name: ${name}
description: Fixture skill ${name}
---

# ${name}
`;
}

function theme(name: string): string {
  const dependencyEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
  const darkThemePath = join(dirname(dependencyEntry), "modes", "interactive", "theme", "dark.json");
  const parsed = JSON.parse(readFileSync(darkThemePath, "utf8"));
  parsed.name = name;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function createResourceSet(base: string, prefix: string): void {
  write(join(base, "extensions", `${prefix}.js`), extension(`${prefix}-command`));
  write(join(base, "skills", prefix, "SKILL.md"), skill(`${prefix}-skill`));
  write(join(base, "prompts", `${prefix}.md`), `# ${prefix} prompt\n`);
  write(join(base, "themes", `${prefix}.json`), theme(`${prefix}-theme`));
  write(join(base, "SYSTEM.md"), `${prefix} system prompt\n`);
  write(join(base, "APPEND_SYSTEM.md"), `${prefix} appended prompt\n`);
}

beforeAll(async () => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "rocky-runtime-test-"));
  homeDir = join(fixtureRoot, "home");
  projectDir = join(fixtureRoot, "project");
  agentDir = join(homeDir, ".rocky", "agent");
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });

  process.env["HOME"] = homeDir;
  process.env["PI_CODING_AGENT_DIR"] = join(fixtureRoot, "pi-global-poison");
  delete process.env["ROCKY_CODING_AGENT_DIR"];
  prepareRockyEnvironment();
  pi = await loadPiRuntime();
});

afterAll(() => {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  rmSync(fixtureRoot, { force: true, recursive: true });
});

describe("Rocky Pi composition boundary", () => {
  it("initializes Pi with Rocky distribution metadata", () => {
    expect(pi.CONFIG_DIR_NAME).toBe(".rocky");
    expect(pi.getAgentDir()).toBe(agentDir);
    expect(pi.getPackageDir()).toBe(join(resolve("."), "pi-package"));
    expect(pi.InteractiveMode).toBeTypeOf("function");
  });

  it("honors only the Rocky-named global directory override", () => {
    const override = join(fixtureRoot, "rocky-override");
    process.env["ROCKY_CODING_AGENT_DIR"] = override;
    expect(pi.getAgentDir()).toBe(override);
    delete process.env["ROCKY_CODING_AGENT_DIR"];
    expect(pi.getAgentDir()).toBe(agentDir);
  });

  it("disables cross-harness skill discovery but keeps standard context-file discovery", () => {
    const policyProject = join(fixtureRoot, "policy-project");
    mkdirSync(join(policyProject, ".agents", "skills", "shared-poison"), { recursive: true });

    const isolatedArgs = applyRockyDiscoveryPolicy(["--offline"]);
    expect(isolatedArgs).toContain("--no-skills");
    expect(isolatedArgs).not.toContain("--no-context-files");
    expect(isolatedArgs).not.toContain("--no-approve");
    expect(applyRockyDiscoveryPolicy(["--offline", "--approve"])).toContain("--approve");
    expect(applyRockyDiscoveryPolicy(["config"])).toEqual(["config"]);
    // A user opt-out passes through unduplicated.
    expect(
      applyRockyDiscoveryPolicy(["--offline", "--no-context-files"]).filter(
        (argument) => argument === "--no-context-files",
      ),
    ).toEqual(["--no-context-files"]);
  });

  it("discovers hierarchy context files regardless of project trust", async () => {
    const contextRoot = join(fixtureRoot, "context-project");
    const nestedCwd = join(contextRoot, "nested");
    write(join(contextRoot, "AGENTS.md"), "ancestor context\n");
    write(join(nestedCwd, "CLAUDE.md"), "project context\n");

    const contextFiles = pi.loadProjectContextFiles({ cwd: nestedCwd, agentDir });
    expect(contextFiles.map(({ path }) => path)).toEqual([
      join(contextRoot, "AGENTS.md"),
      join(nestedCwd, "CLAUDE.md"),
    ]);

    // Pi has no trust gate for context files; Rocky accepts that (ADR 0002).
    const settings = pi.SettingsManager.create(nestedCwd, agentDir, { projectTrusted: false });
    const loader = new pi.DefaultResourceLoader({ cwd: nestedCwd, agentDir, settingsManager: settings });
    await loader.reload();
    expect(loader.getAgentsFiles().agentsFiles.map(({ path }) => path)).toEqual([
      join(contextRoot, "AGENTS.md"),
      join(nestedCwd, "CLAUDE.md"),
    ]);
  });

  it("selects skill roots only from Rocky-owned directories", () => {
    const skillProject = join(fixtureRoot, "skill-policy-project");
    const globalRockySkills = join(agentDir, "skills");
    const projectRockySkills = join(skillProject, ".rocky", "skills");
    mkdirSync(globalRockySkills, { recursive: true });
    mkdirSync(projectRockySkills, { recursive: true });
    mkdirSync(join(homeDir, ".agents", "skills", "global-poison"), { recursive: true });
    mkdirSync(join(skillProject, ".agents", "skills", "project-poison"), { recursive: true });

    expect(getRockySkillPaths(agentDir, skillProject, true)).toEqual([globalRockySkills, projectRockySkills]);
    expect(getRockySkillPaths(agentDir, skillProject, false)).toEqual([globalRockySkills]);
  });

  it("keeps settings, sessions, and trust beneath the Rocky global directory", async () => {
    const settings = pi.SettingsManager.create(projectDir, agentDir, { projectTrusted: false });
    settings.setDefaultProvider("fixture-provider");
    await settings.flush();

    const settingsPath = join(agentDir, "settings.json");
    expect(JSON.parse(readFileSync(settingsPath, "utf8")).defaultProvider).toBe("fixture-provider");

    const sessionManager = pi.SessionManager.create(projectDir);
    expect(sessionManager.getSessionDir().startsWith(agentDir)).toBe(true);
    expect(sessionManager.getSessionFile()?.startsWith(agentDir)).toBe(true);

    const trust = new pi.ProjectTrustStore(agentDir);
    trust.set(projectDir, true);
    expect(JSON.parse(readFileSync(join(agentDir, "trust.json"), "utf8"))[resolve(projectDir)]).toBe(true);
    expect(readFileSync(settingsPath, "utf8")).not.toContain(".pi");
  });

  it("discovers .rocky project resources and ignores matching .pi poison fixtures", async () => {
    createResourceSet(agentDir, "global-rocky");
    createResourceSet(join(homeDir, ".pi", "agent"), "global-pi-poison");
    createResourceSet(join(projectDir, ".rocky"), "project-rocky");
    createResourceSet(join(projectDir, ".pi"), "pi-poison");
    write(join(projectDir, ".rocky", "settings.json"), '{"theme":"project-rocky-theme"}\n');
    write(join(projectDir, ".pi", "settings.json"), '{"theme":"pi-poison-theme"}\n');

    const settings = pi.SettingsManager.create(projectDir, agentDir, { projectTrusted: true });
    expect(settings.getTheme()).toBe("project-rocky-theme");

    const loader = new pi.DefaultResourceLoader({ cwd: projectDir, agentDir, settingsManager: settings });
    await loader.reload();

    expect(loader.getExtensions().errors).toEqual([]);
    const extensionPaths = loader.getExtensions().extensions.map(({ path }) => path);
    expect(extensionPaths).toEqual(
      expect.arrayContaining([
        join(agentDir, "extensions", "global-rocky.js"),
        join(projectDir, ".rocky", "extensions", "project-rocky.js"),
      ]),
    );
    expect(extensionPaths.some((path) => path.includes(join(projectDir, ".pi")))).toBe(false);
    expect(extensionPaths.some((path) => path.includes(join(homeDir, ".pi")))).toBe(false);

    const skillNames = loader.getSkills().skills.map(({ name }) => name);
    expect(skillNames).toEqual(expect.arrayContaining(["global-rocky-skill", "project-rocky-skill"]));
    expect(skillNames).not.toContain("pi-poison-skill");
    expect(skillNames).not.toContain("global-pi-poison-skill");

    const promptNames = loader.getPrompts().prompts.map(({ name }) => name);
    expect(promptNames).toEqual(expect.arrayContaining(["global-rocky", "project-rocky"]));
    expect(promptNames).not.toContain("pi-poison");
    expect(promptNames).not.toContain("global-pi-poison");

    const themeNames = loader.getThemes().themes.map(({ name }) => name);
    expect(themeNames).toEqual(expect.arrayContaining(["global-rocky-theme", "project-rocky-theme"]));
    expect(themeNames).not.toContain("pi-poison-theme");
    expect(themeNames).not.toContain("global-pi-poison-theme");

    expect(loader.getSystemPrompt()).toBe("project-rocky system prompt\n");
    expect(loader.getAppendSystemPrompt()).toEqual(["project-rocky appended prompt\n"]);
    expect(loader.getSystemPromptSource()?.path).toBe(join(projectDir, ".rocky", "SYSTEM.md"));
    expect(loader.getAppendSystemPromptSources().map(({ path }) => path)).toEqual([
      join(projectDir, ".rocky", "APPEND_SYSTEM.md"),
    ]);
  });

  it("requires trust for .rocky resources but not a .pi directory alone", () => {
    const piOnly = join(fixtureRoot, "pi-only-project");
    write(join(piOnly, ".pi", "settings.json"), "{}\n");
    expect(pi.hasTrustRequiringProjectResources(piOnly)).toBe(false);

    write(join(piOnly, ".rocky", "settings.json"), "{}\n");
    expect(pi.hasTrustRequiringProjectResources(piOnly)).toBe(true);
  });

  it("enforces private POSIX session storage despite a permissive umask", () => {
    if (process.platform === "win32") return;

    const sessionDirectory = join(fixtureRoot, "permissive-session-dir");
    const previousUmask = process.umask(0o002);
    try {
      const sessionManager = pi.SessionManager.create(projectDir, sessionDirectory);
      sessionManager.appendSessionInfo("permission probe");
      enforcePrivateSessionStorage(sessionManager);

      const mode = (path: string) => statSync(path).mode & 0o777;
      expect(mode(sessionDirectory)).toBe(0o700);
      expect(mode(sessionManager.getSessionFile() as string)).toBe(0o600);
    } finally {
      process.umask(previousUmask);
    }
  });

  it("requires system search tools without using Rocky-managed executables", () => {
    expect(findExecutable(["rg"])).toBeDefined();
    expect(findExecutable(["rg"], join(fixtureRoot, "empty-path"))).toBeUndefined();
    expect(requiresCodingRuntime([])).toBe(true);
    expect(requiresCodingRuntime(["--print", "prompt"])).toBe(true);
    expect(requiresCodingRuntime(["--help"])).toBe(false);
    expect(requiresCodingRuntime(["update", "--models"])).toBe(false);
  });

  it("rewrites inherited help for Rocky's reserved and unsupported surfaces", () => {
    const rewritten = rewriteRockyHelp(
      "rocky update [source|self|pi]   Update pi, extensions, or model catalogs\n" +
        "PI_PACKAGE_DIR                   - Override package directory (for Nix/Guix store paths)\n" +
        "  --self                  Update pi only (default when no target is given)\n",
    );
    expect(rewritten).toContain("Reserved internally by Rocky");
    expect(rewritten).toContain("Unsupported by Rocky");
    expect(rewritten).not.toContain("update [source|self|pi]");
  });

  it("blocks self-update targets while retaining resource update commands", async () => {
    expect(requestsUnsupportedSelfUpdate(["update"])).toBe(true);
    expect(requestsUnsupportedSelfUpdate(["update", "--all"])).toBe(true);
    expect(requestsUnsupportedSelfUpdate(["update", "self"])).toBe(true);
    expect(requestsUnsupportedSelfUpdate(["update", "--extensions"])).toBe(false);
    expect(requestsUnsupportedSelfUpdate(["update", "--models"])).toBe(false);
    expect(requestsUnsupportedSelfUpdate(["update", "npm:fixture-package"])).toBe(false);
    expect(requestsUnsupportedSelfUpdate(["update", "--help"])).toBe(false);
    await expect(runRocky(["update"])).rejects.toThrow("Rocky self-update is not available yet");
  });
});
