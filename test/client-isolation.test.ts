import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const clientRoot = join(repoRoot, "packages", "client");

function sourcesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      if (entry === "node_modules") {
        continue;
      }
      const path = join(current, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (/\.tsx?$/.test(entry)) {
        found.push(path);
      }
    }
  };
  walk(dir);
  return found;
}

function importSpecifiers(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1] as string);
}

describe("client isolation", () => {
  // Both src and test: the enforcement is worthless if the tests can reach
  // around it, which is exactly where a fixtures import would land.
  const files = [...sourcesUnder(join(clientRoot, "src")), ...sourcesUnder(join(clientRoot, "test"))];

  it("has sources to check", () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it("never imports the harness or upstream Pi packages", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const specifier of importSpecifiers(file)) {
        if (specifier.startsWith("@earendil-works/") || specifier.startsWith("@jakeryderv/rocky-harness")) {
          offenders.push(`${file}: ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("reaches Rocky only through the contract specifier", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const specifier of importSpecifiers(file)) {
        const reachesRepo = specifier.startsWith("../../../") || specifier.includes("/src/contract");
        if (reachesRepo) {
          offenders.push(`${file}: ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // Type-only keeps the seam erased at runtime, so the client has no value
  // dependency on Rocky at all.
  it("imports the contract type-only", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/^(import[^;]*?)from\s+["']@rocky\/contract["']/gms)) {
        if (!/^import\s+type\b/.test(match[1] as string)) {
          offenders.push(`${file}: ${(match[1] as string).trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
