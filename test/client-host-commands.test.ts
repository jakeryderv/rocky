/**
 * Slash-command assembly in the client host.
 *
 * The harness merges these three registries in a private closure, so this is a
 * copy of an upstream shape rather than a design: the tests pin the parts that
 * would silently diverge from the inherited TUI — the `skill:` prefix, the use
 * of `invocationName` over `name`, and the source ordering.
 */
import { describe, expect, it } from "vitest";
import { collectSlashCommands } from "../src/client-host/collect-slash-commands.js";

describe("collectSlashCommands", () => {
  it("merges all three registries in the harness's own order", () => {
    expect(
      collectSlashCommands({
        promptTemplates: [{ name: "explain", description: "Explain a file", argumentHint: "<path>" }],
        extensionRunner: {
          getRegisteredCommands: () => [{ invocationName: "review", description: "Review" }],
        },
        resourceLoader: {
          getSkills: () => ({ skills: [{ name: "ship", description: "Ship it" }] }),
        },
      }),
    ).toEqual([
      { name: "review", description: "Review", source: "extension", sourceInfo: undefined },
      {
        name: "explain",
        description: "Explain a file",
        source: "prompt",
        argumentHint: "<path>",
        sourceInfo: undefined,
      },
      { name: "skill:ship", description: "Ship it", source: "skill", sourceInfo: undefined },
    ]);
  });

  it("uses the disambiguated invocation name, not the registered one", () => {
    const commands = collectSlashCommands({
      extensionRunner: {
        getRegisteredCommands: () => [{ invocationName: "review:2" }],
      },
    });
    expect(commands.map((command) => command.name)).toEqual(["review:2"]);
  });

  it("keeps skills and templates when the extension registry throws", () => {
    const commands = collectSlashCommands({
      extensionRunner: {
        getRegisteredCommands: () => {
          throw new Error("extension failed to load");
        },
      },
      promptTemplates: [{ name: "explain" }],
      resourceLoader: { getSkills: () => ({ skills: [{ name: "ship" }] }) },
    });
    expect(commands.map((command) => command.name)).toEqual(["explain", "skill:ship"]);
  });

  it("reports nothing rather than throwing on a session with no registries", () => {
    expect(collectSlashCommands({})).toEqual([]);
  });
});
