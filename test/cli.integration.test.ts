import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { credentialFreeEnvironment } from "./credential-free-environment.js";
import { cliCommand } from "./node-runner.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
let fixtureRoot: string;
let projectDir: string;

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "rocky-cli-test-"));
  projectDir = join(fixtureRoot, "project");
  const piAgentDirs = [join(fixtureRoot, "home", ".pi", "agent"), join(fixtureRoot, "pi-poison")];
  mkdirSync(projectDir, { recursive: true });
  for (const piAgentDir of piAgentDirs) {
    mkdirSync(piAgentDir, { recursive: true });
    for (const name of ["auth.json", "models.json", "settings.json"]) {
      writeFileSync(join(piAgentDir, name), "{invalid pi poison", "utf8");
    }
  }
});

afterAll(() => {
  rmSync(fixtureRoot, { force: true, recursive: true });
});

function runRocky(args: string[]) {
  // The CLI runs on whichever runtime the suite is running on. Forcing it back
  // onto Node would make the Bun job answer a question nobody asked.
  const [command, commandArgs] = cliCommand(join(repositoryRoot, "src/cli.ts"), args);
  return spawnSync(command, commandArgs, {
    cwd: projectDir,
    encoding: "utf8",
    env: credentialFreeEnvironment({
      HOME: join(fixtureRoot, "home"),
      ROCKY_CODING_AGENT_DIR: join(fixtureRoot, "agent"),
      ROCKY_CODING_AGENT_SESSION_DIR: join(fixtureRoot, "sessions"),
      PI_CODING_AGENT_DIR: join(fixtureRoot, "pi-poison"),
    }),
    timeout: 30_000,
  });
}

describe("rocky CLI", () => {
  it("reports Rocky branding and paths without contacting a provider", () => {
    const result = runRocky(["--offline", "--help"]);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("rocky [options]");
    expect(result.stdout).toContain("~/.rocky/agent");
    expect(result.stdout).toContain("ROCKY_CODING_AGENT_DIR");
    expect(result.stdout).toContain("ROCKY_CODING_AGENT_SESSION_DIR");
    expect(result.stdout).not.toContain("PI_PACKAGE_DIR");
    expect(result.stdout).not.toContain("update [source|self|pi]");
    expect(result.stdout).not.toContain("~/.pi/agent");
    expect(existsSync(join(fixtureRoot, "pi-poison"))).toBe(true);
  });

  it("reports the Rocky distribution version", () => {
    const result = runRocky(["--offline", "--version"]);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("0.1.0");
  });

  it("offers no self-update surface", () => {
    const targeted = runRocky(["update", "self"]);
    expect(`${targeted.stdout}${targeted.stderr}`).not.toContain("Update Available");

    const help = runRocky(["update", "--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).not.toContain("Update pi only");
    expect(help.stdout).not.toContain("source|self|pi");
    expect(help.stdout).not.toContain("--self");
  });
});
