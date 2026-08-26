/**
 * Translation from harness/Pi values into Rocky's contract.
 *
 * This is the only place allowed to know both vocabularies. Everything here is
 * a pure function so it can be tested without a live session; `PiAgentSessionAdapter`
 * is the stateful wiring on top.
 */
import type {
  AssistantContentBlock,
  CompactionReason,
  MessageDelta,
  ModelRef,
  SessionEvent,
  SessionMessage,
  StopReason,
  ThinkingLevel,
  ToolResultBlock,
  Usage,
  UserContentBlock,
} from "../contract/index.js";
import { THINKING_LEVELS } from "../contract/index.js";

/** Structural shapes we read off harness values, kept local to avoid Pi generics. */
interface PiModelLike {
  provider: string;
  id: string;
  name?: string;
  displayName?: string;
  input?: readonly string[];
  contextWindow?: number;
  reasoning?: boolean;
  thinkingLevels?: readonly string[];
}

export function toModelRef(model: PiModelLike | undefined): ModelRef | undefined {
  if (!model) {
    return undefined;
  }
  const ref: ModelRef = { provider: model.provider, id: model.id };
  const displayName = model.displayName ?? model.name;
  if (displayName !== undefined) {
    ref.displayName = displayName;
  }
  if (model.input !== undefined) {
    ref.supportsImages = model.input.includes("image");
  }
  if (model.contextWindow !== undefined) {
    ref.contextWindow = model.contextWindow;
  }
  const levels = model.thinkingLevels?.filter((level): level is ThinkingLevel =>
    (THINKING_LEVELS as readonly string[]).includes(level),
  );
  if (levels !== undefined && levels.length > 0) {
    ref.supportedThinkingLevels = [...levels];
  }
  return ref;
}

export function toUsage(usage: Partial<Usage> | undefined): Usage {
  return {
    input: usage?.input ?? 0,
    output: usage?.output ?? 0,
    cacheRead: usage?.cacheRead ?? 0,
    cacheWrite: usage?.cacheWrite ?? 0,
    ...(usage?.reasoning !== undefined ? { reasoning: usage.reasoning } : {}),
    totalTokens: usage?.totalTokens ?? 0,
    cost: {
      input: usage?.cost?.input ?? 0,
      output: usage?.cost?.output ?? 0,
      cacheRead: usage?.cost?.cacheRead ?? 0,
      cacheWrite: usage?.cost?.cacheWrite ?? 0,
      total: usage?.cost?.total ?? 0,
    },
  };
}

const STOP_REASONS: readonly StopReason[] = [
  "pending",
  "stop",
  "length",
  "toolUse",
  "error",
  "aborted",
  "deferred",
];

export function toStopReason(reason: unknown): StopReason {
  return typeof reason === "string" && (STOP_REASONS as readonly string[]).includes(reason)
    ? (reason as StopReason)
    : "stop";
}

export function toThinkingLevel(level: unknown): ThinkingLevel {
  return typeof level === "string" && (THINKING_LEVELS as readonly string[]).includes(level)
    ? (level as ThinkingLevel)
    : "medium";
}

export function toCompactionReason(reason: unknown): CompactionReason {
  return reason === "manual" || reason === "threshold" || reason === "overflow" ? reason : "manual";
}

/** Tool arguments arrive as arbitrary JSON; keep only what survives serialization. */
function toPlainArguments(args: unknown): Record<string, unknown> {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return {};
  }
  try {
    return JSON.parse(JSON.stringify(args)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export { toPlainArguments };

interface PiContentLike {
  type: string;
  text?: string;
  thinking?: string;
  redacted?: boolean;
  data?: string;
  mimeType?: string;
  id?: string;
  name?: string;
  arguments?: unknown;
}

function toAssistantBlocks(content: readonly PiContentLike[]): AssistantContentBlock[] {
  const blocks: AssistantContentBlock[] = [];
  for (const item of content) {
    if (item.type === "text") {
      blocks.push({ type: "text", text: item.text ?? "" });
    } else if (item.type === "thinking") {
      blocks.push({
        type: "thinking",
        thinking: item.thinking ?? "",
        ...(item.redacted ? { redacted: true } : {}),
      });
    } else if (item.type === "toolCall") {
      blocks.push({
        type: "tool_call",
        id: item.id ?? "",
        name: item.name ?? "",
        arguments: toPlainArguments(item.arguments),
      });
    }
  }
  return blocks;
}

interface PiMessageLike {
  role: string;
  content: string | readonly PiContentLike[];
  timestamp?: number;
  provider?: string;
  model?: string;
  usage?: Partial<Usage>;
  stopReason?: unknown;
  errorMessage?: string;
  toolCallId?: string;
  isError?: boolean;
}

/**
 * Render a tool result payload as the text a client displays.
 *
 * Pi's `ToolResultMessage.content` is a `(TextContent | ImageContent)[]`, so the
 * common case is an array of blocks, not a string. Stringifying the wrapper here
 * would put `[{"type":"text","text":"..."}]` on screen.
 */
function toResultText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return "";
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        const block = item as PiContentLike;
        if (block?.type === "text") {
          return block.text ?? "";
        }
        if (block?.type === "image") {
          return `[image ${block.mimeType ?? "unknown"}]`;
        }
        return "";
      })
      .filter((text) => text.length > 0)
      .join("\n");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Flatten whatever a tool handed back into display text.
 *
 * Upstream wraps results as `AgentToolResult` — `{ content: (TextContent |
 * ImageContent)[]; details }` — on both the `tool_execution_end` event and the
 * toolResult message. Flattening without unwrapping first dumps the whole
 * wrapper as JSON onto the screen. Bare strings and bare arrays are also
 * accepted, because extension tools are not obliged to use the wrapper.
 */
function toToolText(value: unknown): string {
  if (value !== null && typeof value === "object" && !Array.isArray(value) && "content" in value) {
    return toResultText((value as { content: unknown }).content);
  }
  return toResultText(value);
}

export function toSessionMessage(message: PiMessageLike): SessionMessage | undefined {
  const timestamp = message.timestamp ?? 0;

  if (message.role === "user") {
    const content: readonly PiContentLike[] =
      typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
    const blocks: UserContentBlock[] = [];
    for (const item of content) {
      if (item.type === "text") {
        blocks.push({ type: "text", text: item.text ?? "" });
      } else if (item.type === "image") {
        blocks.push({
          type: "image",
          data: item.data ?? "",
          mimeType: item.mimeType ?? "application/octet-stream",
        });
      }
    }
    return { role: "user", content: blocks, timestamp };
  }

  if (message.role === "assistant") {
    const content: readonly PiContentLike[] =
      typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
    return {
      role: "assistant",
      content: toAssistantBlocks(content),
      model: { provider: message.provider ?? "unknown", id: message.model ?? "unknown" },
      usage: toUsage(message.usage),
      stopReason: toStopReason(message.stopReason),
      ...(message.errorMessage !== undefined ? { errorMessage: message.errorMessage } : {}),
      timestamp,
    };
  }

  if (message.role === "toolResult") {
    return {
      role: "tool_result",
      content: [
        {
          type: "tool_result",
          toolCallId: message.toolCallId ?? "",
          content: toToolText(message.content),
          ...(message.isError ? { isError: true } : {}),
        },
      ],
      timestamp,
    };
  }

  // Harness-internal message kinds (bash executions, custom entries) have no
  // contract representation yet; clients render them once they are promoted.
  return undefined;
}

interface PiAssistantMessageEventLike {
  type: string;
  contentIndex?: number;
  delta?: string;
  toolCall?: { id?: string; name?: string; arguments?: unknown };
}

/**
 * Map a streaming assistant event to a contract delta.
 *
 * Returns undefined for boundary events (`start`, `text_end`, `done`, …): the
 * contract expresses those through `message_start`/`message_end` instead, so a
 * client never has to reconcile two overlapping notions of "the message so far".
 */
export function toMessageDelta(event: PiAssistantMessageEventLike): MessageDelta | undefined {
  const index = event.contentIndex ?? 0;
  if (event.type === "text_delta") {
    return { type: "text_delta", index, text: event.delta ?? "" };
  }
  if (event.type === "thinking_delta") {
    return { type: "thinking_delta", index, thinking: event.delta ?? "" };
  }
  if (event.type === "toolcall_start") {
    return { type: "tool_call_start", index };
  }
  if (event.type === "toolcall_delta") {
    return { type: "tool_call_delta", index, argumentsJson: event.delta ?? "" };
  }
  if (event.type === "toolcall_end") {
    return {
      type: "tool_call_end",
      index,
      id: event.toolCall?.id ?? "",
      name: event.toolCall?.name ?? "",
      arguments: toPlainArguments(event.toolCall?.arguments),
    };
  }
  return undefined;
}

interface PiSessionEventLike {
  type: string;
  message?: PiMessageLike;
  assistantMessageEvent?: PiAssistantMessageEventLike;
  usage?: Partial<Usage>;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  partialResult?: unknown;
  reason?: unknown;
  aborted?: boolean;
  errorMessage?: string;
  steering?: readonly string[];
  followUp?: readonly string[];
  attempt?: number;
  maxAttempts?: number;
  delayMs?: number;
  success?: boolean;
  finalError?: string;
  name?: string;
  level?: unknown;
}

/**
 * Map one harness session event to zero or one contract events.
 *
 * Returning undefined is normal: the harness emits more granularity than the
 * contract exposes, and unmapped events are dropped rather than leaked.
 */
export function toSessionEvent(event: PiSessionEventLike): SessionEvent | undefined {
  switch (event.type) {
    case "turn_start":
      return { type: "turn_start" };
    case "turn_end":
      return { type: "turn_end", stopReason: toStopReason(event.message?.stopReason) };
    case "message_start": {
      // The harness opens a message for the user prompt and for every tool
      // result too, not only for the assistant. Reporting them all as
      // "assistant" makes a client open a phantom assistant bubble each time.
      const role = event.message?.role;
      if (role === "user") {
        return { type: "message_start", role: "user" };
      }
      if (role === "toolResult") {
        return { type: "message_start", role: "tool_result" };
      }
      if (role === "assistant") {
        return { type: "message_start", role: "assistant" };
      }
      return undefined;
    }
    case "message_update": {
      if (!event.assistantMessageEvent) {
        return undefined;
      }
      const delta = toMessageDelta(event.assistantMessageEvent);
      if (!delta) {
        return undefined;
      }
      // A live `AgentSession.subscribe` listener gets the raw event, whose
      // usage lives on the cumulative message; only the JSON/RPC wire form
      // hoists it to the top level (json-event.ts). Read both.
      const usage = event.usage ?? event.message?.usage;
      return {
        type: "message_delta",
        delta,
        ...(usage ? { usage: toUsage(usage) } : {}),
      };
    }
    case "message_end": {
      const message = event.message ? toSessionMessage(event.message) : undefined;
      return message ? { type: "message_end", message } : undefined;
    }
    case "tool_execution_start":
      return {
        type: "tool_start",
        toolCallId: event.toolCallId ?? "",
        name: event.toolName ?? "",
        arguments: toPlainArguments(event.args),
      };
    case "tool_execution_update": {
      // Only bash emits these, and its payload is a cumulative snapshot in the
      // same block shape as a tool result, so reuse the result flattener.
      const partial = event.partialResult as
        | { content?: unknown; details?: { truncation?: unknown } }
        | undefined;
      if (!partial) {
        return undefined;
      }
      const content = toToolText(partial);
      return {
        type: "tool_progress",
        toolCallId: event.toolCallId ?? "",
        name: event.toolName ?? "",
        content,
        ...(partial.details?.truncation ? { truncated: true } : {}),
      };
    }
    case "tool_execution_end": {
      const result: ToolResultBlock = {
        type: "tool_result",
        toolCallId: event.toolCallId ?? "",
        content: toToolText(event.result),
        ...(event.isError ? { isError: true } : {}),
      };
      return { type: "tool_end", toolCallId: result.toolCallId, result };
    }
    case "queue_update":
      return {
        type: "queue_update",
        steering: [...(event.steering ?? [])],
        followUp: [...(event.followUp ?? [])],
      };
    case "compaction_start":
      return { type: "compaction_start", reason: toCompactionReason(event.reason) };
    case "compaction_end":
      return {
        type: "compaction_end",
        reason: toCompactionReason(event.reason),
        aborted: event.aborted ?? false,
        ...(event.errorMessage !== undefined ? { error: event.errorMessage } : {}),
      };
    case "auto_retry_start":
      return {
        type: "retry_start",
        attempt: event.attempt ?? 0,
        maxAttempts: event.maxAttempts ?? 0,
        delayMs: event.delayMs ?? 0,
        error: event.errorMessage ?? "",
      };
    case "auto_retry_end":
      return {
        type: "retry_end",
        success: event.success ?? false,
        attempt: event.attempt ?? 0,
        ...(event.finalError !== undefined ? { error: event.finalError } : {}),
      };
    case "session_info_changed":
      return { type: "session_name_changed", ...(event.name !== undefined ? { name: event.name } : {}) };
    case "agent_settled":
      return { type: "settled" };
    default:
      return undefined;
  }
}
