import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { credentialFreeEnvironment } from "./credential-free-environment.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const tsxLoader = import.meta.resolve("tsx");
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
  return spawnSync(process.execPath, ["--import", tsxLoader, join(repositoryRoot, "src/cli.ts"), ...args], {
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
    expect(result.stdout).toContain("Reserved internally by Rocky");
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

  it("refuses Rocky-managed search executables instead of allowing Pi downloads", () => {
    if (process.platform === "win32") return;
    const managedBin = join(fixtureRoot, "agent", "bin");
    mkdirSync(managedBin, { recursive: true });
    writeFileSync(join(managedBin, "rg"), "untrusted managed tool\n", "utf8");

    const result = runRocky(["--offline"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Refusing unmanaged executable");
  });

  it("rejects stock self-update instead of migrating to Pi", () => {
    const result = runRocky(["update"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Rocky self-update is not available yet");

    const help = runRocky(["update", "--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Unsupported by Rocky");
    expect(help.stdout).not.toContain("Update pi only");
    expect(help.stdout).not.toContain("source|self|pi");
  });
});
