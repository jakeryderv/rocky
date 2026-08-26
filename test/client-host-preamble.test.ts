/**
 * What every entry point must establish before a session exists.
 *
 * Issue #29: `rocky` runs `harness.main()`, which sets the process identity and
 * configures the HTTP transport; the client host built a session directly and
 * did neither. The divergence is invisible in normal use and shows up as a
 * different environment inside the agent's bash subprocesses, and as a stalled
 * provider stream with nothing to end it.
 */
import { describe, expect, it, vi } from "vitest";
import { runRockyClient } from "../src/client-host/tui-entry.js";
import { applyRockyProcessIdentity, resolveSessionDir } from "../src/runtime/pi-runtime.js";

describe("Rocky process identity", () => {
  it("marks the process for every tool that branches on it", () => {
    for (const name of ["ROCKY_CODING_AGENT", "PI_CODING_AGENT", "AI_AGENT"]) {
      vi.stubEnv(name, "");
      delete process.env[name];
    }
    applyRockyProcessIdentity();
    expect(process.env["AI_AGENT"]).toBe("rocky");
    // The compatibility pair: an inherited extension may read either name.
    expect(process.env["ROCKY_CODING_AGENT"]).toBe("true");
    expect(process.env["PI_CODING_AGENT"]).toBe("true");
    expect(process.title).toBe("rocky");
  });
});

describe("client launch preconditions", () => {
  /**
   * Without this the renderer takes over a stream that is not a terminal and
   * then waits for input that never arrives: a piped or redirected invocation
   * hangs indefinitely rather than failing. Vitest gives the suite piped
   * stdio, so this is the real condition, not a simulated one.
   */
  it("refuses a launch with no terminal, rather than hanging", async () => {
    expect(process.stdout.isTTY).toBeFalsy();
    await expect(runRockyClient()).rejects.toThrow(/interactive terminal/);
  });

  // The terminal is checked first because it is the more fundamental
  // precondition — no terminal means the client cannot work on any runtime.
  it("reports the missing terminal before the missing runtime", async () => {
    await expect(runRockyClient()).rejects.not.toThrow(/requires Bun/);
  });
});

/**
 * Where session transcripts go.
 *
 * The client host used to leave this to the default while `rocky` resolved it
 * from a flag, an environment variable, or a setting. Getting it wrong does not
 * fail — it silently writes a user's history somewhere else — so the precedence
 * is pinned rather than assumed.
 */
describe("resolveSessionDir", () => {
  const helpers = {
    normalize: (path: string) => `normalized:${path}`,
    expandTilde: (path: string) => path.replace("~", "/home/user"),
  };

  it("prefers an explicit flag over everything", () => {
    expect(resolveSessionDir({ flag: "/flag", env: "/env", setting: "/setting", ...helpers })).toBe(
      "normalized:/flag",
    );
  });

  it("prefers the environment over the stored setting", () => {
    expect(resolveSessionDir({ env: "~/env", setting: "/setting", ...helpers })).toBe("/home/user/env");
  });

  it("falls back to the stored setting", () => {
    expect(resolveSessionDir({ setting: "/setting", ...helpers })).toBe("/setting");
  });

  // Undefined means "the default under the agent directory", which is what an
  // unset setting already means to the harness.
  it("reports nothing when nothing is configured", () => {
    expect(resolveSessionDir({ ...helpers })).toBeUndefined();
  });

  it("ignores empty values rather than treating them as a choice", () => {
    expect(resolveSessionDir({ flag: "", env: "", setting: "/setting", ...helpers })).toBe("/setting");
  });
});
