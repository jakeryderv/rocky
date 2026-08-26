/**
 * Headless render tests, driven by a fake port.
 *
 * These prove the client toolchain is actually reactive — the failure mode
 * `babel-preset-solid` protects against is a silent frozen first frame, not an
 * error — and they make no model call.
 */
import { expect, test } from "bun:test";
import type { ScrollBoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import type { CommandResult, SessionCommand, SessionEvent, SessionPort } from "@rocky/contract";
import { App } from "../src/App.js";

function fakePort() {
  let listener: ((event: SessionEvent) => void) | undefined;
  const sent: SessionCommand[] = [];
  const port: SessionPort = {
    subscribe: (fn) => {
      listener = fn;
      return () => {
        listener = undefined;
      };
    },
    execute: async (command): Promise<CommandResult> => {
      sent.push(command);
      if (command.type === "get_state") {
        return {
          type: "command_result",
          command: "get_state",
          ok: true,
          state: {
            sessionId: "s1",
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
          },
        };
      }
      return { type: "command_result", command: command.type as never, ok: true };
    },
  };
  return { port, emit: (event: SessionEvent) => listener?.(event), sent };
}

test("renders the status line from session state", async () => {
  const { port } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 60, height: 12 });
  await t.renderOnce();
  expect(t.captureCharFrame()).toContain("openai-codex/gpt-5.5");
});

// The whole point of the babel toolchain: if props were evaluated eagerly the
// first frame would still render and this second frame would not change.
test("stays reactive as deltas arrive", async () => {
  const { port, emit } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 60, height: 12 });
  await t.renderOnce();
  expect(t.captureCharFrame()).not.toContain("Hello");

  emit({ type: "turn_start" });
  emit({ type: "message_start", role: "assistant" });
  emit({ type: "message_delta", delta: { type: "text_delta", index: 0, text: "Hello" } });
  await t.renderOnce();

  const frame = t.captureCharFrame();
  expect(frame).toContain("Hello");
  expect(frame).toContain("streaming");
});

test("renders a tool call and its result", async () => {
  const { port, emit } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 60, height: 14 });
  await t.renderOnce();

  emit({ type: "message_start", role: "assistant" });
  emit({
    type: "message_delta",
    delta: { type: "tool_call_end", index: 0, id: "c1", name: "read", arguments: { path: "a.ts" } },
  });
  emit({
    type: "tool_end",
    toolCallId: "c1",
    result: { type: "tool_result", toolCallId: "c1", content: "file body" },
  });
  await t.renderOnce();

  const frame = t.captureCharFrame();
  expect(frame).toContain("read");
  expect(frame).toContain("file body");
});

test("shows a failed turn's reason", async () => {
  const { port, emit } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 60, height: 12 });
  await t.renderOnce();
  emit({ type: "error", message: "provider overloaded" });
  await t.renderOnce();
  expect(t.captureCharFrame()).toContain("provider overloaded");
});

/** Push `count` assistant entries so the transcript overflows a small viewport. */
function fillTranscript(emit: (event: SessionEvent) => void, count: number, offset = 0) {
  for (let index = 0; index < count; index += 1) {
    const i = index + offset;
    emit({ type: "message_start", role: "assistant" });
    emit({ type: "message_delta", delta: { type: "text_delta", index: 0, text: `LINE${i}` } });
    emit({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: `LINE${i}` }],
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
        timestamp: i,
      },
    });
  }
}

interface RenderableNode {
  constructor: { name: string };
  getChildren?: () => RenderableNode[];
}

function findRenderable(renderer: { root: { getChildren(): unknown[] } }, name: string): RenderableNode {
  const stack = [...renderer.root.getChildren()] as RenderableNode[];
  while (stack.length > 0) {
    const node = stack.shift();
    if (node?.constructor?.name === name) {
      return node;
    }
    if (typeof node?.getChildren === "function") {
      stack.push(...node.getChildren());
    }
  }
  throw new Error(`no ${name} in the tree`);
}

function findScrollBox(renderer: { root: { getChildren(): unknown[] } }): ScrollBoxRenderable {
  return findRenderable(renderer, "ScrollBoxRenderable") as unknown as ScrollBoxRenderable;
}

// The whole point of scrollback: old content must actually leave the viewport
// while the newest stays visible.
test("scrolls old content out of view and keeps the newest visible", async () => {
  const { port, emit } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 40, height: 10 });
  await t.flush();

  fillTranscript(emit, 40);
  await t.flush();

  const frame = t.captureCharFrame();
  expect(frame).toContain("LINE39");
  expect(frame).not.toContain("LINE0 ");
});

test("scrolling to the top reveals the oldest content", async () => {
  const { port, emit } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 40, height: 10 });
  await t.flush();
  fillTranscript(emit, 40);
  await t.flush();

  const scrollBox = findScrollBox(t.renderer as never);
  scrollBox.scrollTo(0);
  await t.flush();

  const frame = t.captureCharFrame();
  expect(frame).toContain("LINE0");
  expect(frame).not.toContain("LINE39");
});

// A frozen viewport would still show the first frame's content, so assert the
// newest entry arrives after the transcript already overflowed.
test("stays pinned to the newest entry as content grows", async () => {
  const { port, emit } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 40, height: 10 });
  await t.flush();
  fillTranscript(emit, 30);
  await t.flush();
  expect(t.captureCharFrame()).toContain("LINE29");

  // Continue the numbering so the assertion is about scroll position, not
  // about labels being reused.
  fillTranscript(emit, 3, 30);
  await t.flush();
  const frame = t.captureCharFrame();
  expect(frame).toContain("LINE32");
  expect(frame).not.toContain("LINE29");
});

// The scrollbox is focusable by default and steals focus on click, which would
// silently break typing.
test("leaves the input focused and the transcript unfocusable", async () => {
  const { port, emit } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 40, height: 10 });
  await t.flush();
  fillTranscript(emit, 20);
  await t.flush();

  const scrollBox = findScrollBox(t.renderer as never);
  expect(scrollBox.focusable).toBe(false);

  await t.mockMouse.click(3, 3);
  await t.flush();
  expect(scrollBox.focused).toBe(false);
});

test("shows running tool output in the transcript", async () => {
  const { port, emit } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 50, height: 12 });
  await t.flush();

  emit({ type: "message_start", role: "assistant" });
  emit({
    type: "message_delta",
    delta: { type: "tool_call_end", index: 0, id: "c1", name: "bash", arguments: { command: "make" } },
  });
  emit({ type: "tool_progress", toolCallId: "c1", name: "bash", content: "compiling…" });
  await t.flush();

  const frame = t.captureCharFrame();
  expect(frame).toContain("bash");
  expect(frame).toContain("compiling");
});

// This indicator is easy to ship as dead code: the handler runs during event
// dispatch, before scrollTop updates, so a direct sample always reads "pinned".
test("flags that there is more content below, and only then", async () => {
  const { port, emit } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 40, height: 10 });
  await t.flush();
  fillTranscript(emit, 40);
  await t.flush();
  expect(t.captureCharFrame()).not.toContain("more below");

  await t.mockMouse.scroll(5, 3, "up");
  await t.mockMouse.scroll(5, 3, "up");
  await t.flush();
  expect(t.captureCharFrame()).toContain("more below");

  // Scrolling back down is the path a user actually takes, and it clears it.
  for (let i = 0; i < 6; i += 1) {
    await t.mockMouse.scroll(5, 3, "down");
  }
  await t.flush();
  expect(t.captureCharFrame()).not.toContain("more below");
});

// A programmatic scroll fires no mouse event, so the indicator can go stale.
// It must re-sync on the next transcript change rather than staying wrong.
test("re-syncs the indicator when the transcript changes", async () => {
  const { port, emit } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 40, height: 10 });
  await t.flush();
  fillTranscript(emit, 40);
  await t.flush();

  const scrollBox = findScrollBox(t.renderer as never);
  scrollBox.scrollTo(0);
  await t.flush();

  // Next transcript change re-samples the geometry and corrects the indicator.
  fillTranscript(emit, 1, 40);
  await t.flush();
  expect(t.captureCharFrame()).toContain("more below");
});

// Mapping entries to fresh objects before <For> recreates every row on every
// event, which exhausts OpenTUI's native SyntaxStyle handles and throws a few
// hundred entries into a session — i.e. during ordinary use.
test("survives a long session without exhausting native handles", async () => {
  const { port, emit } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 50, height: 12 });
  await t.flush();

  for (let batch = 0; batch < 15; batch += 1) {
    fillTranscript(emit, 20, batch * 20);
    await t.flush();
  }

  expect(t.captureCharFrame()).toContain("LINE299");
});

test("keeps the input focused when the transcript is clicked", async () => {
  const { port, emit } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 40, height: 10 });
  await t.flush();
  fillTranscript(emit, 20);
  await t.flush();

  const input = findRenderable(t.renderer as never, "InputRenderable");
  expect((input as { focused: boolean }).focused).toBe(true);

  await t.mockMouse.click(3, 3);
  await t.flush();
  expect((input as { focused: boolean }).focused).toBe(true);
});
