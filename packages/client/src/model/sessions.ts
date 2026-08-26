/**
 * Session-picker presentation.
 *
 * Pure, and time is passed in rather than read: a picker that calls
 * `Date.now()` internally cannot be tested for the boundaries where its
 * wording changes.
 */
import type { SessionSummary } from "@rocky/contract";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago, in the coarsest unit that still distinguishes two sessions in
 * a list. Anything past a week is a date, because "12 days ago" is harder to
 * place than the date itself.
 */
export function relativeTime(timestamp: number, now: number): string {
  const elapsed = now - timestamp;
  if (elapsed < MINUTE) {
    return "just now";
  }
  if (elapsed < HOUR) {
    return `${Math.floor(elapsed / MINUTE)}m ago`;
  }
  if (elapsed < DAY) {
    return `${Math.floor(elapsed / HOUR)}h ago`;
  }
  if (elapsed < 7 * DAY) {
    return `${Math.floor(elapsed / DAY)}d ago`;
  }
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** Newest first: resuming yesterday's work is the common case. */
export function sortSessions(sessions: readonly SessionSummary[]): SessionSummary[] {
  return [...sessions].sort((left, right) => right.modifiedAt - left.modifiedAt);
}

/**
 * Match against the name, the preview and the directory together, so a session
 * is findable by what was said in it as well as by where it happened. Every
 * whitespace-separated term must match.
 */
export function filterSessions(sessions: readonly SessionSummary[], query: string): SessionSummary[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
  if (terms.length === 0) {
    return [...sessions];
  }
  return sessions.filter((session) => {
    const haystack = `${session.name ?? ""} ${session.preview} ${session.cwd}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/** One row: when, how big, and enough of the opening message to recognize it. */
export function sessionLabel(session: SessionSummary, now: number, width = 48): string {
  const title = session.name ?? session.preview ?? "";
  const trimmed = title.length > width ? `${title.slice(0, width - 1)}…` : title;
  const age = relativeTime(session.modifiedAt, now);
  const forked = session.parentId ? " ⑂" : "";
  return `${age.padEnd(9)} ${String(session.messageCount).padStart(4)} msg${forked}  ${trimmed}`;
}
