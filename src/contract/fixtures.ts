/**
 * Canonical contract values used by the round-trip tests and available to
 * clients as rendering fixtures. Kept in the contract so it stays free of
 * harness types.
 */
import type {
  CommandResult,
  MessageDelta,
  ModelRef,
  SessionCommand,
  SessionEntrySummary,
  SessionEvent,
  SessionState,
  SessionStats,
  SessionSummary,
  SlashCommand,
  ThemeSnapshot,
  Usage,
} from "./types.js";

export const FIXTURE_MODEL: ModelRef = {
  provider: "openai-codex",
  id: "gpt-5.5",
  displayName: "GPT-5.5",
  supportsImages: true,
  supportedThinkingLevels: ["off", "low", "medium", "high"],
  contextWindow: 400_000,
};

export const FIXTURE_USAGE: Usage = {
  input: 1200,
  output: 340,
  cacheRead: 800,
  cacheWrite: 0,
  reasoning: 120,
  totalTokens: 1540,
  cost: { input: 0.0012, output: 0.0034, cacheRead: 0.0001, cacheWrite: 0, total: 0.0047 },
};

export const FIXTURE_STATE: SessionState = {
  sessionId: "01a03ba3-c8d2-75c2-86d9-56cafcf5d663",
  sessionName: "contract fixture",
  sessionFile: "/home/user/.rocky/agent/sessions/project/session.jsonl",
  cwd: "/home/user/project",
  model: FIXTURE_MODEL,
  thinkingLevel: "medium",
  isStreaming: false,
  isCompacting: false,
  steeringMode: "all",
  followUpMode: "one-at-a-time",
  autoCompactionEnabled: true,
  messageCount: 4,
  pendingMessageCount: 0,
  isBashRunning: false,
};

export const FIXTURE_SLASH_COMMANDS: SlashCommand[] = [
  { name: "review", description: "Review the working tree", source: "extension", scope: "project" },
  {
    name: "explain",
    description: "Explain a file",
    source: "prompt",
    argumentHint: "<path>",
    scope: "user",
  },
  { name: "skill:ship", description: "Take the branch to merged", source: "skill", scope: "project" },
];

export const FIXTURE_SESSIONS: SessionSummary[] = [
  {
    id: "01a03ba3-c8d2-75c2-86d9-56cafcf5d663",
    name: "contract fixture",
    cwd: "/home/user/project",
    createdAt: 1_787_700_000_000,
    modifiedAt: 1_787_707_000_000,
    messageCount: 4,
    preview: "explain this repo",
  },
  {
    id: "01a03ba3-c8d2-75c2-86d9-000000000002",
    cwd: "/home/user/project",
    createdAt: 1_787_600_000_000,
    modifiedAt: 1_787_601_000_000,
    messageCount: 12,
    preview: "why does the build fail on bun",
    parentId: "01a03ba3-c8d2-75c2-86d9-56cafcf5d663",
  },
];

export const FIXTURE_ENTRIES: SessionEntrySummary[] = [
  { id: "e1", kind: "message", role: "user", preview: "explain this repo", timestamp: 1_787_700_000_000 },
  {
    id: "e2",
    parentId: "e1",
    kind: "message",
    role: "assistant",
    preview: "Rocky replaces the presentation half…",
    timestamp: 1_787_700_001_000,
    label: "the good answer",
  },
  {
    id: "e3",
    parentId: "e2",
    kind: "compaction",
    preview: "summary of the first twelve turns",
    timestamp: 1_787_700_002_000,
  },
];

export const FIXTURE_STATS: SessionStats = {
  sessionId: "01a03ba3-c8d2-75c2-86d9-56cafcf5d663",
  userMessages: 2,
  assistantMessages: 2,
  toolCalls: 3,
  toolResults: 3,
  totalMessages: 7,
  tokens: { input: 1200, output: 340, cacheRead: 800, cacheWrite: 0, total: 2340 },
  cost: 0.0047,
  contextTokens: 2100,
  contextWindow: 400_000,
};

export const FIXTURE_THEME: ThemeSnapshot = {
  name: "dark",
  colors: { text: "#e5e5e7", muted: "#7a7a7a", accent: "#7aa2f7", error: "#f7768e" },
};

export const FIXTURE_COMMANDS: SessionCommand[] = [
  { id: "c1", type: "prompt", text: "explain this repo" },
  {
    id: "c2",
    type: "prompt",
    text: "what is in this image?",
    images: [{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }],
  },
  { id: "c3", type: "steer", text: "stop and summarize instead" },
  { id: "c4", type: "abort" },
  { id: "c5", type: "get_state" },
  { id: "c6", type: "set_model", provider: "openai-codex", modelId: "gpt-5.5" },
  { id: "c7", type: "set_thinking_level", level: "high" },
  { id: "c8", type: "set_steering_mode", mode: "one-at-a-time" },
  { id: "c9", type: "compact", customInstructions: "keep the design decisions" },
  { id: "c10", type: "set_auto_compaction", enabled: false },
  { id: "c11", type: "get_commands" },
  { id: "c12", type: "follow_up", text: "and then run the tests" },
  { id: "c13", type: "get_messages" },
  { id: "c14", type: "get_available_models" },
  { id: "c15", type: "set_follow_up_mode", mode: "all" },
  { id: "c16", type: "list_sessions" },
  { id: "c17", type: "switch_session", sessionId: "01a03ba3-c8d2-75c2-86d9-000000000002" },
  { id: "c18", type: "new_session" },
  { id: "c19", type: "bash", command: "npm run verify", excludeFromContext: true },
  { id: "c20", type: "abort_bash" },
  { id: "c21", type: "export_html", outputPath: "/home/user/project/session.html" },
  { id: "c22", type: "fork", entryId: "e1", position: "before" },
  { id: "c23", type: "clone" },
  { id: "c24", type: "get_fork_points" },
  { id: "c25", type: "set_session_name", name: "contract work" },
  { id: "c26", type: "get_session_stats" },
  { id: "c27", type: "get_entries", since: "e1" },
  { id: "c28", type: "get_themes" },
  { id: "c29", type: "get_theme" },
  { id: "c30", type: "set_theme", name: "light" },
];

export const FIXTURE_EVENTS: SessionEvent[] = [
  { type: "turn_start" },
  { type: "message_start", role: "user" },
  { type: "message_start", role: "assistant" },
  { type: "message_start", role: "tool_result" },
  { type: "message_delta", delta: { type: "thinking_delta", index: 0, thinking: "considering" } },
  { type: "message_delta", delta: { type: "text_delta", index: 1, text: "Hello" }, usage: FIXTURE_USAGE },
  { type: "message_delta", delta: { type: "tool_call_start", index: 2 } },
  {
    type: "message_delta",
    delta: { type: "tool_call_delta", index: 2, argumentsJson: '{"path":' },
  },
  {
    type: "message_delta",
    delta: { type: "tool_call_end", index: 2, id: "call_1", name: "read", arguments: { path: "README.md" } },
  },
  { type: "tool_start", toolCallId: "call_1", name: "read", arguments: { path: "README.md" } },
  { type: "tool_progress", toolCallId: "call_2", name: "bash", content: "building…", truncated: true },
  {
    type: "tool_end",
    toolCallId: "call_1",
    result: { type: "tool_result", toolCallId: "call_1", content: "# Rocky" },
  },
  {
    type: "message_end",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "considering" },
        { type: "text", text: "Hello" },
        { type: "tool_call", id: "call_1", name: "read", arguments: { path: "README.md" } },
      ],
      model: FIXTURE_MODEL,
      usage: FIXTURE_USAGE,
      stopReason: "toolUse",
      timestamp: 1_787_707_000_000,
    },
  },
  { type: "turn_end", stopReason: "stop" },
  { type: "bash_start", commandId: "c19", command: "npm run verify" },
  { type: "bash_output", commandId: "c19", delta: "· · ·" },
  {
    type: "bash_end",
    commandId: "c19",
    result: { output: "263 passed", exitCode: 0, cancelled: false, truncated: false },
  },
  { type: "queue_update", steering: ["queued steer"], followUp: [] },
  { type: "compaction_start", reason: "threshold" },
  { type: "compaction_end", reason: "threshold", aborted: false },
  { type: "retry_start", attempt: 1, maxAttempts: 3, delayMs: 500, error: "overloaded" },
  { type: "retry_end", success: true, attempt: 1 },
  { type: "state_changed", state: FIXTURE_STATE },
  { type: "theme_changed", theme: FIXTURE_THEME },
  { type: "session_switched", state: FIXTURE_STATE },
  { type: "session_name_changed", name: "renamed" },
  { type: "error", message: "provider rejected the request" },
  {
    type: "message_end",
    message: {
      role: "assistant",
      content: [],
      model: FIXTURE_MODEL,
      usage: FIXTURE_USAGE,
      stopReason: "error",
      errorMessage: "provider returned 529 overloaded",
      timestamp: 1_787_707_000_500,
    },
  },
  { type: "settled" },
];

export const FIXTURE_COMMAND_RESULTS: CommandResult[] = [
  { type: "command_result", id: "c5", command: "get_state", ok: true, state: FIXTURE_STATE },
  { type: "command_result", id: "c6", command: "set_model", ok: true, model: FIXTURE_MODEL },
  { type: "command_result", id: "cX", command: "get_available_models", ok: true, models: [FIXTURE_MODEL] },
  { type: "command_result", id: "c4", command: "abort", ok: true },
  { type: "command_result", id: "c9", command: "compact", ok: false, error: "nothing to compact" },
  {
    type: "command_result",
    id: "c11",
    command: "get_commands",
    ok: true,
    commands: FIXTURE_SLASH_COMMANDS,
  },
  { type: "command_result", id: "c16", command: "list_sessions", ok: true, sessions: FIXTURE_SESSIONS },
  { type: "command_result", id: "c21", command: "export_html", ok: true, path: "/home/user/x.html" },
  {
    type: "command_result",
    id: "c28",
    command: "get_themes",
    ok: true,
    themes: ["dark", "light"],
    active: "dark",
  },
  { type: "command_result", id: "c29", command: "get_theme", ok: true, theme: FIXTURE_THEME },
  {
    type: "command_result",
    id: "c22",
    command: "fork",
    ok: true,
    cancelled: false,
    text: "explain this repo",
  },
  {
    type: "command_result",
    id: "c24",
    command: "get_fork_points",
    ok: true,
    points: [{ entryId: "e1", text: "explain this repo" }],
  },
  { type: "command_result", id: "c26", command: "get_session_stats", ok: true, stats: FIXTURE_STATS },
  {
    type: "command_result",
    id: "c27",
    command: "get_entries",
    ok: true,
    entries: FIXTURE_ENTRIES,
    leafId: "e3",
  },
  {
    type: "command_result",
    id: "c19",
    command: "bash",
    ok: true,
    result: { output: "263 passed", exitCode: 0, cancelled: false, truncated: false },
  },
];

/** Every `MessageDelta` variant, so the delta union is covered exhaustively too. */
export const FIXTURE_DELTAS: MessageDelta[] = [
  { type: "text_delta", index: 0, text: "Hello" },
  { type: "thinking_delta", index: 1, thinking: "considering" },
  { type: "tool_call_start", index: 2 },
  { type: "tool_call_delta", index: 2, argumentsJson: '{"path":' },
  { type: "tool_call_end", index: 2, id: "call_1", name: "read", arguments: { path: "README.md" } },
];
