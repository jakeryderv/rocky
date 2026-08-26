import { describe, expect, it } from "vitest";
import {
  applyEvent,
  emptyTranscript,
  entryLines,
  type TranscriptState,
} from "../packages/client/src/model/transcript.js";
import type { SessionEvent } from "../src/contract/index.js";

function run(events: SessionEvent[], from: TranscriptState = emptyTranscript()): TranscriptState {
  return events.reduce(applyEvent, from);
}

describe("transcript reduction", () => {
  // Tool output renders inline under its call, so a tool_result message must
  // not also become its own entry — that duplicated the output and the copy
  // bypassed the tail window.
  it("does not open a separate entry for tool-result messages", () => {
    const state = run([
      { type: "message_start", role: "assistant" },
      { type: "message_start", role: "tool_result" },
      {
        type: "message_end",
        message: {
          role: "tool_result",
          content: [{ type: "tool_result", toolCallId: "c1", content: "noisy output" }],
          timestamp: 1,
        },
      },
    ]);
    expect(state.entries.map((e) => e.role)).toEqual(["assistant"]);
  });

  it("opens an entry per message_start, with the role that started", () => {
    const state = run([
      { type: "message_start", role: "user" },
      {
        type: "message_end",
        message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
      },
      { type: "message_start", role: "assistant" },
    ]);
    expect(state.entries.map((e) => e.role)).toEqual(["user", "assistant"]);
    expect(state.entries[0]?.complete).toBe(true);
    expect(state.entries[1]?.complete).toBe(false);
  });

  it("accumulates text deltas into the addressed block", () => {
    const state = run([
      { type: "turn_start" },
      { type: "message_start", role: "assistant" },
      { type: "message_delta", delta: { type: "text_delta", index: 0, text: "Hel" } },
      { type: "message_delta", delta: { type: "text_delta", index: 0, text: "lo" } },
    ]);
    expect(state.entries[0]?.blocks[0]).toEqual({ kind: "text", text: "Hello" });
    expect(state.streaming).toBe(true);
  });

  // This is the case the contract's delta `index` exists for: without it,
  // adjacent same-kind blocks merge and interleaved ones corrupt each other.
  it("keeps interleaved blocks separate by index", () => {
    const state = run([
      { type: "message_start", role: "assistant" },
      { type: "message_delta", delta: { type: "thinking_delta", index: 0, thinking: "hmm" } },
      { type: "message_delta", delta: { type: "text_delta", index: 1, text: "first" } },
      { type: "message_delta", delta: { type: "text_delta", index: 2, text: "second" } },
      { type: "message_delta", delta: { type: "text_delta", index: 1, text: "-more" } },
    ]);
    expect(state.entries[0]?.blocks).toEqual([
      { kind: "thinking", text: "hmm" },
      { kind: "text", text: "first-more" },
      { kind: "text", text: "second" },
    ]);
  });

  it("concatenates tool-call fragments and lets the terminal event replace them", () => {
    const state = run([
      { type: "message_start", role: "assistant" },
      { type: "message_delta", delta: { type: "tool_call_start", index: 0 } },
      { type: "message_delta", delta: { type: "tool_call_delta", index: 0, argumentsJson: '{"path"' } },
      { type: "message_delta", delta: { type: "tool_call_delta", index: 0, argumentsJson: ':"a.ts"}' } },
    ]);
    expect(state.entries[0]?.blocks[0]).toEqual({
      kind: "tool_call",
      id: "",
      name: "",
      argumentsJson: '{"path":"a.ts"}',
      settled: false,
    });

    const settled = applyEvent(state, {
      type: "message_delta",
      delta: { type: "tool_call_end", index: 0, id: "c1", name: "read", arguments: { path: "a.ts" } },
    });
    expect(settled.entries[0]?.blocks[0]).toEqual({
      kind: "tool_call",
      id: "c1",
      name: "read",
      argumentsJson: '{"path":"a.ts"}',
      settled: true,
    });
  });

  it("replaces the streaming entry with the authoritative message", () => {
    const state = run([
      { type: "message_start", role: "assistant" },
      { type: "message_delta", delta: { type: "text_delta", index: 0, text: "partial" } },
      {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "final" }],
          model: { provider: "p", id: "m" },
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: 2,
        },
      },
    ]);
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]?.blocks).toEqual([{ kind: "text", text: "final" }]);
    expect(state.entries[0]?.complete).toBe(true);
  });

  it("surfaces a failed turn's reason", () => {
    const state = run([
      { type: "message_start", role: "assistant" },
      {
        type: "message_end",
        message: {
          role: "assistant",
          content: [],
          model: { provider: "p", id: "m" },
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "error",
          errorMessage: "529 overloaded",
          timestamp: 3,
        },
      },
    ]);
    expect(state.error).toBe("529 overloaded");
    expect(entryLines(state.entries[0] as never, {})).toContain("✖ 529 overloaded");
  });

  it("prefers the authoritative message's usage totals over streaming counts", () => {
    const running = {
      input: 5,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    const final = { ...running, output: 7, totalTokens: 12 };
    const state = run([
      { type: "message_start", role: "assistant" },
      { type: "message_delta", delta: { type: "text_delta", index: 0, text: "x" }, usage: running },
      {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "x" }],
          model: { provider: "p", id: "m" },
          usage: final,
          stopReason: "stop",
          timestamp: 4,
        },
      },
    ]);
    expect(state.usage?.totalTokens).toBe(12);
  });

  it("tracks live usage and stops streaming when settled", () => {
    const usage = {
      input: 10,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 12,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    const state = run([
      { type: "turn_start" },
      { type: "message_start", role: "assistant" },
      { type: "message_delta", delta: { type: "text_delta", index: 0, text: "x" }, usage },
      { type: "settled" },
    ]);
    expect(state.usage?.totalTokens).toBe(12);
    expect(state.streaming).toBe(false);
  });

  it("attaches a tool result to its call when rendering", () => {
    let state = run([
      { type: "message_start", role: "assistant" },
      {
        type: "message_delta",
        delta: { type: "tool_call_end", index: 0, id: "c1", name: "read", arguments: { path: "a" } },
      },
    ]);
    state = applyEvent(state, {
      type: "tool_end",
      toolCallId: "c1",
      result: { type: "tool_result", toolCallId: "c1", content: "line one\nline two" },
    });
    expect(entryLines(state.entries[0] as never, state.toolResults, state.toolProgress)).toEqual([
      "⚙ read",
      "  line one",
      "  line two",
    ]);
  });

  it("shows a running tool's cumulative output and replaces it, never appends", () => {
    let state = run([
      { type: "message_start", role: "assistant" },
      {
        type: "message_delta",
        delta: { type: "tool_call_end", index: 0, id: "c1", name: "bash", arguments: { command: "make" } },
      },
      { type: "tool_progress", toolCallId: "c1", name: "bash", content: "step 1" },
    ]);
    expect(entryLines(state.entries[0] as never, state.toolResults, state.toolProgress)).toEqual([
      "⚙ bash …",
      "  step 1",
    ]);

    // Cumulative snapshots replace; appending would duplicate "step 1".
    state = applyEvent(state, {
      type: "tool_progress",
      toolCallId: "c1",
      name: "bash",
      content: "step 1\nstep 2",
    });
    expect(entryLines(state.entries[0] as never, state.toolResults, state.toolProgress)).toEqual([
      "⚙ bash …",
      "  step 1",
      "  step 2",
    ]);
  });

  it("keeps only the newest lines of a long running tool, and says how many were dropped", () => {
    const state = run([
      { type: "message_start", role: "assistant" },
      {
        type: "message_delta",
        delta: { type: "tool_call_end", index: 0, id: "c1", name: "bash", arguments: {} },
      },
      {
        type: "tool_progress",
        toolCallId: "c1",
        name: "bash",
        content: Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n"),
      },
    ]);
    const lines = entryLines(state.entries[0] as never, state.toolResults, state.toolProgress);
    expect(lines[0]).toBe("⚙ bash …");
    expect(lines[1]).toBe("  … 4 earlier lines");
    expect(lines.at(-1)).toBe("  line 10");
  });

  it("lets the finished result supersede progress and forgets the running output", () => {
    let state = run([
      { type: "message_start", role: "assistant" },
      {
        type: "message_delta",
        delta: { type: "tool_call_end", index: 0, id: "c1", name: "bash", arguments: {} },
      },
      { type: "tool_progress", toolCallId: "c1", name: "bash", content: "partial" },
    ]);
    state = applyEvent(state, {
      type: "tool_end",
      toolCallId: "c1",
      result: { type: "tool_result", toolCallId: "c1", content: "final output" },
    });
    expect(state.toolProgress).toEqual({});
    expect(entryLines(state.entries[0] as never, state.toolResults, state.toolProgress)).toEqual([
      "⚙ bash",
      "  final output",
    ]);
  });

  it("flags truncated running output", () => {
    const state = run([
      { type: "message_start", role: "assistant" },
      {
        type: "message_delta",
        delta: { type: "tool_call_end", index: 0, id: "c1", name: "bash", arguments: {} },
      },
      { type: "tool_progress", toolCallId: "c1", name: "bash", content: "lots", truncated: true },
    ]);
    expect(entryLines(state.entries[0] as never, state.toolResults, state.toolProgress)).toContain(
      "  … output truncated",
    );
  });

  it("ignores events it does not render and never mutates its input", () => {
    const before = emptyTranscript();
    const after = applyEvent(before, { type: "queue_update", steering: ["a"], followUp: [] });
    expect(after).toEqual(before);
    expect(before.entries).toHaveLength(0);
  });
});
