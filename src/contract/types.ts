/**
 * Rocky's client-agnostic session contract.
 *
 * Every type here must be JSON-serializable and free of harness or Pi types, so
 * that any client — the OpenTUI terminal client, a future web or remote client —
 * can depend on this module alone. The rule is enforced mechanically by
 * `test/contract-isolation.test.ts`; do not import from `@earendil-works/*` or
 * `@jakeryderv/rocky-harness` in this directory.
 *
 * The shapes derive from the harness's existing RPC protocol
 * (`packages/harness/src/modes/rpc/rpc-types.ts`), which is already a
 * serializable command/event/state protocol. Translation lives in
 * `src/adapter/`, never here.
 */

// ============================================================================
// Primitives
// ============================================================================

/** How much reasoning effort a model should spend. Mirrors the harness levels. */
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export const THINKING_LEVELS: readonly ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

/** How queued messages are released while a turn is streaming. */
export type QueueMode = "all" | "one-at-a-time";

/** Why a turn stopped. */
export type StopReason = "pending" | "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred";

/** What triggered a compaction. */
export type CompactionReason = "manual" | "threshold" | "overflow";

/**
 * A model, reduced to what a client needs to display and select one.
 *
 * Deliberately not the harness's `Model<Api>`: that carries provider-specific
 * generics and non-serializable capability functions.
 */
export interface ModelRef {
  provider: string;
  id: string;
  displayName?: string;
  /** Whether the model accepts image attachments. */
  supportsImages?: boolean;
  /** Thinking levels this model actually honors, when the provider reports them. */
  supportedThinkingLevels?: ThinkingLevel[];
  contextWindow?: number;
}

/** Token and cost accounting for a turn or a session. */
export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning?: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

// ============================================================================
// Message content
// ============================================================================

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  /** True when the provider redacted the reasoning text. */
  redacted?: boolean;
}

export interface ImageBlock {
  type: "image";
  /** Base64-encoded image bytes. */
  data: string;
  mimeType: string;
}

export interface ToolCallBlock {
  type: "tool_call";
  id: string;
  name: string;
  /** Tool arguments as plain JSON. */
  arguments: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  toolCallId: string;
  /** Rendered result text. Binary results are surfaced as attachments instead. */
  content: string;
  isError?: boolean;
}

export type UserContentBlock = TextBlock | ImageBlock;
export type AssistantContentBlock = TextBlock | ThinkingBlock | ToolCallBlock;

export interface UserMessage {
  role: "user";
  content: UserContentBlock[];
  timestamp: number;
}

export interface AssistantMessage {
  role: "assistant";
  content: AssistantContentBlock[];
  model: ModelRef;
  usage: Usage;
  stopReason: StopReason;
  /** Provider-reported failure text, when the turn ended in an error. */
  errorMessage?: string | undefined;
  timestamp: number;
}

export interface ToolResultMessage {
  role: "tool_result";
  content: ToolResultBlock[];
  timestamp: number;
}

export type SessionMessage = UserMessage | AssistantMessage | ToolResultMessage;

// ============================================================================
// Slash commands
// ============================================================================

/** Where a slash command came from, reduced to what a client can act on. */
export type SlashCommandSource = "extension" | "prompt" | "skill";

/** Which resource tree a command was discovered in. */
export type SlashCommandScope = "user" | "project" | "temporary";

/**
 * A command a client can offer for `/name` invocation.
 *
 * Invocation is not a separate command: sending the text as a `prompt` is what
 * runs it, because the core dispatches extension commands and expands skills
 * and prompt templates on the prompt path. This type is therefore discovery
 * only — everything a completion popup needs and nothing more.
 *
 * Deliberately excludes the core's `sourceInfo` file paths. A client needs to
 * tell two same-named commands apart, which `scope` does; it does not need a
 * filesystem path, and a remote client should not be handed one.
 */
export interface SlashCommand {
  /** Without the leading slash. Skills arrive prefixed as `skill:<name>`. */
  name: string;
  description?: string;
  source: SlashCommandSource;
  /** Shape of the arguments, when the source declares one. */
  argumentHint?: string;
  scope?: SlashCommandScope;
}

// ============================================================================
// Sessions
// ============================================================================

/**
 * A past session, reduced to what a picker needs to recognize and choose one.
 *
 * `id` is the handle: `switch_session` takes it, and the core resolves it to
 * wherever the transcript actually lives. The harness's own RPC protocol passes
 * an absolute `sessionPath` instead, which works only for a client sharing the
 * core's filesystem — the same reason `SlashCommand` carries `scope` and not a
 * path.
 */
export interface SessionSummary {
  id: string;
  name?: string;
  /** Working directory the session was started in. */
  cwd: string;
  /** Epoch milliseconds. */
  createdAt: number;
  modifiedAt: number;
  messageCount: number;
  /** Opening user message, truncated, so a session is recognizable without opening it. */
  preview: string;
  /** Set when this session was forked from another one in the list. */
  parentId?: string;
}

// ============================================================================
// State
// ============================================================================

/** A complete, serializable snapshot a client can render from cold. */
export interface SessionState {
  sessionId: string;
  sessionName?: string;
  /** Absolute path of the session transcript, when the session is persisted. */
  sessionFile?: string;
  cwd: string;
  model?: ModelRef;
  thinkingLevel: ThinkingLevel;
  isStreaming: boolean;
  isCompacting: boolean;
  steeringMode: QueueMode;
  followUpMode: QueueMode;
  autoCompactionEnabled: boolean;
  messageCount: number;
  pendingMessageCount: number;
}

// ============================================================================
// Commands (client -> core)
// ============================================================================

/**
 * Commands a client can issue. `id` correlates a command with its `command_result`.
 *
 * This is the slice a terminal client needs to drive a session; session
 * management (fork, clone, switch), bash execution, and extension UI are
 * modeled in the harness RPC protocol and get promoted here when a client
 * actually consumes them.
 */
export type SessionCommand =
  | { id?: string | undefined; type: "prompt"; text: string; images?: ImageBlock[] }
  | { id?: string | undefined; type: "steer"; text: string; images?: ImageBlock[] }
  | { id?: string | undefined; type: "follow_up"; text: string; images?: ImageBlock[] }
  | { id?: string | undefined; type: "abort" }
  | { id?: string | undefined; type: "get_state" }
  | { id?: string | undefined; type: "get_messages" }
  | { id?: string | undefined; type: "set_model"; provider: string; modelId: string }
  | { id?: string | undefined; type: "get_available_models" }
  | { id?: string | undefined; type: "get_commands" }
  | { id?: string | undefined; type: "list_sessions" }
  | { id?: string | undefined; type: "switch_session"; sessionId: string }
  | { id?: string | undefined; type: "new_session" }
  | { id?: string | undefined; type: "set_thinking_level"; level: ThinkingLevel }
  | { id?: string | undefined; type: "set_steering_mode"; mode: QueueMode }
  | { id?: string | undefined; type: "set_follow_up_mode"; mode: QueueMode }
  | { id?: string | undefined; type: "compact"; customInstructions?: string }
  | { id?: string | undefined; type: "set_auto_compaction"; enabled: boolean };

export type SessionCommandType = SessionCommand["type"];

// ============================================================================
// Command results (core -> client)
// ============================================================================

export type CommandResult =
  | { type: "command_result"; id?: string | undefined; command: "get_state"; ok: true; state: SessionState }
  | {
      type: "command_result";
      id?: string | undefined;
      command: "get_messages";
      ok: true;
      messages: SessionMessage[];
    }
  | {
      type: "command_result";
      id?: string | undefined;
      command: "get_available_models";
      ok: true;
      models: ModelRef[];
    }
  | { type: "command_result"; id?: string | undefined; command: "set_model"; ok: true; model: ModelRef }
  | {
      type: "command_result";
      id?: string | undefined;
      command: "get_commands";
      ok: true;
      commands: SlashCommand[];
    }
  | {
      type: "command_result";
      id?: string | undefined;
      command: "list_sessions";
      ok: true;
      sessions: SessionSummary[];
    }
  /**
   * Acknowledgement for commands that return no payload.
   *
   * The data-bearing commands are excluded so that narrowing on `command`
   * actually discriminates — otherwise this variant overlaps them and a client
   * cannot reach `state`, `messages`, or `model` after a `command === "..."`
   * check.
   */
  | {
      type: "command_result";
      id?: string | undefined;
      command: Exclude<
        SessionCommandType,
        "get_state" | "get_messages" | "get_available_models" | "set_model" | "get_commands" | "list_sessions"
      >;
      ok: true;
    }
  | { type: "command_result"; id?: string | undefined; command: string; ok: false; error: string };

// ============================================================================
// Events (core -> client)
// ============================================================================

/**
 * Incremental updates to the assistant message currently streaming.
 *
 * Deltas are additive: a client applies them to the message opened by
 * `message_start` and replaces it with the authoritative message on
 * `message_end`. Cumulative snapshots are deliberately not sent on every delta.
 */
export type MessageDelta =
  /**
   * `index` is the content-block position the delta belongs to. Without it a
   * client cannot tell an append to the current block from the start of an
   * adjacent block of the same kind, and interleaved blocks reconstruct wrong.
   */
  | { type: "text_delta"; index: number; text: string }
  | { type: "thinking_delta"; index: number; thinking: string }
  /** A tool-call block opened at `index`; its name and arguments stream after. */
  | { type: "tool_call_start"; index: number }
  /** An argument fragment to concatenate. Not valid JSON on its own. */
  | { type: "tool_call_delta"; index: number; argumentsJson: string }
  /** The authoritative tool call. Replaces whatever the fragments accumulated. */
  | { type: "tool_call_end"; index: number; id: string; name: string; arguments: Record<string, unknown> };

export type SessionEvent =
  // Turn lifecycle
  | { type: "turn_start" }
  | { type: "turn_end"; stopReason: StopReason }
  // Message streaming
  | { type: "message_start"; role: "user" | "assistant" | "tool_result" }
  | { type: "message_delta"; delta: MessageDelta; usage?: Usage }
  | { type: "message_end"; message: SessionMessage }
  // Tools
  | { type: "tool_start"; toolCallId: string; name: string; arguments: Record<string, unknown> }
  /**
   * Output so far from a running tool.
   *
   * `content` is a CUMULATIVE snapshot, not a delta: replace what is displayed,
   * never append. Only the bash tool emits these today (throttled upstream at
   * ~100ms); the other built-in tools accept the callback and ignore it, so a
   * client must not expect progress from them.
   */
  | { type: "tool_progress"; toolCallId: string; name: string; content: string; truncated?: boolean }
  | { type: "tool_end"; toolCallId: string; result: ToolResultBlock }
  // Queueing
  | { type: "queue_update"; steering: string[]; followUp: string[] }
  // Compaction
  | { type: "compaction_start"; reason: CompactionReason }
  | { type: "compaction_end"; reason: CompactionReason; aborted: boolean; error?: string }
  // Retry
  | { type: "retry_start"; attempt: number; maxAttempts: number; delayMs: number; error: string }
  | { type: "retry_end"; success: boolean; attempt: number; error?: string }
  // Session
  /**
   * The core is now driving a different session.
   *
   * A client must discard its transcript and re-read `get_messages`: the
   * message history it holds belongs to the session that was just replaced.
   * This is an event rather than only a command result because a session can
   * also be switched by an extension, with no command to attribute it to.
   */
  | { type: "session_switched"; state: SessionState }
  | { type: "state_changed"; state: SessionState }
  | { type: "session_name_changed"; name?: string }
  | { type: "error"; message: string }
  // The core has fully settled: no streaming, no queued work.
  | { type: "settled" };

export type SessionEventType = SessionEvent["type"];

/** Everything the core can push to a client over one connection. */
export type SessionOutbound = SessionEvent | CommandResult;
