import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FIXTURE_COMMAND_RESULTS,
  FIXTURE_COMMANDS,
  FIXTURE_EVENTS,
  FIXTURE_STATE,
} from "../src/contract/fixtures.js";
import type { SessionOutbound } from "../src/contract/index.js";

const contractDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "contract");

function contractSources(): string[] {
  return readdirSync(contractDir)
    .filter((entry) => entry.endsWith(".ts"))
    .map((entry) => join(contractDir, entry));
}

describe("contract isolation", () => {
  it("has sources to check", () => {
    expect(contractSources().length).toBeGreaterThan(0);
  });

  // The contract is what clients compile against. A harness or Pi import here
  // would drag provider generics and non-serializable values into every client.
  it("imports nothing from the harness or upstream Pi packages", () => {
    const offenders: string[] = [];
    for (const file of contractSources()) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
        const specifier = match[1] as string;
        if (specifier.startsWith("@earendil-works/") || specifier.startsWith("@jakeryderv/rocky-harness")) {
          offenders.push(`${file}: ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("imports nothing outside the contract directory at all", () => {
    const offenders: string[] = [];
    for (const file of contractSources()) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
        const specifier = match[1] as string;
        if (!specifier.startsWith("./")) {
          offenders.push(`${file}: ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("contract serialization", () => {
  const samples: Array<{ label: string; value: unknown }> = [
    { label: "state", value: FIXTURE_STATE },
    ...FIXTURE_COMMANDS.map((command) => ({ label: `command:${command.type}`, value: command })),
    ...FIXTURE_EVENTS.map((event) => ({ label: `event:${event.type}`, value: event })),
    ...FIXTURE_COMMAND_RESULTS.map((result) => ({
      label: `result:${result.command}:${result.ok}`,
      value: result,
    })),
  ];

  it.each(samples)("survives a JSON round-trip: $label", ({ value }) => {
    expect(JSON.parse(JSON.stringify(value))).toEqual(value);
  });

  it.each(samples)("survives a structuredClone round-trip: $label", ({ value }) => {
    expect(structuredClone(value)).toEqual(value);
  });

  it("covers every event type in the union", () => {
    const covered = new Set(FIXTURE_EVENTS.map((event) => event.type));
    // Keep fixtures exhaustive: a new event type without a fixture ships untested.
    const declared = readFileSync(join(contractDir, "types.ts"), "utf8");
    const union = declared.slice(declared.indexOf("export type SessionEvent ="));
    const declaredTypes = new Set(
      [...union.slice(0, union.indexOf(";")).matchAll(/type:\s*"([a-z_]+)"/g)].map((m) => m[1] as string),
    );
    expect([...declaredTypes].filter((type) => !covered.has(type as never))).toEqual([]);
  });

  it("keeps every outbound value tagged with a discriminating type", () => {
    const outbound: SessionOutbound[] = [...FIXTURE_EVENTS, ...FIXTURE_COMMAND_RESULTS];
    for (const value of outbound) {
      expect(typeof value.type).toBe("string");
    }
  });
});
