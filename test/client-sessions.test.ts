/**
 * Session-picker presentation.
 *
 * Time is passed in rather than read, so the wording boundaries are testable at
 * all — a picker that called `Date.now()` internally could not be.
 */
import { describe, expect, it } from "vitest";
import {
  filterSessions,
  relativeTime,
  sessionLabel,
  sortSessions,
} from "../packages/client/src/model/sessions.js";
import type { SessionSummary } from "../src/contract/index.js";

const NOW = 1_787_707_000_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "s1",
    cwd: "/home/user/project",
    createdAt: NOW - DAY,
    modifiedAt: NOW - HOUR,
    messageCount: 4,
    preview: "explain this repo",
    ...overrides,
  };
}

describe("relativeTime", () => {
  it("uses the coarsest unit that still separates two sessions", () => {
    expect(relativeTime(NOW - 30_000, NOW)).toBe("just now");
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe("5m ago");
    expect(relativeTime(NOW - 3 * HOUR, NOW)).toBe("3h ago");
    expect(relativeTime(NOW - 3 * DAY, NOW)).toBe("3d ago");
  });

  // Past a week the date is easier to place than a day count.
  it("falls back to a date after a week", () => {
    expect(relativeTime(NOW - 30 * DAY, NOW)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("sortSessions", () => {
  it("puts the most recently touched session first", () => {
    const older = session({ id: "old", modifiedAt: NOW - 5 * DAY });
    const newer = session({ id: "new", modifiedAt: NOW - 60_000 });
    expect(sortSessions([older, newer]).map((entry) => entry.id)).toEqual(["new", "old"]);
  });

  it("does not mutate its input", () => {
    const sessions = [session({ id: "a", modifiedAt: 1 }), session({ id: "b", modifiedAt: 2 })];
    sortSessions(sessions);
    expect(sessions.map((entry) => entry.id)).toEqual(["a", "b"]);
  });
});

describe("filterSessions", () => {
  const sessions = [
    session({ id: "a", preview: "why does the build fail on bun" }),
    session({ id: "b", name: "contract work", preview: "add get_commands" }),
    session({ id: "c", cwd: "/home/user/other", preview: "unrelated" }),
  ];

  it("lists everything for an empty query", () => {
    expect(filterSessions(sessions, "  ")).toHaveLength(3);
  });

  it("searches name, preview and directory together", () => {
    expect(filterSessions(sessions, "bun").map((entry) => entry.id)).toEqual(["a"]);
    expect(filterSessions(sessions, "contract").map((entry) => entry.id)).toEqual(["b"]);
    expect(filterSessions(sessions, "other").map((entry) => entry.id)).toEqual(["c"]);
  });

  it("requires every term, in any order", () => {
    expect(filterSessions(sessions, "build bun").map((entry) => entry.id)).toEqual(["a"]);
    expect(filterSessions(sessions, "bun contract")).toEqual([]);
  });
});

describe("sessionLabel", () => {
  it("prefers a name over the opening message", () => {
    expect(sessionLabel(session({ name: "contract work" }), NOW)).toContain("contract work");
  });

  it("truncates a long preview rather than wrapping the row", () => {
    const label = sessionLabel(session({ preview: "x".repeat(200) }), NOW, 20);
    expect(label).toContain("…");
    expect(label.length).toBeLessThan(60);
  });

  it("marks a forked session", () => {
    expect(sessionLabel(session({ parentId: "s0" }), NOW)).toContain("⑂");
    expect(sessionLabel(session(), NOW)).not.toContain("⑂");
  });
});
