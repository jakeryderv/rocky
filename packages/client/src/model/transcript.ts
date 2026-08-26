/**
 * Reduce contract events into renderable transcript state.
 *
 * Pure and free of OpenTUI, Solid, and the harness, so it runs in the Node test
 * suite and carries the logic most likely to be wrong. The UI layer only maps
 * this state to elements.
 *
 * The contract is imported type-only, so this module has no runtime dependency
 * on it and the client stays free of any value import across the seam.
 */
import type { SessionEvent, SessionMessage, ToolResultBlock, Usage } from "@rocky/contract";

/** A content block being assembled, addressed by its position in the message. */
export type TranscriptBlock =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_call"; id: string; name: string; argumentsJson: string; settled: boolean };

export interface TranscriptEntry {
  role: "user" | "assistant" | "tool_result";
  /** Sparse by design: blocks are addressed by the delta's `index`. */
  blocks: TranscriptBlock[];
  /** Set once the authoritative message arrives. */
  complete: boolean;
  errorMessage?: string;
}

export interface TranscriptState {
  entries: TranscriptEntry[];
  /** Results keyed by tool call id, so a call can render its own output. */
  toolResults: Record<string, ToolResultBlock>;
  /**
   * Cumulative output from tools still running, keyed by tool call id.
   * Cleared on `tool_end`, where the authoritative result takes over.
   */
  toolProgress: Record<string, { content: string; truncated: boolean }>;
  streaming: boolean;
  usage?: Usage;
  error?: string;
}

export function emptyTranscript(): TranscriptState {
  return { entries: [], toolResults: {}, toolProgress: {}, streaming: false };
}

function blocksFromMessage(message: SessionMessage): TranscriptBlock[] {
  if (message.role === "user") {
    return message.content.map((block) =>
      block.type === "text"
        ? ({ kind: "text", text: block.text } as const)
        : ({ kind: "text", text: `[image ${block.mimeType}]` } as const),
    );
  }
  if (message.role === "assistant") {
    return message.content.map((block) => {
      if (block.type === "text") {
        return { kind: "text", text: block.text } as const;
      }
      if (block.type === "thinking") {
        return { kind: "thinking", text: block.thinking } as const;
      }
      return {
        kind: "tool_call",
        id: block.id,
        name: block.name,
        argumentsJson: JSON.stringify(block.arguments),
        settled: true,
      } as const;
    });
  }
  return message.content.map((block) => ({ kind: "text", text: block.content }) as const);
}

/** Write a block at `index`, filling any gap so positions stay meaningful. */
function setBlock(blocks: TranscriptBlock[], index: number, next: TranscriptBlock): TranscriptBlock[] {
  const copy = blocks.slice();
  while (copy.length <= index) {
    copy.push({ kind: "text", text: "" });
  }
  copy[index] = next;
  return copy;
}

/**
 * Build a transcript from a session's message history.
 *
 * Needed when the client attaches to a session that already has one — a resumed
 * session, or any future client that connects mid-conversation. Without it the
 * transcript starts empty and the history is invisible even though the core
 * still has it.
 *
 * Tool results are folded into the `toolResults` index rather than becoming
 * entries, which is exactly what `applyEvent` does with them: they render
 * inline under the call that produced them.
 */
export function transcriptFromMessages(messages: readonly SessionMessage[]): TranscriptState {
  const state = emptyTranscript();
  const entries: TranscriptEntry[] = [];
  for (const message of messages) {
    if (message.role === "tool_result") {
      for (const block of message.content) {
        state.toolResults[block.toolCallId] = block;
      }
      continue;
    }
    entries.push({
      role: message.role,
      blocks: blocksFromMessage(message),
      complete: true,
      ...(message.role === "assistant" && message.errorMessage !== undefined
        ? { errorMessage: message.errorMessage }
        : {}),
    });
    if (message.role === "assistant" && message.stopReason !== "error" && message.stopReason !== "aborted") {
      state.usage = message.usage;
    }
  }
  return { ...state, entries };
}

function lastOpenEntry(state: TranscriptState): number {
  for (let i = state.entries.length - 1; i >= 0; i -= 1) {
    if (!state.entries[i]?.complete) {
      return i;
    }
  }
  return -1;
}

/**
 * Apply one event. Returns a new state; never mutates the input.
 *
 * Unknown events are ignored rather than throwing: the contract may grow
 * variants a given client build does not render yet.
 */
export function applyEvent(state: TranscriptState, event: SessionEvent): TranscriptState {
  switch (event.type) {
    case "turn_start": {
      // A new turn clears the previous turn's error banner.
      const { error: _cleared, ...rest } = state;
      return { ...rest, streaming: true };
    }

    case "turn_end":
      return { ...state, streaming: false };

    case "message_start":
      // Tool output is rendered inline under its tool call, from `tool_end`.
      // The harness also emits a message pair for the same result; rendering
      // both duplicates the output, and the second copy bypasses the tail
      // window that keeps a noisy command from burying the transcript.
      if (event.role === "tool_result") {
        return state;
      }
      return {
        ...state,
        entries: [...state.entries, { role: event.role, blocks: [], complete: false }],
      };

    case "message_delta": {
      const at = lastOpenEntry(state);
      if (at < 0) {
        return state;
      }
      const entry = state.entries[at] as TranscriptEntry;
      const delta = event.delta;
      const existing = entry.blocks[delta.index];
      let next: TranscriptBlock;

      if (delta.type === "text_delta") {
        const prior = existing?.kind === "text" ? existing.text : "";
        next = { kind: "text", text: prior + delta.text };
      } else if (delta.type === "thinking_delta") {
        const prior = existing?.kind === "thinking" ? existing.text : "";
        next = { kind: "thinking", text: prior + delta.thinking };
      } else if (delta.type === "tool_call_start") {
        next = { kind: "tool_call", id: "", name: "", argumentsJson: "", settled: false };
      } else if (delta.type === "tool_call_delta") {
        const prior = existing?.kind === "tool_call" ? existing : undefined;
        next = {
          kind: "tool_call",
          id: prior?.id ?? "",
          name: prior?.name ?? "",
          // Fragments concatenate; they are not valid JSON on their own.
          argumentsJson: (prior?.argumentsJson ?? "") + delta.argumentsJson,
          settled: false,
        };
      } else {
        // tool_call_end is authoritative: replace, never append.
        next = {
          kind: "tool_call",
          id: delta.id,
          name: delta.name,
          argumentsJson: JSON.stringify(delta.arguments),
          settled: true,
        };
      }

      const entries = state.entries.slice();
      entries[at] = { ...entry, blocks: setBlock(entry.blocks, delta.index, next) };
      return { ...state, entries, ...(event.usage ? { usage: event.usage } : {}) };
    }

    case "message_end": {
      // Counterpart to the message_start case above.
      if (event.message.role === "tool_result") {
        return state;
      }
      const at = lastOpenEntry(state);
      const settled: TranscriptEntry = {
        role: event.message.role,
        blocks: blocksFromMessage(event.message),
        complete: true,
        ...(event.message.role === "assistant" && event.message.errorMessage !== undefined
          ? { errorMessage: event.message.errorMessage }
          : {}),
      };
      const entries = state.entries.slice();
      if (at < 0) {
        entries.push(settled);
      } else {
        entries[at] = settled;
      }
      return {
        ...state,
        entries,
        // The authoritative message carries final totals; streaming deltas only
        // carry the running count, which is not summed until the turn ends.
        // A failed or aborted turn carries an all-zero usage, which would blank
        // a counter the user was reading — keep the last real figure instead.
        ...(event.message.role === "assistant" &&
        event.message.stopReason !== "error" &&
        event.message.stopReason !== "aborted"
          ? { usage: event.message.usage }
          : {}),
        ...(event.message.role === "assistant" && event.message.errorMessage !== undefined
          ? { error: event.message.errorMessage }
          : {}),
      };
    }

    case "tool_progress":
      return {
        ...state,
        // Cumulative: replace, never append.
        toolProgress: {
          ...state.toolProgress,
          [event.toolCallId]: { content: event.content, truncated: event.truncated === true },
        },
      };

    case "tool_end": {
      const { [event.toolCallId]: _finished, ...stillRunning } = state.toolProgress;
      return {
        ...state,
        toolResults: { ...state.toolResults, [event.toolCallId]: event.result },
        toolProgress: stillRunning,
      };
    }

    case "error":
      return { ...state, error: event.message, streaming: false };

    case "settled":
      return { ...state, streaming: false };

    default:
      return state;
  }
}

const TOOL_OUTPUT_LINES = 6;

/** Flatten an entry to plain lines, which is what the renderer draws. */
export function entryLines(
  entry: TranscriptEntry,
  toolResults: Record<string, ToolResultBlock>,
  toolProgress: Record<string, { content: string; truncated: boolean }> = {},
): string[] {
  const lines: string[] = [];
  for (const block of entry.blocks) {
    if (block.kind === "text") {
      if (block.text.length > 0) {
        lines.push(block.text);
      }
    } else if (block.kind === "thinking") {
      if (block.text.length > 0) {
        lines.push(`· ${block.text}`);
      }
    } else {
      const name = block.name.length > 0 ? block.name : "(tool)";
      const result = block.id.length > 0 ? toolResults[block.id] : undefined;
      const running = block.id.length > 0 ? toolProgress[block.id] : undefined;
      // `settled` means the arguments finished streaming, not that the tool
      // finished running — only a result means that.
      lines.push(`⚙ ${name}${result ? "" : " …"}`);
      // A finished result supersedes whatever progress was showing.
      const body = result?.content ?? running?.content;
      if (body !== undefined && body.length > 0) {
        // Tail, not head: for a running command the newest output matters most.
        const all = body.split("\n");
        const shown = all.slice(-TOOL_OUTPUT_LINES);
        if (all.length > shown.length) {
          const dropped = all.length - shown.length;
          lines.push(`  … ${dropped} earlier line${dropped === 1 ? "" : "s"}`);
        }
        for (const line of shown) {
          lines.push(`  ${line}`);
        }
      }
      if (!result && running?.truncated) {
        lines.push("  … output truncated");
      }
    }
  }
  if (entry.errorMessage !== undefined) {
    lines.push(`✖ ${entry.errorMessage}`);
  }
  return lines;
}
