import { describe, expect, it, vi } from "vitest";
import {
  toMessageDelta,
  toModelRef,
  toSessionEvent,
  toSessionMessage,
  toStopReason,
  toThinkingLevel,
  toUsage,
} from "../src/adapter/map-to-contract.js";
import { type AgentSessionLike, PiAgentSessionAdapter } from "../src/adapter/pi-agent-session-adapter.js";
import type { SessionEvent } from "../src/contract/index.js";

describe("mapping harness values to the contract", () => {
  it("reduces a Pi model to a serializable reference", () => {
    expect(
      toModelRef({
        provider: "openai-codex",
        id: "gpt-5.5",
        name: "GPT-5.5",
        input: ["text", "image"],
        contextWindow: 400_000,
        thinkingLevels: ["low", "medium", "bogus"],
      }),
    ).toEqual({
      provider: "openai-codex",
      id: "gpt-5.5",
      displayName: "GPT-5.5",
      supportsImages: true,
      contextWindow: 400_000,
      supportedThinkingLevels: ["low", "medium"],
    });
  });

  it("falls back rather than leaking unknown enum values", () => {
    expect(toThinkingLevel("nonsense")).toBe("medium");
    expect(toThinkingLevel("xhigh")).toBe("xhigh");
    expect(toStopReason("nonsense")).toBe("stop");
    expect(toStopReason("aborted")).toBe("aborted");
  });

  it("fills in missing usage fields", () => {
    expect(toUsage(undefined)).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    });
    expect(toUsage({ input: 5, reasoning: 2 }).reasoning).toBe(2);
  });

  it("maps assistant content blocks and renames toolCall", () => {
    const message = toSessionMessage({
      role: "assistant",
      content: [
        { type: "text", text: "hi" },
        { type: "thinking", thinking: "hmm", redacted: true },
        { type: "toolCall", id: "t1", name: "read", arguments: { path: "a.ts" } },
      ],
      provider: "openai-codex",
      model: "gpt-5.5",
      stopReason: "toolUse",
      timestamp: 5,
    });
    expect(message).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "hi" },
        { type: "thinking", thinking: "hmm", redacted: true },
        { type: "tool_call", id: "t1", name: "read", arguments: { path: "a.ts" } },
      ],
      model: { provider: "openai-codex", id: "gpt-5.5" },
      usage: toUsage(undefined),
      stopReason: "toolUse",
      timestamp: 5,
    });
  });

  it("normalizes a string user message into blocks", () => {
    expect(toSessionMessage({ role: "user", content: "hello", timestamp: 1 })).toEqual({
      role: "user",
      content: [{ type: "text", text: "hello" }],
      timestamp: 1,
    });
  });

  it("drops harness message kinds that have no contract shape", () => {
    expect(toSessionMessage({ role: "bashExecution", content: "ls", timestamp: 1 })).toBeUndefined();
  });

  it("strips non-serializable tool arguments", () => {
    const message = toSessionMessage({
      role: "assistant",
      content: [{ type: "toolCall", id: "t1", name: "run", arguments: { fn: () => "nope", keep: 1 } }],
      timestamp: 0,
    });
    const block = (message as { content: Array<{ arguments?: Record<string, unknown> }> }).content[0];
    expect(block?.arguments).toEqual({ keep: 1 });
  });

  it("maps streaming deltas and ignores boundary events", () => {
    expect(toMessageDelta({ type: "text_delta", delta: "abc" })).toEqual({ type: "text_delta", text: "abc" });
    expect(toMessageDelta({ type: "thinking_delta", delta: "why" })).toEqual({
      type: "thinking_delta",
      thinking: "why",
    });
    expect(toMessageDelta({ type: "text_start" })).toBeUndefined();
    expect(toMessageDelta({ type: "done" })).toBeUndefined();
  });

  it("maps tool execution events", () => {
    expect(
      toSessionEvent({ type: "tool_execution_start", toolCallId: "t1", toolName: "read", args: { p: 1 } }),
    ).toEqual({ type: "tool_start", toolCallId: "t1", name: "read", arguments: { p: 1 } });
    expect(
      toSessionEvent({ type: "tool_execution_end", toolCallId: "t1", result: "done", isError: true }),
    ).toEqual({
      type: "tool_end",
      toolCallId: "t1",
      result: { type: "tool_result", toolCallId: "t1", content: "done", isError: true },
    });
  });

  it("drops harness events with no contract representation", () => {
    expect(toSessionEvent({ type: "bash_execution_update" })).toBeUndefined();
    expect(toSessionEvent({ type: "summarization_retry_finished" })).toBeUndefined();
  });

  it("emits nothing for a message_update carrying only a cumulative snapshot", () => {
    expect(
      toSessionEvent({ type: "message_update", assistantMessageEvent: { type: "start" } }),
    ).toBeUndefined();
  });
});

/** Minimal stand-in for AgentSession; the adapter only needs this surface. */
function fakeSession(overrides: Partial<AgentSessionLike> = {}) {
  let listener: ((event: unknown) => void) | undefined;
  const session = {
    sessionId: "session-1",
    sessionName: "fake",
    sessionFile: "/tmp/session.jsonl",
    model: { provider: "openai-codex", id: "gpt-5.5" },
    thinkingLevel: "medium",
    isStreaming: false,
    isCompacting: false,
    steeringMode: "all" as const,
    followUpMode: "all" as const,
    autoCompactionEnabled: true,
    messages: [] as unknown[],
    pendingMessageCount: 0,
    subscribe: (fn: (event: unknown) => void) => {
      listener = fn;
      return () => {
        listener = undefined;
      };
    },
    prompt: vi.fn(async () => {}),
    steer: vi.fn(async () => {}),
    followUp: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
    setModel: vi.fn(async () => {}),
    setThinkingLevel: vi.fn(),
    setSteeringMode: vi.fn(),
    setFollowUpMode: vi.fn(),
    setAutoCompactionEnabled: vi.fn(),
    compact: vi.fn(async () => ({})),
    ...overrides,
  };
  return { session: session as unknown as AgentSessionLike, emit: (event: unknown) => listener?.(event) };
}

describe("PiAgentSessionAdapter", () => {
  it("projects session state into the contract", () => {
    const { session } = fakeSession();
    const adapter = new PiAgentSessionAdapter(session, { cwd: "/work" });
    expect(adapter.getState()).toEqual({
      sessionId: "session-1",
      sessionName: "fake",
      sessionFile: "/tmp/session.jsonl",
      cwd: "/work",
      model: { provider: "openai-codex", id: "gpt-5.5" },
      thinkingLevel: "medium",
      isStreaming: false,
      isCompacting: false,
      steeringMode: "all",
      followUpMode: "all",
      autoCompactionEnabled: true,
      messageCount: 0,
      pendingMessageCount: 0,
    });
  });

  it("translates subscribed events and drops unmapped ones", () => {
    const { session, emit } = fakeSession();
    const adapter = new PiAgentSessionAdapter(session, { cwd: "/work" });
    const seen: SessionEvent[] = [];
    adapter.start();
    adapter.subscribe((event) => seen.push(event));

    emit({ type: "turn_start" });
    emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hi" } });
    emit({ type: "bash_execution_update", delta: "ls" });
    emit({ type: "agent_settled" });

    expect(seen).toEqual([
      { type: "turn_start" },
      { type: "message_delta", delta: { type: "text_delta", text: "hi" } },
      { type: "settled" },
    ]);
  });

  it("stops emitting after dispose", () => {
    const { session, emit } = fakeSession();
    const adapter = new PiAgentSessionAdapter(session, { cwd: "/work" });
    const seen: SessionEvent[] = [];
    const stop = adapter.start();
    adapter.subscribe((event) => seen.push(event));
    stop();
    emit({ type: "turn_start" });
    expect(seen).toEqual([]);
  });

  it("routes commands to the session", async () => {
    const { session } = fakeSession();
    const adapter = new PiAgentSessionAdapter(session, { cwd: "/work" });

    expect(await adapter.execute({ id: "a", type: "prompt", text: "hello" })).toEqual({
      type: "command_result",
      id: "a",
      command: "prompt",
      ok: true,
    });
    expect(session.prompt).toHaveBeenCalledWith("hello", undefined);

    await adapter.execute({ type: "set_thinking_level", level: "high" });
    expect(session.setThinkingLevel).toHaveBeenCalledWith("high");

    await adapter.execute({ type: "abort" });
    expect(session.abort).toHaveBeenCalled();
  });

  it("reports command failures instead of throwing", async () => {
    const { session } = fakeSession({
      prompt: vi.fn(async () => {
        throw new Error("provider unavailable");
      }),
    });
    const adapter = new PiAgentSessionAdapter(session, { cwd: "/work" });
    expect(await adapter.execute({ id: "z", type: "prompt", text: "hi" })).toEqual({
      type: "command_result",
      id: "z",
      command: "prompt",
      ok: false,
      error: "provider unavailable",
    });
  });

  it("rejects an unknown model rather than silently keeping the current one", async () => {
    const { session } = fakeSession();
    const adapter = new PiAgentSessionAdapter(session, { cwd: "/work", lookupModel: () => undefined });
    expect(await adapter.execute({ type: "set_model", provider: "nope", modelId: "nope" })).toEqual({
      type: "command_result",
      id: undefined,
      command: "set_model",
      ok: false,
      error: "Unknown model: nope/nope",
    });
    expect(session.setModel).not.toHaveBeenCalled();
  });

  it("keeps every command result JSON-serializable", async () => {
    const { session } = fakeSession();
    const adapter = new PiAgentSessionAdapter(session, {
      cwd: "/work",
      listModels: () => [{ provider: "openai-codex", id: "gpt-5.5" }],
    });
    for (const command of [
      { type: "get_state" },
      { type: "get_messages" },
      { type: "get_available_models" },
    ] as const) {
      const result = await adapter.execute(command);
      expect(JSON.parse(JSON.stringify(result))).toEqual(JSON.parse(JSON.stringify(result)));
      expect(structuredClone(result)).toEqual(result);
    }
  });
});
