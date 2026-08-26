import { describe, expect, it } from "vitest";
import {
  applyEvent,
  emptyTranscript,
  entryLines,
  type TranscriptState,
  transcriptFromMessages,
} from "../packages/client/src/model/transcript.js";
import type { SessionEvent, SessionMessage } from "../src/contract/index.js";

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

// Needed the moment the client attaches to a session that already has history —
// a resumed session, or any client that connects mid-conversation. Without it
// the transcript starts empty over a conversation the core can still see.
describe("rebuilding a transcript from message history", () => {
  const model = { provider: "openai-codex", id: "gpt-5.5" };
  const usage = {
    input: 10,
    output: 5,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 15,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };

  it("produces settled entries for the user and assistant turns", () => {
    const messages: SessionMessage[] = [
      { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 },
      {
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
        model,
        usage,
        stopReason: "stop",
        timestamp: 2,
      },
    ];
    const state = transcriptFromMessages(messages);
    expect(state.entries.map((entry) => entry.role)).toEqual(["user", "assistant"]);
    expect(state.entries.every((entry) => entry.complete)).toBe(true);
    expect(state.usage).toEqual(usage);
    expect(state.streaming).toBe(false);
  });

  // Same rule as the live path: a tool result renders under its call, not as an
  // entry of its own.
  it("folds tool results into the index rather than making entries", () => {
    const state = transcriptFromMessages([
      {
        role: "tool_result",
        content: [{ type: "tool_result", toolCallId: "call_1", content: "# Rocky" }],
        timestamp: 3,
      },
    ]);
    expect(state.entries).toEqual([]);
    expect(state.toolResults["call_1"]?.content).toBe("# Rocky");
  });

  // An aborted or failed turn reports an all-zero usage, which would blank a
  // counter the user was reading.
  it("does not take usage from a failed or aborted turn", () => {
    const state = transcriptFromMessages([
      {
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
        model,
        usage,
        stopReason: "stop",
        timestamp: 1,
      },
      {
        role: "assistant",
        content: [],
        model,
        usage: { ...usage, totalTokens: 0, input: 0, output: 0 },
        stopReason: "aborted",
        timestamp: 2,
      },
    ]);
    expect(state.usage?.totalTokens).toBe(15);
  });

  it("carries a failed turn's message onto its entry", () => {
    const state = transcriptFromMessages([
      {
        role: "assistant",
        content: [],
        model,
        usage,
        stopReason: "error",
        errorMessage: "provider returned 529",
        timestamp: 1,
      },
    ]);
    expect(state.entries[0]?.errorMessage).toBe("provider returned 529");
  });

  it("returns an empty transcript for an empty history", () => {
    expect(transcriptFromMessages([])).toEqual(emptyTranscript());
  });
});

describe("shell commands the user ran", () => {
  const result = { output: "done", exitCode: 0, cancelled: false, truncated: false };

  it("opens an entry, appends output, and settles on the result", () => {
    const state = run([
      { type: "bash_start", commandId: "b1", command: "npm test" },
      { type: "bash_output", commandId: "b1", delta: "one\n" },
      { type: "bash_output", commandId: "b1", delta: "two\n" },
      { type: "bash_end", commandId: "b1", result: { ...result, output: "one\ntwo\n" } },
    ]);
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]?.role).toBe("bash");
    expect(state.entries[0]?.complete).toBe(true);
    expect(entryLines(state.entries[0] as never, {})).toEqual(["npm test", "  one", "  two"]);
  });

  // The contract calls this a delta, unlike `tool_progress` next door. Treating
  // it as a snapshot would show only the final chunk.
  it("appends output rather than replacing it", () => {
    const state = run([
      { type: "bash_start", command: "ls" },
      { type: "bash_output", delta: "a" },
      { type: "bash_output", delta: "b" },
    ]);
    const block = state.entries[0]?.blocks[0];
    expect(block?.kind === "bash" && block.output).toBe("ab");
  });

  it("marks a command still running", () => {
    const state = run([{ type: "bash_start", command: "sleep 100" }]);
    expect(entryLines(state.entries[0] as never, {})).toEqual(["sleep 100 …"]);
  });

  it("reports a non-zero exit and a cancellation", () => {
    const failed = run([
      { type: "bash_start", command: "false" },
      { type: "bash_end", result: { output: "", exitCode: 1, cancelled: false, truncated: false } },
    ]);
    expect(entryLines(failed.entries[0] as never, {})).toEqual(["false", "  ✖ exit 1"]);

    const killed = run([
      { type: "bash_start", command: "sleep 100" },
      { type: "bash_end", result: { output: "", cancelled: true, truncated: false } },
    ]);
    expect(entryLines(killed.entries[0] as never, {})).toEqual(["sleep 100", "  ✖ cancelled"]);
  });

  // The streamed chunks may have been throttled or truncated on the way.
  it("lets the authoritative output supersede the streamed chunks", () => {
    const state = run([
      { type: "bash_start", commandId: "b1", command: "ls" },
      { type: "bash_output", commandId: "b1", delta: "partial" },
      { type: "bash_end", commandId: "b1", result: { ...result, output: "complete" } },
    ]);
    const block = state.entries[0]?.blocks[0];
    expect(block?.kind === "bash" && block.output).toBe("complete");
  });

  it("attributes output to the command that asked for it", () => {
    const state = run([
      { type: "bash_start", commandId: "b1", command: "first" },
      { type: "bash_start", commandId: "b2", command: "second" },
      { type: "bash_output", commandId: "b1", delta: "one" },
      { type: "bash_output", commandId: "b2", delta: "two" },
    ]);
    const first = state.entries[0]?.blocks[0];
    const second = state.entries[1]?.blocks[0];
    expect(first?.kind === "bash" && first.output).toBe("one");
    expect(second?.kind === "bash" && second.output).toBe("two");
  });

  it("ignores output for a command it never saw start", () => {
    expect(run([{ type: "bash_output", commandId: "ghost", delta: "x" }]).entries).toEqual([]);
  });
});
