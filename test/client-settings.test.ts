/**
 * Settings and key-help rows.
 */
import { describe, expect, it } from "vitest";
import { KEY_BINDINGS } from "../packages/client/src/model/keys.js";
import { filterNames, settingsRows, statsLine } from "../packages/client/src/model/picker.js";
import { THINKING_LEVELS as CLIENT_THINKING_LEVELS } from "../packages/client/src/model/thinking.js";
import { THINKING_LEVELS } from "../src/contract/index.js";

const STATE = {
  cwd: "/work",
  sessionId: "s1",
  model: { provider: "openai-codex", id: "gpt-5.5" },
  thinkingLevel: "medium",
  steeringMode: "all",
  followUpMode: "one-at-a-time",
  autoCompactionEnabled: false,
};

describe("settingsRows", () => {
  it("names the command that changes each setting it can change", () => {
    const rows = settingsRows(STATE);
    expect(rows.find((row) => row.label === "model")).toEqual({
      label: "model",
      value: "openai-codex/gpt-5.5",
      command: "/model",
    });
    expect(rows.find((row) => row.label === "auto-compact")?.value).toBe("off");
    // Read-only facts carry no command, so the screen does not promise
    // something the client cannot do.
    expect(rows.find((row) => row.label === "session")?.command).toBeUndefined();
  });

  it("omits the transcript row for a session that is not persisted", () => {
    expect(settingsRows(STATE).some((row) => row.label === "transcript")).toBe(false);
    expect(
      settingsRows({ ...STATE, sessionFile: "/x.jsonl" }).some((row) => row.label === "transcript"),
    ).toBe(true);
  });

  it("says a session is unnamed rather than showing nothing", () => {
    expect(settingsRows(STATE).find((row) => row.label === "name")?.value).toBe("unnamed");
  });
});

describe("filterNames", () => {
  it("lists everything for an empty query and matches on substring", () => {
    expect(filterNames(["dark", "light"], "  ")).toEqual(["dark", "light"]);
    expect(filterNames(["dark", "light"], "IGH")).toEqual(["light"]);
  });
});

describe("statsLine", () => {
  it("reports context as a share of the window when both are known", () => {
    expect(
      statsLine({
        totalMessages: 6,
        tokens: { total: 1500 },
        cost: 0.0042,
        contextTokens: 750,
        contextWindow: 3000,
      }),
    ).toBe("6 messages  ·  1,500 tokens  ·  $0.0042  ·  context 750 (25%)");
  });

  it("omits context entirely when the core cannot estimate it", () => {
    expect(statsLine({ totalMessages: 1, tokens: { total: 0 }, cost: 0 })).not.toContain("context");
  });
});

describe("key help", () => {
  // A help screen that omits the only way out is worse than none.
  it("documents the key that leaves every screen", () => {
    expect(KEY_BINDINGS.some((binding) => binding.keys.includes("ctrl+c"))).toBe(true);
  });
});

// The client declares the list itself, because it imports the contract
// type-only. The record it is built from makes drift a typecheck failure; this
// makes it a test failure too, and pins the ordering a picker shows.
describe("thinking levels", () => {
  it("matches the contract exactly, in order", () => {
    expect(CLIENT_THINKING_LEVELS).toEqual([...THINKING_LEVELS]);
  });
});
