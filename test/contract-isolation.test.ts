import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FIXTURE_COMMAND_RESULTS,
  FIXTURE_COMMANDS,
  FIXTURE_DELTAS,
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
    ...FIXTURE_DELTAS.map((delta) => ({ label: `delta:${delta.type}`, value: delta })),
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

  /**
   * Read one exported union declaration's body.
   *
   * The union must terminate at the semicolon that ends the *declaration*, not
   * at the first semicolon inside a variant — variants are written
   * `{ type: "turn_end"; stopReason: StopReason }`, so stopping at the first
   * `;` silently truncates the scan to the first variant and makes the
   * exhaustiveness check below pass vacuously.
   */
  function declaredTypeTags(declaration: string): Set<string> {
    const declared = readFileSync(join(contractDir, "types.ts"), "utf8");
    const start = declared.indexOf(declaration);
    expect(start).toBeGreaterThanOrEqual(0);
    const union = declared.slice(start);
    const end = union.search(/;\s*(\r?\n|$)/);
    expect(end).toBeGreaterThan(0);
    return new Set([...union.slice(0, end).matchAll(/type:\s*"([a-z_]+)"/g)].map((m) => m[1] as string));
  }

  it("covers every event type in the union", () => {
    const covered = new Set(FIXTURE_EVENTS.map((event) => event.type));
    const declaredTypes = declaredTypeTags("export type SessionEvent =");
    // Guard the guard: if the scan silently truncates again, this catches it.
    expect(declaredTypes.size).toBeGreaterThan(10);
    expect([...declaredTypes].filter((type) => !covered.has(type as never))).toEqual([]);
  });

  it("covers every command type in the union", () => {
    const covered = new Set(FIXTURE_COMMANDS.map((command) => command.type));
    const declaredTypes = declaredTypeTags("export type SessionCommand =");
    expect(declaredTypes.size).toBeGreaterThan(10);
    expect([...declaredTypes].filter((type) => !covered.has(type as never))).toEqual([]);
  });

  it("covers every message-delta variant", () => {
    const covered = new Set(FIXTURE_DELTAS.map((delta) => delta.type));
    const declaredTypes = declaredTypeTags("export type MessageDelta =");
    expect(declaredTypes.size).toBeGreaterThan(3);
    expect([...declaredTypes].filter((type) => !covered.has(type as never))).toEqual([]);
  });

  it("covers every message_start role", () => {
    const roles = new Set(
      FIXTURE_EVENTS.filter((event) => event.type === "message_start").map((event) => event.role),
    );
    expect([...roles].sort()).toEqual(["assistant", "tool_result", "user"]);
  });

  it("keeps every outbound value tagged with a discriminating type", () => {
    const outbound: SessionOutbound[] = [...FIXTURE_EVENTS, ...FIXTURE_COMMAND_RESULTS];
    for (const value of outbound) {
      expect(typeof value.type).toBe("string");
    }
  });
});
