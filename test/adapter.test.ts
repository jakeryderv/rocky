import { describe, expect, it, vi } from "vitest";
import {
  flattenSessionTree,
  toMessageDelta,
  toModelRef,
  toSessionEntrySummary,
  toSessionEvent,
  toSessionMessage,
  toSessionStats,
  toSlashCommand,
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

  it("reduces a harness slash command to the contract shape", () => {
    expect(
      toSlashCommand({
        name: "explain",
        description: "Explain a file",
        source: "prompt",
        argumentHint: "<path>",
        sourceInfo: { scope: "project", path: "/home/user/project/.rocky/prompts/explain.md" },
      }),
    ).toEqual({
      name: "explain",
      description: "Explain a file",
      source: "prompt",
      argumentHint: "<path>",
      scope: "project",
    });
  });

  it("keeps filesystem paths out of a slash command", () => {
    const mapped = toSlashCommand({
      name: "review",
      source: "extension",
      sourceInfo: { scope: "user", path: "/home/user/.rocky/agent/extensions/review.ts" },
    });
    expect(JSON.stringify(mapped)).not.toContain("/home/user");
  });

  it("drops a slash command whose source the contract does not model", () => {
    expect(toSlashCommand({ name: "quit", source: "builtin" })).toBeUndefined();
  });

  it("omits a scope the contract does not model rather than leaking it", () => {
    expect(toSlashCommand({ name: "x", source: "skill", sourceInfo: { scope: "global" } })).toEqual({
      name: "x",
      source: "skill",
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

  it("ignores streaming boundary events", () => {
    expect(toMessageDelta({ type: "text_start" })).toBeUndefined();
    expect(toMessageDelta({ type: "done" })).toBeUndefined();
  });

  it("maps tool execution events", () => {
    expect(
      toSessionEvent({ type: "tool_execution_start", toolCallId: "t1", toolName: "read", args: { p: 1 } }),
    ).toEqual({ type: "tool_start", toolCallId: "t1", name: "read", arguments: { p: 1 } });
    // The real shape: upstream emits an AgentToolResult wrapper, not a string.
    // The previous fixture used `result: "done"`, which is why a JSON-dump bug
    // survived two reviews on this path.
    expect(
      toSessionEvent({
        type: "tool_execution_end",
        toolCallId: "t1",
        result: { content: [{ type: "text", text: "done" }], details: {} },
        isError: true,
      }),
    ).toEqual({
      type: "tool_end",
      toolCallId: "t1",
      result: { type: "tool_result", toolCallId: "t1", content: "done", isError: true },
    });
  });

  it("accepts a bare string or array from an extension tool", () => {
    expect(toSessionEvent({ type: "tool_execution_end", toolCallId: "t1", result: "plain text" })).toEqual({
      type: "tool_end",
      toolCallId: "t1",
      result: { type: "tool_result", toolCallId: "t1", content: "plain text" },
    });
    const update = toSessionEvent({
      type: "tool_execution_update",
      toolCallId: "t1",
      toolName: "custom",
      partialResult: [{ type: "text", text: "working" }],
    });
    expect((update as { content?: string }).content).toBe("working");
  });

  // pi's ToolResultMessage has no `output` field and its `content` is a block
  // array, so a tool result must be flattened, not stringified. The previous
  // test used `result: "done"` — a shape the harness never emits — which hid this.
  it("flattens a real tool-result message into display text", () => {
    expect(
      toSessionMessage({
        role: "toolResult",
        toolCallId: "t1",
        content: [
          { type: "text", text: "# Rocky" },
          { type: "text", text: "second line" },
        ],
        isError: false,
        timestamp: 7,
      }),
    ).toEqual({
      role: "tool_result",
      content: [{ type: "tool_result", toolCallId: "t1", content: "# Rocky\nsecond line" }],
      timestamp: 7,
    });
  });

  it("describes an image block in a tool result rather than dumping its bytes", () => {
    expect(
      toSessionMessage({
        role: "toolResult",
        toolCallId: "t2",
        content: [{ type: "image", data: "AAAA", mimeType: "image/png" }],
        isError: true,
        timestamp: 8,
      }),
    ).toEqual({
      role: "tool_result",
      content: [{ type: "tool_result", toolCallId: "t2", content: "[image image/png]", isError: true }],
      timestamp: 8,
    });
  });

  it("carries the provider failure reason on a failed turn", () => {
    const message = toSessionMessage({
      role: "assistant",
      content: [],
      stopReason: "error",
      errorMessage: "529 overloaded",
      timestamp: 9,
    });
    expect((message as { errorMessage?: string }).errorMessage).toBe("529 overloaded");
  });

  it("attributes deltas to their content block", () => {
    expect(toMessageDelta({ type: "text_delta", contentIndex: 3, delta: "abc" })).toEqual({
      type: "text_delta",
      index: 3,
      text: "abc",
    });
    expect(toMessageDelta({ type: "thinking_delta", contentIndex: 1, delta: "why" })).toEqual({
      type: "thinking_delta",
      index: 1,
      thinking: "why",
    });
  });

  it("separates a tool-call fragment from the authoritative terminal event", () => {
    expect(toMessageDelta({ type: "toolcall_delta", contentIndex: 2, delta: '{"path":' })).toEqual({
      type: "tool_call_delta",
      index: 2,
      argumentsJson: '{"path":',
    });
    expect(
      toMessageDelta({
        type: "toolcall_end",
        contentIndex: 2,
        toolCall: { id: "call_1", name: "read", arguments: { path: "a.ts" } },
      }),
    ).toEqual({ type: "tool_call_end", index: 2, id: "call_1", name: "read", arguments: { path: "a.ts" } });
  });

  it("reports message_start for the role that actually started", () => {
    expect(toSessionEvent({ type: "message_start", message: { role: "user", content: "hi" } })).toEqual({
      type: "message_start",
      role: "user",
    });
    expect(toSessionEvent({ type: "message_start", message: { role: "assistant", content: [] } })).toEqual({
      type: "message_start",
      role: "assistant",
    });
    expect(toSessionEvent({ type: "message_start", message: { role: "toolResult", content: [] } })).toEqual({
      type: "message_start",
      role: "tool_result",
    });
  });

  // On the live subscribe path usage lives on the cumulative message; only the
  // JSON/RPC wire form hoists it to the top level.
  it("finds usage on the live path as well as the wire path", () => {
    const live = toSessionEvent({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "x" },
      message: { role: "assistant", content: [], usage: { input: 11, totalTokens: 11 } },
    });
    expect((live as { usage?: { input: number } }).usage?.input).toBe(11);

    const wire = toSessionEvent({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "x" },
      usage: { input: 22, totalTokens: 22 },
    });
    expect((wire as { usage?: { input: number } }).usage?.input).toBe(22);
  });

  // Only bash emits these, and the payload is a cumulative snapshot in the same
  // block shape as a tool result.
  it("maps a running tool's cumulative output", () => {
    expect(
      toSessionEvent({
        type: "tool_execution_update",
        toolCallId: "c1",
        toolName: "bash",
        partialResult: { content: [{ type: "text", text: "line one\nline two" }], details: {} },
      }),
    ).toEqual({ type: "tool_progress", toolCallId: "c1", name: "bash", content: "line one\nline two" });
  });

  it("flags truncated tool output", () => {
    const event = toSessionEvent({
      type: "tool_execution_update",
      toolCallId: "c1",
      toolName: "bash",
      partialResult: {
        content: [{ type: "text", text: "lots" }],
        details: { truncation: { truncated: true } },
      },
    });
    expect((event as { truncated?: boolean }).truncated).toBe(true);
  });

  it("ignores a tool update with no payload", () => {
    expect(toSessionEvent({ type: "tool_execution_update", toolCallId: "c1" })).toBeUndefined();
  });

  it("drops harness events with no contract representation", () => {
    expect(toSessionEvent({ type: "entry_appended" })).toBeUndefined();
    expect(toSessionEvent({ type: "summarization_retry_finished" })).toBeUndefined();
  });

  // A delta, not a snapshot — `tool_progress` next door is the other way round,
  // and treating this one as cumulative would show only the final chunk.
  it("carries bash output as an append, tagged with the command that asked", () => {
    expect(toSessionEvent({ type: "bash_execution_update", id: "c19", delta: "· ·" })).toEqual({
      type: "bash_output",
      commandId: "c19",
      delta: "· ·",
    });
    expect(toSessionEvent({ type: "bash_execution_update", delta: "x" })).toEqual({
      type: "bash_output",
      delta: "x",
    });
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
    isBashRunning: false,
    sessionManager: { getTree: () => [], getLeafId: () => null },
    exportToHtml: vi.fn(async () => "/work/session.html"),
    getUserMessagesForForking: () => [],
    getSessionStats: () => ({ sessionId: "session-1" }),
    setSessionName: vi.fn(),
    executeBash: vi.fn(async () => ({ output: "", exitCode: 0, cancelled: false, truncated: false })),
    abortBash: vi.fn(),
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
      isBashRunning: false,
    });
  });

  it("translates subscribed events and drops unmapped ones", () => {
    const { session, emit } = fakeSession();
    const adapter = new PiAgentSessionAdapter(session, { cwd: "/work" });
    const seen: SessionEvent[] = [];
    adapter.start();
    adapter.subscribe((event) => seen.push(event));

    emit({ type: "turn_start" });
    emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "hi" },
    });
    emit({ type: "entry_appended", entry: { id: "e1" } });
    emit({ type: "agent_settled" });

    expect(seen).toEqual([
      { type: "turn_start" },
      { type: "message_delta", delta: { type: "text_delta", index: 0, text: "hi" } },
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

  it("pushes state_changed when an event moved the state", () => {
    const { session, emit } = fakeSession();
    const mutable = session as { isStreaming: boolean };
    const adapter = new PiAgentSessionAdapter(session, { cwd: "/work" });
    const seen: SessionEvent[] = [];
    adapter.start();
    adapter.subscribe((event) => seen.push(event));

    mutable.isStreaming = true;
    emit({ type: "turn_start" });

    expect(seen.map((event) => event.type)).toEqual(["turn_start", "state_changed"]);
    const pushed = seen[1] as Extract<SessionEvent, { type: "state_changed" }>;
    expect(pushed.state.isStreaming).toBe(true);
  });

  it("stays quiet while state is unchanged, so a stream does not push per delta", () => {
    const { session, emit } = fakeSession();
    const adapter = new PiAgentSessionAdapter(session, { cwd: "/work" });
    const seen: SessionEvent[] = [];
    adapter.start();
    adapter.subscribe((event) => seen.push(event));

    for (let index = 0; index < 3; index += 1) {
      emit({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "hi" },
      });
    }

    expect(seen.filter((event) => event.type === "state_changed")).toEqual([]);
  });

  it("pushes state for a harness event the contract does not translate", () => {
    const { session, emit } = fakeSession();
    const mutable = session as { pendingMessageCount: number };
    const adapter = new PiAgentSessionAdapter(session, { cwd: "/work" });
    const seen: SessionEvent[] = [];
    adapter.start();
    adapter.subscribe((event) => seen.push(event));

    mutable.pendingMessageCount = 2;
    emit({ type: "entry_appended", entry: { id: "e1" } });

    expect(seen.map((event) => event.type)).toEqual(["state_changed"]);
  });

  it("pushes state after a setter the harness reports no event for", async () => {
    const { session } = fakeSession({
      setThinkingLevel: vi.fn(function (this: void, level: string) {
        mutable.thinkingLevel = level;
      }),
    });
    const mutable = session as { thinkingLevel: string };
    const adapter = new PiAgentSessionAdapter(session, { cwd: "/work" });
    const seen: SessionEvent[] = [];
    adapter.start();
    adapter.subscribe((event) => seen.push(event));

    await adapter.execute({ type: "set_thinking_level", level: "high" });

    expect(seen).toEqual([
      { type: "state_changed", state: { ...adapter.getState(), thinkingLevel: "high" } },
    ]);
  });

  it("does not push state before start, so a disposed adapter stays silent", async () => {
    const { session } = fakeSession();
    const adapter = new PiAgentSessionAdapter(session, { cwd: "/work" });
    const seen: SessionEvent[] = [];
    adapter.subscribe((event) => seen.push(event));

    await adapter.execute({ type: "set_thinking_level", level: "high" });

    expect(seen).toEqual([]);
  });

  it("lists slash commands from the catalog, dropping unmodelled sources", async () => {
    const { session } = fakeSession();
    const adapter = new PiAgentSessionAdapter(session, {
      cwd: "/work",
      listCommands: () => [
        { name: "review", description: "Review", source: "extension", sourceInfo: { scope: "project" } },
        { name: "quit", source: "builtin" },
        { name: "skill:ship", source: "skill" },
      ],
    });
    expect(await adapter.execute({ id: "k", type: "get_commands" })).toEqual({
      type: "command_result",
      id: "k",
      command: "get_commands",
      ok: true,
      commands: [
        { name: "review", description: "Review", source: "extension", scope: "project" },
        { name: "skill:ship", source: "skill" },
      ],
    });
  });

  it("reports an empty command list when the host supplies no catalog", async () => {
    const { session } = fakeSession();
    const adapter = new PiAgentSessionAdapter(session, { cwd: "/work" });
    expect(await adapter.execute({ type: "get_commands" })).toEqual({
      type: "command_result",
      id: undefined,
      command: "get_commands",
      ok: true,
      commands: [],
    });
  });

  it("lists sessions, resolving a forked session's parent to an id", async () => {
    const { session } = fakeSession();
    const adapter = new PiAgentSessionAdapter(session, {
      cwd: "/work",
      sessions: {
        list: () => [
          {
            id: "parent",
            path: "/sessions/parent.jsonl",
            cwd: "/work",
            name: "first",
            created: new Date(1_000),
            modified: new Date(2_000),
            messageCount: 3,
            firstMessage: "explain   this\n repo",
          },
          {
            id: "child",
            path: "/sessions/child.jsonl",
            cwd: "/work",
            parentSessionPath: "/sessions/parent.jsonl",
            created: new Date(3_000),
            modified: new Date(4_000),
            messageCount: 1,
            firstMessage: "",
          },
        ],
        switchTo: async () => ({ cancelled: false }),
        create: async () => ({ cancelled: false }),
        fork: async () => ({ cancelled: false }),
        current: () => session,
      },
    });

    const result = await adapter.execute({ id: "s", type: "list_sessions" });
    expect(result).toEqual({
      type: "command_result",
      id: "s",
      command: "list_sessions",
      ok: true,
      sessions: [
        {
          id: "parent",
          name: "first",
          cwd: "/work",
          createdAt: 1_000,
          modifiedAt: 2_000,
          messageCount: 3,
          // Collapsed, because a picker row is one line.
          preview: "explain this repo",
        },
        {
          id: "child",
          cwd: "/work",
          createdAt: 3_000,
          modifiedAt: 4_000,
          messageCount: 1,
          preview: "",
          parentId: "parent",
        },
      ],
    });
  });

  it("drops a parent that is not in the listing rather than leaking its path", async () => {
    const { session } = fakeSession();
    const adapter = new PiAgentSessionAdapter(session, {
      cwd: "/work",
      sessions: {
        list: () => [{ id: "child", path: "/s/child.jsonl", parentSessionPath: "/s/gone.jsonl" }],
        switchTo: async () => ({ cancelled: false }),
        create: async () => ({ cancelled: false }),
        fork: async () => ({ cancelled: false }),
        current: () => session,
      },
    });
    const result = await adapter.execute({ type: "list_sessions" });
    expect(JSON.stringify(result)).not.toContain("/s/gone.jsonl");
    expect(result.ok && result.command === "list_sessions" && result.sessions[0]?.parentId).toBeUndefined();
  });

  // A switch replaces the session object. Keeping the old subscription would
  // leave the transcript frozen while every command still reported success.
  it("re-subscribes to the session a switch installed", async () => {
    const first = fakeSession();
    const second = fakeSession({ sessionId: "session-2" });
    let live = first.session;
    const adapter = new PiAgentSessionAdapter(first.session, {
      cwd: "/work",
      sessions: {
        list: () => [],
        switchTo: async () => {
          live = second.session;
          return { cancelled: false };
        },
        create: async () => ({ cancelled: false }),
        fork: async () => ({ cancelled: false }),
        current: () => live,
      },
    });
    const seen: SessionEvent[] = [];
    adapter.start();
    adapter.subscribe((event) => seen.push(event));

    await adapter.execute({ type: "switch_session", sessionId: "session-2" });

    expect(seen.filter((event) => event.type === "session_switched")).toHaveLength(1);
    expect(adapter.getState().sessionId).toBe("session-2");

    seen.length = 0;
    second.emit({ type: "turn_start" });
    expect(seen.map((event) => event.type)).toEqual(["turn_start"]);

    // And the replaced session no longer reaches the client.
    seen.length = 0;
    first.emit({ type: "turn_start" });
    expect(seen).toEqual([]);
  });

  it("leaves the session alone when a switch is cancelled", async () => {
    const { session } = fakeSession();
    const other = fakeSession({ sessionId: "session-2" });
    const adapter = new PiAgentSessionAdapter(session, {
      cwd: "/work",
      sessions: {
        list: () => [],
        switchTo: async () => ({ cancelled: true }),
        create: async () => ({ cancelled: false }),
        fork: async () => ({ cancelled: false }),
        current: () => other.session,
      },
    });
    const seen: SessionEvent[] = [];
    adapter.start();
    adapter.subscribe((event) => seen.push(event));

    expect(await adapter.execute({ type: "switch_session", sessionId: "session-2" })).toEqual({
      type: "command_result",
      id: undefined,
      command: "switch_session",
      ok: true,
    });
    expect(seen.filter((event) => event.type === "session_switched")).toEqual([]);
    expect(adapter.getState().sessionId).toBe("session-1");
  });

  it("reports plainly when the host cannot manage sessions", async () => {
    const { session } = fakeSession();
    const adapter = new PiAgentSessionAdapter(session, { cwd: "/work" });
    for (const command of [
      { type: "list_sessions" },
      { type: "switch_session", sessionId: "x" },
      { type: "new_session" },
    ] as const) {
      const result = await adapter.execute(command);
      expect(result.ok).toBe(false);
    }
  });

  it("brackets a shell command with start and end events", async () => {
    const chunks: ((chunk: string) => void)[] = [];
    const { session } = fakeSession({
      executeBash: vi.fn(async (_command: string, onChunk?: (chunk: string) => void) => {
        if (onChunk) {
          chunks.push(onChunk);
        }
        return { output: "ok", exitCode: 0, cancelled: false, truncated: false };
      }),
    });
    const adapter = new PiAgentSessionAdapter(session, { cwd: "/work" });
    const seen: SessionEvent[] = [];
    adapter.start();
    adapter.subscribe((event) => seen.push(event));

    const result = await adapter.execute({ id: "b1", type: "bash", command: "ls", excludeFromContext: true });

    expect(result).toEqual({
      type: "command_result",
      id: "b1",
      command: "bash",
      ok: true,
      result: { output: "ok", exitCode: 0, cancelled: false, truncated: false },
    });
    expect(seen.filter((event) => event.type === "bash_start")).toEqual([
      { type: "bash_start", commandId: "b1", command: "ls" },
    ]);
    expect(seen.filter((event) => event.type === "bash_end")).toEqual([
      {
        type: "bash_end",
        commandId: "b1",
        result: { output: "ok", exitCode: 0, cancelled: false, truncated: false },
      },
    ]);
    expect(session.executeBash).toHaveBeenCalledWith("ls", undefined, {
      excludeFromContext: true,
      id: "b1",
    });
  });

  // A killed process reports no exit code at all, which must not become a 0.
  it("keeps a killed command's missing exit code missing", async () => {
    const { session } = fakeSession({
      executeBash: vi.fn(async () => ({ output: "partial", cancelled: true, truncated: true })),
    });
    const adapter = new PiAgentSessionAdapter(session, { cwd: "/work" });
    const result = await adapter.execute({ type: "bash", command: "sleep 100" });
    expect(result).toEqual({
      type: "command_result",
      id: undefined,
      command: "bash",
      ok: true,
      result: { output: "partial", cancelled: true, truncated: true },
    });
  });

  it("reports plainly when the session cannot run shell commands", async () => {
    const { session } = fakeSession();
    // A session from a host that does not expose shell execution at all.
    delete (session as { executeBash?: unknown }).executeBash;
    const adapter = new PiAgentSessionAdapter(session, { cwd: "/work" });
    const result = await adapter.execute({ type: "bash", command: "ls" });
    expect(result.ok).toBe(false);
  });

  it("forwards an abort to the session", async () => {
    const abortBash = vi.fn();
    const { session } = fakeSession({ abortBash });
    const adapter = new PiAgentSessionAdapter(session, { cwd: "/work" });
    expect(await adapter.execute({ type: "abort_bash" })).toEqual({
      type: "command_result",
      id: undefined,
      command: "abort_bash",
      ok: true,
    });
    expect(abortBash).toHaveBeenCalled();
  });

  it("projects session entries from the tree, so labels resolve", () => {
    expect(
      flattenSessionTree([
        {
          entry: {
            id: "e1",
            parentId: null,
            type: "message",
            timestamp: "2026-08-26T00:00:00.000Z",
            message: { role: "user", content: [{ type: "text", text: "explain   this\nrepo" }] },
          },
          children: [
            {
              entry: {
                id: "e2",
                parentId: "e1",
                type: "compaction",
                timestamp: "2026-08-26T00:00:01.000Z",
                summary: "summary",
              },
              // Only `getTree` attaches a label to the entry it marks; the flat
              // entry list leaves it as a separate entry nobody can resolve.
              label: "the good answer",
            },
          ],
        },
      ]),
    ).toEqual([
      {
        id: "e1",
        kind: "message",
        role: "user",
        preview: "explain this repo",
        timestamp: Date.parse("2026-08-26T00:00:00.000Z"),
      },
      {
        id: "e2",
        parentId: "e1",
        kind: "compaction",
        preview: "summary",
        timestamp: Date.parse("2026-08-26T00:00:01.000Z"),
        label: "the good answer",
      },
    ]);
  });

  // An extension-injected message is still an extension entry to a tree view.
  it("folds custom_message into custom rather than widening the kinds", () => {
    expect(toSessionEntrySummary({ id: "x", type: "custom_message", customType: "notes" })?.kind).toBe(
      "custom",
    );
  });

  it("drops an entry kind the contract does not model", () => {
    expect(toSessionEntrySummary({ id: "x", type: "something_new" })).toBeUndefined();
  });

  // Null right after a compaction, before the next response. Zero would read as
  // "no context used".
  it("omits an unknown context estimate rather than reporting zero", () => {
    const stats = toSessionStats({ contextUsage: { tokens: null, contextWindow: 400 } });
    expect(stats.contextTokens).toBeUndefined();
    expect(stats.contextWindow).toBe(400);
    expect(stats.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
  });

  // A clone is a fork at the leaf, which is what the harness's own RPC mode
  // does — one path rather than two that can drift.
  it("clones by forking at the current leaf", async () => {
    const forks: [string, string][] = [];
    const { session } = fakeSession({
      sessionManager: { getTree: () => [], getLeafId: () => "leaf-9" },
    });
    const adapter = new PiAgentSessionAdapter(session, {
      cwd: "/work",
      sessions: {
        list: () => [],
        switchTo: async () => ({ cancelled: false }),
        create: async () => ({ cancelled: false }),
        fork: async (entryId: string, position: "before" | "at") => {
          forks.push([entryId, position]);
          return { cancelled: false };
        },
        current: () => session,
      },
    });

    expect(await adapter.execute({ type: "clone" })).toEqual({
      type: "command_result",
      id: undefined,
      command: "clone",
      ok: true,
    });
    expect(forks).toEqual([["leaf-9", "at"]]);
  });

  it("forks before a message by default and returns its text", async () => {
    const { session } = fakeSession({
      sessionManager: { getTree: () => [], getLeafId: () => "leaf" },
    });
    const adapter = new PiAgentSessionAdapter(session, {
      cwd: "/work",
      sessions: {
        list: () => [],
        switchTo: async () => ({ cancelled: false }),
        create: async () => ({ cancelled: false }),
        fork: async () => ({ cancelled: false, selectedText: "explain this repo" }),
        current: () => session,
      },
    });
    expect(await adapter.execute({ type: "fork", entryId: "e1" })).toEqual({
      type: "command_result",
      id: undefined,
      command: "fork",
      ok: true,
      cancelled: false,
      text: "explain this repo",
    });
  });

  it("reports a vetoed fork as cancelled rather than as a failure", async () => {
    const { session } = fakeSession();
    const seen: SessionEvent[] = [];
    const adapter = new PiAgentSessionAdapter(session, {
      cwd: "/work",
      sessions: {
        list: () => [],
        switchTo: async () => ({ cancelled: false }),
        create: async () => ({ cancelled: false }),
        fork: async () => ({ cancelled: true }),
        current: () => session,
      },
    });
    adapter.start();
    adapter.subscribe((event) => seen.push(event));
    expect(await adapter.execute({ type: "fork", entryId: "e1" })).toEqual({
      type: "command_result",
      id: undefined,
      command: "fork",
      ok: true,
      cancelled: true,
    });
    expect(seen.filter((event) => event.type === "session_switched")).toEqual([]);
  });

  it("returns history from the leaf's tree, trimmed by `since`", async () => {
    const tree = [
      {
        entry: { id: "e1", parentId: null, type: "message", message: { role: "user", content: "a" } },
        children: [
          {
            entry: {
              id: "e2",
              parentId: "e1",
              type: "message",
              message: { role: "assistant", content: "b" },
            },
            children: [{ entry: { id: "e3", parentId: "e2", type: "session_info", name: "named" } }],
          },
        ],
      },
    ];
    const { session } = fakeSession({
      sessionManager: { getTree: () => tree as never, getLeafId: () => "e3" },
    });
    const adapter = new PiAgentSessionAdapter(session, { cwd: "/work" });

    const all = await adapter.execute({ type: "get_entries" });
    expect(all.ok && all.command === "get_entries" && all.entries.map((e) => e.id)).toEqual([
      "e1",
      "e2",
      "e3",
    ]);
    expect(all.ok && all.command === "get_entries" && all.leafId).toBe("e3");

    const since = await adapter.execute({ type: "get_entries", since: "e1" });
    expect(since.ok && since.command === "get_entries" && since.entries.map((e) => e.id)).toEqual([
      "e2",
      "e3",
    ]);
  });

  it("lists fork points and names the session", async () => {
    const setSessionName = vi.fn();
    const { session } = fakeSession({
      setSessionName,
      getUserMessagesForForking: () => [{ entryId: "e1", text: "explain this repo" }],
    });
    const adapter = new PiAgentSessionAdapter(session, { cwd: "/work" });

    expect(await adapter.execute({ type: "get_fork_points" })).toEqual({
      type: "command_result",
      id: undefined,
      command: "get_fork_points",
      ok: true,
      points: [{ entryId: "e1", text: "explain this repo" }],
    });

    await adapter.execute({ type: "set_session_name", name: "contract work" });
    expect(setSessionName).toHaveBeenCalledWith("contract work");
  });

  it("exports to the path the session reports", async () => {
    const { session } = fakeSession({ exportToHtml: vi.fn(async () => "/work/session.html") });
    const adapter = new PiAgentSessionAdapter(session, { cwd: "/work" });
    expect(await adapter.execute({ type: "export_html" })).toEqual({
      type: "command_result",
      id: undefined,
      command: "export_html",
      ok: true,
      path: "/work/session.html",
    });
  });

  // Themes are a core setting shared with the CLI, so a change has to reach
  // every client watching the session, not only the one that asked.
  it("pushes the resolved theme when it is changed", async () => {
    let active = "dark";
    const { session } = fakeSession();
    const adapter = new PiAgentSessionAdapter(session, {
      cwd: "/work",
      themes: {
        list: () => ["dark", "light"],
        active: () => active,
        resolve: () => (active === "dark" ? { text: "#e5e5e7" } : { text: "#000000" }),
        set: (name: string) => {
          active = name;
        },
      },
    });
    const seen: SessionEvent[] = [];
    adapter.start();
    adapter.subscribe((event) => seen.push(event));

    expect(await adapter.execute({ type: "get_themes" })).toEqual({
      type: "command_result",
      id: undefined,
      command: "get_themes",
      ok: true,
      themes: ["dark", "light"],
      active: "dark",
    });

    await adapter.execute({ type: "set_theme", name: "light" });
    expect(seen.filter((event) => event.type === "theme_changed")).toEqual([
      { type: "theme_changed", theme: { name: "light", colors: { text: "#000000" } } },
    ]);
  });

  it("reports plainly when the host has no themes", async () => {
    const { session } = fakeSession();
    const adapter = new PiAgentSessionAdapter(session, { cwd: "/work" });
    for (const command of [
      { type: "get_themes" },
      { type: "get_theme" },
      { type: "set_theme", name: "light" },
    ] as const) {
      expect((await adapter.execute(command)).ok).toBe(false);
    }
  });

  // The login is a conversation: the core asks, the client answers, and the
  // command resolves only when the whole flow finishes.
  it("turns a login prompt into an event and waits for the reply", async () => {
    const { session } = fakeSession();
    let answered: string | undefined;
    const adapter = new PiAgentSessionAdapter(session, {
      cwd: "/work",
      auth: {
        list: () => [],
        logout: async () => {},
        login: async (_provider, _method, interaction) => {
          interaction.notify({ type: "device_code", userCode: "WXYZ", verificationUri: "https://x.test" });
          answered = await interaction.prompt({ type: "secret", message: "Enter Anthropic API key" });
        },
      },
    });
    const seen: SessionEvent[] = [];
    adapter.start();
    adapter.subscribe((event) => seen.push(event));

    const login = adapter.execute({ id: "l1", type: "login", provider: "anthropic", method: "api_key" });
    await Promise.resolve();

    const request = seen.find((event) => event.type === "auth_request");
    expect(request).toEqual({
      type: "auth_request",
      requestId: "auth-1",
      kind: "secret",
      message: "Enter Anthropic API key",
    });
    expect(seen).toContainEqual({
      type: "auth_notice",
      kind: "device_code",
      userCode: "WXYZ",
      verificationUri: "https://x.test",
    });

    await adapter.execute({ type: "auth_reply", requestId: "auth-1", value: "sk-test" });
    expect(await login).toEqual({ type: "command_result", id: "l1", command: "login", ok: true });
    expect(answered).toBe("sk-test");
    expect(seen).toContainEqual({ type: "auth_end", provider: "anthropic", ok: true });
  });

  it("reports a failed login on the result and as an event", async () => {
    const { session } = fakeSession();
    const adapter = new PiAgentSessionAdapter(session, {
      cwd: "/work",
      auth: {
        list: () => [],
        logout: async () => {},
        login: async () => {
          throw new Error("device code expired");
        },
      },
    });
    const seen: SessionEvent[] = [];
    adapter.start();
    adapter.subscribe((event) => seen.push(event));

    expect(await adapter.execute({ type: "login", provider: "xai", method: "oauth" })).toEqual({
      type: "command_result",
      id: undefined,
      command: "login",
      ok: false,
      error: "device code expired",
    });
    // Announced too: another client watching the session has to stop showing
    // the login it was rendering.
    expect(seen).toContainEqual({
      type: "auth_end",
      provider: "xai",
      ok: false,
      error: "device code expired",
    });
  });

  // Several OAuth flows race a pasted redirect against a local callback
  // server, and withdraw the paste prompt when the server wins.
  it("tells the client when the flow withdraws a prompt", async () => {
    const { session } = fakeSession();
    const controller = new AbortController();
    const adapter = new PiAgentSessionAdapter(session, {
      cwd: "/work",
      auth: {
        list: () => [],
        logout: async () => {},
        login: async (_provider, _method, interaction) => {
          const pasted = interaction
            .prompt({ type: "manual_code", message: "Paste the redirect", signal: controller.signal })
            .catch(() => "");
          controller.abort();
          await pasted;
        },
      },
    });
    const seen: SessionEvent[] = [];
    adapter.start();
    adapter.subscribe((event) => seen.push(event));

    await adapter.execute({ type: "login", provider: "anthropic", method: "oauth" });
    expect(seen).toContainEqual({ type: "auth_request_cancelled", requestId: "auth-1" });
  });

  it("leaves nothing waiting once a login ends", async () => {
    const { session } = fakeSession();
    let release!: () => void;
    const adapter = new PiAgentSessionAdapter(session, {
      cwd: "/work",
      auth: {
        list: () => [],
        logout: async () => {},
        login: async (_provider, _method, interaction) => {
          void interaction.prompt({ type: "text", message: "never answered" }).catch(() => {});
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        },
      },
    });
    const seen: SessionEvent[] = [];
    adapter.start();
    adapter.subscribe((event) => seen.push(event));

    const login = adapter.execute({ type: "login", provider: "anthropic", method: "oauth" });
    await Promise.resolve();
    release();
    await login;

    expect(seen.filter((event) => event.type === "auth_request_cancelled")).toHaveLength(1);
  });

  // The core withdraws requests on its own, so a reply and a withdrawal can
  // cross on the wire.
  it("ignores a reply to a request it has forgotten", async () => {
    const { session } = fakeSession();
    const adapter = new PiAgentSessionAdapter(session, {
      cwd: "/work",
      auth: { list: () => [], logout: async () => {}, login: async () => {} },
    });
    expect(await adapter.execute({ type: "auth_reply", requestId: "gone", value: "x" })).toEqual({
      type: "command_result",
      id: undefined,
      command: "auth_reply",
      ok: true,
    });
  });

  it("lists providers, dropping methods the contract does not model", async () => {
    const { session } = fakeSession();
    const adapter = new PiAgentSessionAdapter(session, {
      cwd: "/work",
      auth: {
        logout: async () => {},
        login: async () => {},
        list: () => [
          {
            id: "anthropic",
            name: "Anthropic",
            methods: ["oauth", "api_key", "smoke-signal"],
            authenticated: true,
            source: "stored",
            subscription: true,
          },
          { id: "groq", methods: [], authenticated: true, source: "not-a-source" },
        ],
      },
    });
    expect(await adapter.execute({ type: "get_providers" })).toEqual({
      type: "command_result",
      id: undefined,
      command: "get_providers",
      ok: true,
      providers: [
        {
          id: "anthropic",
          name: "Anthropic",
          methods: ["oauth", "api_key"],
          authenticated: true,
          source: "stored",
          subscription: true,
        },
        { id: "groq", name: "groq", methods: [], authenticated: true },
      ],
    });
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
      { type: "get_commands" },
    ] as const) {
      const result = await adapter.execute(command);
      expect(JSON.parse(JSON.stringify(result))).toEqual(JSON.parse(JSON.stringify(result)));
      expect(structuredClone(result)).toEqual(result);
    }
  });
});
