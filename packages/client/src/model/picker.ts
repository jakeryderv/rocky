/**
 * Filtering and labelling for the overlay pickers (models today; sessions and
 * settings later).
 *
 * Pure, so the matching rule is covered by the Node suite rather than only by a
 * rendered frame.
 */
import type { ForkPoint, ModelRef } from "@rocky/contract";

/** How a model reads in the picker and in the status line. */
export function modelLabel(model: ModelRef): string {
  return `${model.provider}/${model.id}`;
}

export function modelDescription(model: ModelRef): string | undefined {
  return model.displayName;
}

/**
 * Match against the full `provider/id` label, so both halves are searchable and
 * `openai-codex/gpt` narrows the way a user expects. Every whitespace-separated
 * term must match, which makes `codex 5.5` work without ordering rules.
 */
export function filterModels(models: readonly ModelRef[], query: string): ModelRef[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
  if (terms.length === 0) {
    return [...models];
  }
  return models.filter((model) => {
    const haystack = `${modelLabel(model)} ${model.displayName ?? ""}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/** True when this model is the one the session is currently using. */
export function isActiveModel(model: ModelRef, active: ModelRef | undefined): boolean {
  return active !== undefined && model.provider === active.provider && model.id === active.id;
}

/** Match a fork point on its message text. Every term must match. */
export function filterForkPoints(points: readonly ForkPoint[], query: string): ForkPoint[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
  if (terms.length === 0) {
    return [...points];
  }
  return points.filter((point) => {
    const haystack = point.text.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/** One fork-point row, on one line. */
export function forkPointLabel(point: ForkPoint, width = 60): string {
  const flat = point.text.replace(/\s+/g, " ").trim();
  return flat.length > width ? `${flat.slice(0, width - 1)}…` : flat;
}

/** Session statistics as a single status line. */
export function statsLine(stats: {
  totalMessages: number;
  tokens: { total: number };
  cost: number;
  contextTokens?: number;
  contextWindow?: number;
}): string {
  const parts = [
    `${stats.totalMessages} messages`,
    `${stats.tokens.total.toLocaleString("en-US")} tokens`,
    `$${stats.cost.toFixed(4)}`,
  ];
  if (stats.contextTokens !== undefined) {
    const window = stats.contextWindow;
    const percent = window ? ` (${Math.round((stats.contextTokens / window) * 100)}%)` : "";
    parts.push(`context ${stats.contextTokens.toLocaleString("en-US")}${percent}`);
  }
  return parts.join("  ·  ");
}

/** Generic name filter, for the pickers whose rows are just names. */
export function filterNames(names: readonly string[], query: string): string[] {
  const needle = query.trim().toLowerCase();
  return needle.length === 0 ? [...names] : names.filter((name) => name.toLowerCase().includes(needle));
}

/** The session settings a client can see, as label/value rows. */
export function settingsRows(state: {
  cwd: string;
  sessionId: string;
  sessionName?: string;
  sessionFile?: string;
  model?: { provider: string; id: string };
  thinkingLevel: string;
  steeringMode: string;
  followUpMode: string;
  autoCompactionEnabled: boolean;
}): { label: string; value: string; command?: string }[] {
  return [
    { label: "model", value: state.model ? modelLabel(state.model) : "none", command: "/model" },
    { label: "thinking", value: state.thinkingLevel, command: "/thinking" },
    { label: "auto-compact", value: state.autoCompactionEnabled ? "on" : "off", command: "/autocompact" },
    { label: "steering", value: state.steeringMode, command: "/steering" },
    { label: "follow-up", value: state.followUpMode, command: "/followup" },
    { label: "name", value: state.sessionName ?? "unnamed", command: "/name" },
    { label: "session", value: state.sessionId },
    { label: "directory", value: state.cwd },
    ...(state.sessionFile ? [{ label: "transcript", value: state.sessionFile }] : []),
  ];
}
