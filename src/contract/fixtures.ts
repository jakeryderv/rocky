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
  SessionEvent,
  SessionState,
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
  { type: "queue_update", steering: ["queued steer"], followUp: [] },
  { type: "compaction_start", reason: "threshold" },
  { type: "compaction_end", reason: "threshold", aborted: false },
  { type: "retry_start", attempt: 1, maxAttempts: 3, delayMs: 500, error: "overloaded" },
  { type: "retry_end", success: true, attempt: 1 },
  { type: "state_changed", state: FIXTURE_STATE },
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
];

/** Every `MessageDelta` variant, so the delta union is covered exhaustively too. */
export const FIXTURE_DELTAS: MessageDelta[] = [
  { type: "text_delta", index: 0, text: "Hello" },
  { type: "thinking_delta", index: 1, thinking: "considering" },
  { type: "tool_call_start", index: 2 },
  { type: "tool_call_delta", index: 2, argumentsJson: '{"path":' },
  { type: "tool_call_end", index: 2, id: "call_1", name: "read", arguments: { path: "README.md" } },
];
