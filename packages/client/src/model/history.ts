/**
 * Prompt history navigation.
 *
 * Pure and reducer-shaped so it can be tested in the Node suite without a
 * renderer. `index` counts back from the newest entry: -1 means "not browsing
 * history", 0 is the most recent prompt.
 */
export interface HistoryState {
  entries: string[];
  index: number;
  /** What the user had typed before they started browsing, restored on exit. */
  draft: string;
}

const HISTORY_LIMIT = 200;

export function emptyHistory(): HistoryState {
  return { entries: [], index: -1, draft: "" };
}

/** Record a submitted prompt and leave history-browsing mode. */
export function remember(state: HistoryState, text: string): HistoryState {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { ...state, index: -1, draft: "" };
  }
  // Collapse an immediate repeat rather than filling history with duplicates.
  const entries = state.entries[0] === trimmed ? state.entries : [trimmed, ...state.entries];
  return { entries: entries.slice(0, HISTORY_LIMIT), index: -1, draft: "" };
}

/** Result of a navigation: the new state and the text to show, if it changed. */
export interface HistoryMove {
  state: HistoryState;
  text?: string;
}

export function older(state: HistoryState, current: string): HistoryMove {
  if (state.entries.length === 0) {
    return { state };
  }
  const next = Math.min(state.index + 1, state.entries.length - 1);
  if (next === state.index) {
    return { state };
  }
  // Entering history for the first time: stash whatever was typed.
  const draft = state.index === -1 ? current : state.draft;
  return { state: { ...state, index: next, draft }, text: state.entries[next] as string };
}

export function newer(state: HistoryState, _current: string): HistoryMove {
  if (state.index < 0) {
    return { state };
  }
  const next = state.index - 1;
  if (next < 0) {
    // Past the newest entry: restore the draft the user was writing.
    return { state: { ...state, index: -1, draft: "" }, text: state.draft };
  }
  return { state: { ...state, index: next }, text: state.entries[next] as string };
}
