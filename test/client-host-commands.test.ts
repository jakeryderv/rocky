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
import { describeProviders } from "../src/client-host/create-session-port.js";

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

/**
 * The method list is derived from `provider.auth`, the way the inherited TUI's
 * own login selector does it — there is no static table to read.
 */
describe("describeProviders", () => {
  it("derives a method per auth mechanism the provider defines", () => {
    expect(
      describeProviders({
        modelRuntime: {
          getProviders: () => [
            {
              id: "anthropic",
              name: "Anthropic",
              auth: {
                oauth: { isSubscription: true, loginLabel: "Claude Pro/Max" },
                apiKey: { login: () => {} },
              },
            },
          ],
          getProviderAuthStatus: () => ({ configured: true, source: "stored" }),
        },
      }),
    ).toEqual([
      {
        id: "anthropic",
        name: "Anthropic",
        methods: ["oauth", "api_key"],
        authenticated: true,
        source: "stored",
        subscription: true,
        loginLabel: "Claude Pro/Max",
      },
    ]);
  });

  // Credentials from the environment only: authenticated, but nothing to log
  // into. Offering a method that would fail is worse than offering none.
  it("reports no method for a provider whose api key has no login", () => {
    const [provider] = describeProviders({
      modelRuntime: {
        getProviders: () => [{ id: "groq", auth: { apiKey: { name: "Groq API key" } } }],
        getProviderAuthStatus: () => ({ configured: true, source: "environment" }),
      },
    });
    expect(provider).toEqual({
      id: "groq",
      name: "groq",
      methods: [],
      authenticated: true,
      source: "environment",
    });
  });

  it("still lists a provider that cannot report its status", () => {
    const [provider] = describeProviders({
      modelRuntime: {
        getProviders: () => [{ id: "broken", auth: { oauth: {} } }],
        getProviderAuthStatus: () => {
          throw new Error("no credential store");
        },
      },
    });
    expect(provider).toMatchObject({ id: "broken", methods: ["oauth"], authenticated: false });
  });

  it("reports nothing rather than throwing without a model runtime", () => {
    expect(describeProviders({})).toEqual([]);
  });
});
