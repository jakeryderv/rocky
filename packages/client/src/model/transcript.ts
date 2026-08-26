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
  streaming: boolean;
  usage?: Usage;
  error?: string;
}

export function emptyTranscript(): TranscriptState {
  return { entries: [], toolResults: {}, streaming: false };
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
        ...(event.message.role === "assistant" ? { usage: event.message.usage } : {}),
        ...(event.message.role === "assistant" && event.message.errorMessage !== undefined
          ? { error: event.message.errorMessage }
          : {}),
      };
    }

    case "tool_end":
      return { ...state, toolResults: { ...state.toolResults, [event.toolCallId]: event.result } };

    case "error":
      return { ...state, error: event.message, streaming: false };

    case "settled":
      return { ...state, streaming: false };

    default:
      return state;
  }
}

/** Flatten an entry to plain lines, which is what the renderer draws. */
export function entryLines(entry: TranscriptEntry, toolResults: Record<string, ToolResultBlock>): string[] {
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
      lines.push(`⚙ ${name}${block.settled ? "" : " …"}`);
      const result = block.id.length > 0 ? toolResults[block.id] : undefined;
      if (result) {
        for (const line of result.content.split("\n").slice(0, 6)) {
          lines.push(`  ${line}`);
        }
      }
    }
  }
  if (entry.errorMessage !== undefined) {
    lines.push(`✖ ${entry.errorMessage}`);
  }
  return lines;
}
