/**
 * Which front end an invocation belongs to.
 *
 * The router is driven by the harness's own parser rather than by substring
 * matching, and these tests are mostly about the cases where those two differ:
 * a message that mentions a flag, a flag used as another flag's value, and an
 * unknown flag that swallows the token after it.
 */

import { parseArgs } from "@jakeryderv/rocky-harness";
import { describe, expect, it } from "vitest";
import {
  HARNESS_SUBCOMMANDS,
  routeRockyInvocation,
  stripLegacyTuiFlag,
} from "../src/runtime/route-invocation.js";

function route(argv: string[], overrides: { isInteractive?: boolean; clientEnabled?: boolean } = {}) {
  return routeRockyInvocation({
    argv,
    parse: (args) => parseArgs(args) as never,
    isInteractive: overrides.isInteractive ?? true,
    clientEnabled: overrides.clientEnabled ?? true,
  });
}

describe("stripLegacyTuiFlag", () => {
  // The harness parser treats an unknown flag as taking the next token when
  // that token is not itself a flag, so `--legacy-tui hi` would lose the
  // message entirely. Stripping first means the rest parses unchanged.
  it("removes the flag without eating the token after it", () => {
    expect(stripLegacyTuiFlag(["--legacy-tui", "hi"])).toEqual({ args: ["hi"], requested: true });
    expect(parseArgs(stripLegacyTuiFlag(["--legacy-tui", "hi"]).args).messages).toEqual(["hi"]);
  });

  it("accepts the =value form", () => {
    expect(stripLegacyTuiFlag(["--legacy-tui=1", "x"])).toEqual({ args: ["x"], requested: true });
  });

  it("leaves everything else alone", () => {
    expect(stripLegacyTuiFlag(["-p", "hello"])).toEqual({ args: ["-p", "hello"], requested: false });
  });
});

describe("routing to the harness", () => {
  it.each(HARNESS_SUBCOMMANDS)("routes the %s subcommand", (subcommand) => {
    expect(route([subcommand, "--whatever"]).target).toBe("harness");
  });

  // Only in first position: a message that begins with a subcommand's name is
  // still a message.
  it("does not treat a later argument as a subcommand", () => {
    expect(route(["--", "list"]).target).not.toBe("harness");
    const later = route(["hello", "list"]);
    expect(later.target).toBe("refuse");
  });

  it.each([["--help"], ["--version"], ["--list-models"], ["--export", "s.jsonl"], ["--print"], ["-p"]])(
    "routes %s to the harness",
    (...argv) => {
      expect(route(argv as string[]).target).toBe("harness");
    },
  );

  it.each([["rpc"], ["json"]])("routes --mode %s to the harness", (mode) => {
    expect(route(["--mode", mode]).target).toBe("harness");
  });

  // Without a terminal the client writes escape sequences into a pipe and
  // waits forever; the harness at least fails with a message.
  it("routes to the harness when no terminal is attached", () => {
    const result = route([], { isInteractive: false });
    expect(result.target).toBe("harness");
    expect(result.reason).toContain("terminal");
  });

  it("honours --legacy-tui", () => {
    const result = route(["--legacy-tui"]);
    expect(result.target).toBe("harness");
    expect(result.target === "harness" && result.args).toEqual(["--legacy-tui"]);
  });

  // PI_STARTUP_BENCHMARK is InteractiveMode-only and errors anywhere else.
  it("routes a startup benchmark to the inherited TUI", () => {
    const result = routeRockyInvocation({
      argv: [],
      parse: (args) => parseArgs(args) as never,
      isInteractive: true,
      clientEnabled: true,
      startupBenchmark: true,
    });
    expect(result.target).toBe("harness");
  });
});

describe("landing dark", () => {
  // The router ships before the flip, so nothing changes until one flag does.
  it("keeps every invocation on the harness while the client is disabled", () => {
    for (const argv of [[], ["--model", "x"], ["hello"]]) {
      const result = route(argv, { clientEnabled: false });
      expect(result.target).toBe("harness");
      expect(result.target === "harness" && result.args).toEqual(argv);
    }
  });
});

describe("routing to the client", () => {
  it("takes a bare interactive invocation", () => {
    expect(route([]).target).toBe("client");
  });

  it("passes through the options the client can honour", () => {
    const result = route(["--session-dir", "/tmp/sessions", "--offline"]);
    expect(result.target).toBe("client");
    expect(result.target === "client" && result.options).toEqual({
      sessionDir: "/tmp/sessions",
      offline: true,
    });
  });
});

describe("refusing rather than dropping", () => {
  it.each([
    ["--model", "gpt-5.5"],
    ["--provider", "anthropic"],
    ["--thinking", "high"],
    ["--resume"],
    ["--continue"],
  ])("refuses %s and names it", (...argv) => {
    const result = route(argv as string[]);
    expect(result.target).toBe("refuse");
    expect(result.target === "refuse" && result.message).toContain(argv[0] as string);
    expect(result.target === "refuse" && result.message).toContain("--legacy-tui");
  });

  it("refuses an initial message and an @file, saying what to do instead", () => {
    expect(route(["explain this repo"]).target).toBe("refuse");
    const attached = route(["@notes.md"]);
    expect(attached.target).toBe("refuse");
    expect(attached.target === "refuse" && attached.message).toContain("@file");
  });

  it("refuses an extension flag rather than forwarding nothing", () => {
    const result = route(["--some-extension-flag"]);
    expect(result.target).toBe("refuse");
    expect(result.target === "refuse" && result.message).toContain("--some-extension-flag");
  });

  it("names every unsupported argument, not only the first", () => {
    const result = route(["--model", "x", "--thinking", "high"]);
    expect(result.target).toBe("refuse");
    expect(result.target === "refuse" && result.message).toContain("--model");
    expect(result.target === "refuse" && result.message).toContain("--thinking");
  });
});

describe("what substring matching would get wrong", () => {
  // The whole reason the parser drives this.
  it("treats a message mentioning the flag as a message", () => {
    const result = route(["please use --legacy-tui"]);
    expect(result.target).toBe("refuse");
    expect(result.target === "refuse" && result.message).toContain("initial message");
  });

  it("does not read a flag used as another flag's value as a request", () => {
    // `--model --legacy-tui` gives --model the next token as its value.
    const stripped = stripLegacyTuiFlag(["--model", "--legacy-tui"]);
    expect(stripped.requested).toBe(true);
    // Documented consequence: written this way the flag IS a legacy request,
    // because it is a token of its own. The case that must not regress is the
    // quoted message above, where it is not.
    expect(stripped.args).toEqual(["--model"]);
  });
});
