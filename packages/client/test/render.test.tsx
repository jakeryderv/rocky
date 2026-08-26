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
            isBashRunning: false,
          },
        };
      }
      if (command.type === "get_fork_points") {
        return {
          type: "command_result",
          command: "get_fork_points",
          ok: true,
          points: [
            { entryId: "e1", text: "explain this repo" },
            { entryId: "e2", text: "why does the build fail" },
          ],
        };
      }
      if (command.type === "fork") {
        return {
          type: "command_result",
          command: "fork",
          ok: true,
          cancelled: false,
          text: "explain this repo",
        };
      }
      if (command.type === "export_html") {
        return { type: "command_result", command: "export_html", ok: true, path: "/work/session.html" };
      }
      if (command.type === "get_session_stats") {
        return {
          type: "command_result",
          command: "get_session_stats",
          ok: true,
          stats: {
            sessionId: "s1",
            userMessages: 2,
            assistantMessages: 2,
            toolCalls: 1,
            toolResults: 1,
            totalMessages: 6,
            tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
            cost: 0.0042,
            contextTokens: 75,
            contextWindow: 300,
          },
        };
      }
      if (command.type === "list_sessions") {
        return {
          type: "command_result",
          command: "list_sessions",
          ok: true,
          sessions: [
            {
              id: "older",
              cwd: "/work",
              createdAt: 1,
              modifiedAt: 1,
              messageCount: 3,
              preview: "why does the build fail",
            },
            {
              id: "newer",
              name: "contract work",
              cwd: "/work",
              createdAt: 2,
              modifiedAt: 2,
              messageCount: 9,
              preview: "add get_commands",
            },
          ],
        };
      }
      if (command.type === "get_messages") {
        return { type: "command_result", command: "get_messages", ok: true, messages: [] };
      }
      if (command.type === "get_available_models") {
        return {
          type: "command_result",
          command: "get_available_models",
          ok: true,
          models: [
            { provider: "openai-codex", id: "gpt-5.5", displayName: "GPT-5.5" },
            { provider: "anthropic", id: "claude-opus-5" },
          ],
        };
      }
      if (command.type === "get_commands") {
        return {
          type: "command_result",
          command: "get_commands",
          ok: true,
          commands: [
            { name: "compact", description: "Compact the conversation", source: "extension" },
            { name: "copy", source: "extension" },
            { name: "explain", source: "prompt", argumentHint: "<path>" },
          ],
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

  const input = findRenderable(t.renderer as never, "TextareaRenderable");
  expect((input as { focused: boolean }).focused).toBe(true);

  await t.mockMouse.click(3, 3);
  await t.flush();
  expect((input as { focused: boolean }).focused).toBe(true);
});

// Neither review caught that the client could not be exited, because nothing
// tried to leave. These tests do.
test("ctrl+c quits when idle and disposes the session", async () => {
  const { port } = fakePort();
  let quits = 0;
  const t = await testRender(() => <App port={port} onQuit={() => (quits += 1)} />, {
    width: 40,
    height: 10,
  });
  await t.flush();

  await t.mockInput.pressKey("\x03");
  await t.flush();

  expect(quits).toBe(1);
});

// A long turn must not be endable by accident.
test("ctrl+c aborts instead of quitting while a turn is streaming", async () => {
  const { port, emit, sent } = fakePort();
  let quits = 0;
  const t = await testRender(() => <App port={port} onQuit={() => (quits += 1)} />, {
    width: 40,
    height: 10,
  });
  await t.flush();

  emit({ type: "turn_start" });
  await t.flush();

  await t.mockInput.pressKey("\x03");
  await t.flush();

  expect(sent.some((command) => command.type === "abort")).toBe(true);
  expect(quits).toBe(0);
});

test("recalls a previous prompt with the up arrow", async () => {
  const { port } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 50, height: 10 });
  await t.flush();

  const input = findRenderable(t.renderer as never, "TextareaRenderable") as unknown as {
    plainText: string;
  };
  await t.mockInput.typeText("first prompt");
  t.mockInput.pressEnter();
  await t.flush();
  expect(input.plainText).toBe("");

  t.mockInput.pressArrow("up");
  await t.flush();
  expect(input.plainText).toBe("first prompt");

  t.mockInput.pressArrow("down");
  await t.flush();
  expect(input.plainText).toBe("");
});

// The arrows belong to the draft once it has more than one line: recalling
// history over a block halfway written would destroy it, with no undo across
// that boundary.
test("leaves the arrows to the editor once the draft is multi-line", async () => {
  const { port } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 50, height: 12 });
  await t.flush();

  const input = findRenderable(t.renderer as never, "TextareaRenderable") as unknown as {
    plainText: string;
  };
  await t.mockInput.typeText("first prompt");
  t.mockInput.pressEnter();
  await t.flush();

  await t.mockInput.pasteBracketedText("alpha\nbeta");
  await t.flush();
  expect(input.plainText).toBe("alpha\nbeta");

  t.mockInput.pressArrow("up");
  await t.flush();
  expect(input.plainText).toBe("alpha\nbeta");
});

// A pasted block is editable in place now, not held aside as a count.
test("keeps a multi-line paste editable and submits it whole", async () => {
  const { port, sent } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 50, height: 12 });
  await t.flush();

  await t.mockInput.pasteBracketedText("line one\nline two\nline three");
  await t.flush();
  const frame = t.captureCharFrame();
  expect(frame).toContain("line one");
  expect(frame).toContain("line three");

  t.mockInput.pressEnter();
  await t.flush();

  const prompt = sent.find((command) => command.type === "prompt") as { text: string } | undefined;
  expect(prompt?.text).toBe("line one\nline two\nline three");
});

// Enter sends; a newline is the deliberate act. Ctrl+J arrives as a bare
// linefeed, which is the one terminals essentially all report.
test("ctrl+j inserts a newline instead of submitting", async () => {
  const { port, sent } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 50, height: 12 });
  await t.flush();

  await t.mockInput.typeText("first line");
  t.mockInput.pressKey("\n");
  await t.mockInput.typeText("second line");
  await t.flush();

  expect(sent.filter((command) => command.type === "prompt")).toEqual([]);

  t.mockInput.pressEnter();
  await t.flush();
  const prompt = sent.find((command) => command.type === "prompt") as { text: string } | undefined;
  expect(prompt?.text).toBe("first line\nsecond line");
});

test("suggests commands while a slash token is being typed", async () => {
  const { port } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 70, height: 16 });
  await t.renderOnce();
  expect(t.captureCharFrame()).not.toContain("/compact");

  await t.mockInput.typeText("/co");
  await t.renderOnce();
  const frame = t.captureCharFrame();
  expect(frame).toContain("/compact");
  expect(frame).toContain("/copy");
  expect(frame).not.toContain("/explain");
});

// The popup closes on whitespace so the arrows go back to prompt history; a
// popup that stayed open would hijack them for the rest of the line.
test("closes the popup once arguments start", async () => {
  const { port } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 70, height: 16 });
  await t.renderOnce();

  await t.mockInput.typeText("/explain");
  await t.renderOnce();
  expect(t.captureCharFrame()).toContain("<path>");

  await t.mockInput.typeText(" ");
  await t.renderOnce();
  expect(t.captureCharFrame()).not.toContain("<path>");
});

test("tab accepts the selected suggestion", async () => {
  const { port, sent } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 70, height: 16 });
  await t.renderOnce();

  await t.mockInput.typeText("/co");
  await t.renderOnce();
  t.mockInput.pressArrow("down");
  await t.renderOnce();
  t.mockInput.pressTab();
  await t.renderOnce();

  expect(t.captureCharFrame()).toContain("/copy");
  t.mockInput.pressEnter();
  await t.renderOnce();
  // The trailing space is the point: arguments can follow it, and it is what
  // closes the popup rather than leaving it matching its own result.
  expect(sent.filter((command) => command.type === "prompt")).toEqual([{ type: "prompt", text: "/copy " }]);
});

// Enter must never be rewritten into an acceptance: a literal `/whatever`
// prompt has to be sendable with the popup open.
test("enter submits the typed text rather than the suggestion", async () => {
  const { port, sent } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 70, height: 16 });
  await t.renderOnce();

  await t.mockInput.typeText("/co");
  await t.renderOnce();
  t.mockInput.pressEnter();
  await t.renderOnce();

  expect(sent.filter((command) => command.type === "prompt")).toEqual([{ type: "prompt", text: "/co" }]);
});

test("offers /model even though the core never lists it", async () => {
  const { port } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 70, height: 16 });
  await t.renderOnce();

  await t.mockInput.typeText("/mod");
  await t.renderOnce();
  expect(t.captureCharFrame()).toContain("/model");
});

test("opens the model picker and switches the active model", async () => {
  const { port, sent } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 70, height: 16 });
  await t.renderOnce();

  await t.mockInput.typeText("/model");
  t.mockInput.pressEnter();
  await t.renderOnce();
  await t.renderOnce();
  const frame = t.captureCharFrame();
  expect(frame).toContain("openai-codex/gpt-5.5");
  expect(frame).toContain("anthropic/claude-opus-5");
  // The command opened a picker; it was never sent to the core as a prompt.
  expect(sent.filter((command) => command.type === "prompt")).toEqual([]);

  t.mockInput.pressArrow("down");
  await t.renderOnce();
  t.mockInput.pressEnter();
  await t.renderOnce();

  expect(sent.filter((command) => command.type === "set_model")).toEqual([
    { type: "set_model", provider: "anthropic", modelId: "claude-opus-5" },
  ]);
  // Picking closes the picker and hands the input back.
  expect(t.captureCharFrame()).not.toContain("Select a model");
});

// Escape never reaches the key handler, so without ctrl+c the only way out of
// the picker would be to pick something.
test("ctrl+c closes the picker instead of quitting", async () => {
  const { port, sent } = fakePort();
  let quits = 0;
  const t = await testRender(() => <App port={port} onQuit={() => (quits += 1)} />, {
    width: 70,
    height: 16,
  });
  await t.renderOnce();

  await t.mockInput.typeText("/model");
  t.mockInput.pressEnter();
  await t.renderOnce();
  await t.renderOnce();
  expect(t.captureCharFrame()).toContain("Select a model");

  t.mockInput.pressCtrlC();
  await t.renderOnce();
  expect(t.captureCharFrame()).not.toContain("Select a model");
  expect(quits).toBe(0);
  expect(sent.filter((command) => command.type === "set_model")).toEqual([]);
});

test("filters the picker as the user types", async () => {
  const { port } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 70, height: 16 });
  await t.renderOnce();

  await t.mockInput.typeText("/model");
  t.mockInput.pressEnter();
  await t.renderOnce();
  await t.renderOnce();

  await t.mockInput.typeText("opus");
  await t.renderOnce();
  const frame = t.captureCharFrame();
  expect(frame).toContain("anthropic/claude-opus-5");
  // The status line still names the active model, so assert on the picker row's
  // own display name rather than on the label it shares with the status line.
  expect(frame).not.toContain("GPT-5.5");
});

test("resumes a session from the picker, newest first", async () => {
  const { port, sent } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 70, height: 16 });
  await t.renderOnce();

  await t.mockInput.typeText("/resume");
  t.mockInput.pressEnter();
  await t.renderOnce();
  await t.renderOnce();

  const frame = t.captureCharFrame();
  expect(frame).toContain("contract work");
  expect(frame).toContain("why does the build fail");
  expect(sent.filter((command) => command.type === "prompt")).toEqual([]);

  // The most recently touched session is selected first, which is the one a
  // resume almost always wants.
  t.mockInput.pressEnter();
  await t.renderOnce();
  expect(sent.filter((command) => command.type === "switch_session")).toEqual([
    { type: "switch_session", sessionId: "newer" },
  ]);
});

test("filters sessions by what was said in them", async () => {
  const { port } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 70, height: 16 });
  await t.renderOnce();

  await t.mockInput.typeText("/resume");
  t.mockInput.pressEnter();
  await t.renderOnce();
  await t.renderOnce();

  await t.mockInput.typeText("build");
  await t.renderOnce();
  const frame = t.captureCharFrame();
  expect(frame).toContain("why does the build fail");
  expect(frame).not.toContain("contract work");
});

test("/new starts a session without opening a picker", async () => {
  const { port, sent } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 70, height: 16 });
  await t.renderOnce();

  await t.mockInput.typeText("/new");
  t.mockInput.pressEnter();
  await t.renderOnce();

  expect(sent.filter((command) => command.type === "new_session")).toHaveLength(1);
  expect(sent.filter((command) => command.type === "prompt")).toEqual([]);
  expect(t.captureCharFrame()).not.toContain("Resume a session");
});

// The transcript belongs to the session that was just replaced. Keeping it
// would show one conversation's history over another's.
test("rebuilds the transcript when the core switches session", async () => {
  const { port, emit } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 70, height: 16 });
  await t.renderOnce();

  emit({ type: "message_start", role: "user" });
  emit({ type: "message_delta", delta: { type: "text_delta", index: 0, text: "OLD HISTORY" } });
  await t.renderOnce();
  expect(t.captureCharFrame()).toContain("OLD HISTORY");

  emit({
    type: "session_switched",
    state: {
      sessionId: "s2",
      cwd: "/work",
      thinkingLevel: "medium",
      isStreaming: false,
      isCompacting: false,
      steeringMode: "all",
      followUpMode: "all",
      autoCompactionEnabled: true,
      messageCount: 0,
      pendingMessageCount: 0,
      isBashRunning: false,
    },
  });
  await t.renderOnce();
  await t.renderOnce();
  expect(t.captureCharFrame()).not.toContain("OLD HISTORY");
});

test("runs a shell command typed with a bang and shows its output", async () => {
  const { port, sent, emit } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 70, height: 16 });
  await t.renderOnce();

  await t.mockInput.typeText("!npm test");
  t.mockInput.pressEnter();
  await t.renderOnce();

  expect(sent.filter((command) => command.type === "prompt")).toEqual([]);
  expect(sent.filter((command) => command.type === "bash")).toEqual([{ type: "bash", command: "npm test" }]);

  emit({ type: "bash_start", command: "npm test" });
  emit({ type: "bash_output", delta: "263 passed\n" });
  await t.renderOnce();
  const frame = t.captureCharFrame();
  expect(frame).toContain("npm test");
  expect(frame).toContain("263 passed");
});

// The inherited TUI's convention; the two front ends must not disagree.
test("keeps a double-bang command out of the model's context", async () => {
  const { port, sent } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 70, height: 16 });
  await t.renderOnce();

  await t.mockInput.typeText("!!git log");
  t.mockInput.pressEnter();
  await t.renderOnce();

  expect(sent.filter((command) => command.type === "bash")).toEqual([
    { type: "bash", command: "git log", excludeFromContext: true },
  ]);
});

// A running shell command is the most immediate thing ctrl+c can be aimed at.
test("ctrl+c cancels a running shell command before anything else", async () => {
  const { port, sent, emit } = fakePort();
  let quits = 0;
  const t = await testRender(() => <App port={port} onQuit={() => (quits += 1)} />, {
    width: 70,
    height: 16,
  });
  await t.renderOnce();

  emit({
    type: "state_changed",
    state: {
      sessionId: "s1",
      cwd: "/work",
      thinkingLevel: "medium",
      isStreaming: false,
      isCompacting: false,
      steeringMode: "all",
      followUpMode: "all",
      autoCompactionEnabled: true,
      messageCount: 0,
      pendingMessageCount: 0,
      isBashRunning: true,
    },
  });
  await t.renderOnce();

  t.mockInput.pressCtrlC();
  await t.renderOnce();

  expect(sent.filter((command) => command.type === "abort_bash")).toHaveLength(1);
  expect(sent.filter((command) => command.type === "abort")).toEqual([]);
  expect(quits).toBe(0);
});

// A turn that is already running cannot take a prompt — the core rejects one
// outright. Typing during a turn means steering it.
test("steers a running turn instead of erroring", async () => {
  const { port, sent, emit } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 70, height: 16 });
  await t.renderOnce();

  emit({ type: "turn_start" });
  await t.renderOnce();

  await t.mockInput.typeText("actually use the other file");
  t.mockInput.pressEnter();
  await t.renderOnce();

  expect(sent.filter((command) => command.type === "prompt")).toEqual([]);
  expect(sent.filter((command) => command.type === "steer")).toEqual([
    { type: "steer", text: "actually use the other file" },
  ]);
});

test("still runs a slash or shell command while a turn is streaming", async () => {
  const { port, sent, emit } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 70, height: 16 });
  await t.renderOnce();
  emit({ type: "turn_start" });
  await t.renderOnce();

  await t.mockInput.typeText("!ls");
  t.mockInput.pressEnter();
  await t.renderOnce();

  expect(sent.filter((command) => command.type === "bash")).toHaveLength(1);
  expect(sent.filter((command) => command.type === "steer")).toEqual([]);
});

test("shows what is waiting in the queues", async () => {
  const { port, emit } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 70, height: 16 });
  await t.renderOnce();

  emit({ type: "queue_update", steering: ["use the other file"], followUp: ["then run the tests"] });
  await t.renderOnce();
  const frame = t.captureCharFrame();
  expect(frame).toContain("steer: use the other file");
  expect(frame).toContain("follow-up: then run the tests");

  emit({ type: "queue_update", steering: [], followUp: [] });
  await t.renderOnce();
  expect(t.captureCharFrame()).not.toContain("use the other file");
});

test("/compact passes custom instructions through", async () => {
  const { port, sent } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 70, height: 16 });
  await t.renderOnce();

  await t.mockInput.typeText("/compact keep the design decisions");
  t.mockInput.pressEnter();
  await t.renderOnce();

  expect(sent.filter((command) => command.type === "compact")).toEqual([
    { type: "compact", customInstructions: "keep the design decisions" },
  ]);
  expect(sent.filter((command) => command.type === "prompt")).toEqual([]);
});

test("/compact with no arguments compacts with the default instructions", async () => {
  const { port, sent } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 70, height: 16 });
  await t.renderOnce();

  await t.mockInput.typeText("/compact");
  t.mockInput.pressEnter();
  await t.renderOnce();

  expect(sent.filter((command) => command.type === "compact")).toEqual([{ type: "compact" }]);
});

test("the toggles flip the mode that is currently in effect", async () => {
  const { port, sent } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 70, height: 16 });
  await t.renderOnce();

  for (const [typed, expected] of [
    ["/autocompact", { type: "set_auto_compaction", enabled: false }],
    ["/steering", { type: "set_steering_mode", mode: "one-at-a-time" }],
    ["/followup", { type: "set_follow_up_mode", mode: "one-at-a-time" }],
  ] as const) {
    await t.mockInput.typeText(typed);
    t.mockInput.pressEnter();
    await t.renderOnce();
    expect(sent.at(-1)).toEqual(expected);
  }
});

// A status line that names every default says nothing.
test("names only the settings that differ from the default", async () => {
  const { port, emit } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 70, height: 16 });
  await t.renderOnce();
  expect(t.captureCharFrame()).not.toContain("auto-compact off");

  emit({
    type: "state_changed",
    state: {
      sessionId: "s1",
      cwd: "/work",
      thinkingLevel: "medium",
      isStreaming: false,
      isCompacting: true,
      steeringMode: "one-at-a-time",
      followUpMode: "all",
      autoCompactionEnabled: false,
      messageCount: 0,
      pendingMessageCount: 0,
      isBashRunning: false,
    },
  });
  await t.renderOnce();
  const frame = t.captureCharFrame();
  expect(frame).toContain("compacting");
  expect(frame).toContain("auto-compact off");
  expect(frame).toContain("steer one-at-a-time");
  expect(frame).not.toContain("follow-up one-at-a-time");
});

// "Fork from here" has to mean "edit this and try again": the core returns the
// message it forked before, and dropping it would leave the user retyping it.
test("forking puts the forked-from message back in the editor", async () => {
  const { port, sent } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 70, height: 16 });
  await t.renderOnce();

  await t.mockInput.typeText("/fork");
  t.mockInput.pressEnter();
  await t.renderOnce();
  await t.renderOnce();
  expect(t.captureCharFrame()).toContain("explain this repo");

  t.mockInput.pressEnter();
  await t.renderOnce();
  await t.renderOnce();

  expect(sent.filter((command) => command.type === "fork")).toEqual([
    { type: "fork", entryId: "e1", position: "before" },
  ]);
  const editor = findRenderable(t.renderer as never, "TextareaRenderable") as unknown as {
    plainText: string;
  };
  expect(editor.plainText).toBe("explain this repo");
});

test("/clone copies the session without opening a picker", async () => {
  const { port, sent } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 70, height: 16 });
  await t.renderOnce();

  await t.mockInput.typeText("/clone");
  t.mockInput.pressEnter();
  await t.renderOnce();

  expect(sent.filter((command) => command.type === "clone")).toHaveLength(1);
  expect(t.captureCharFrame()).not.toContain("Fork before a message");
});

test("/export reports where the file went", async () => {
  const { port, sent } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 70, height: 16 });
  await t.renderOnce();

  await t.mockInput.typeText("/export");
  t.mockInput.pressEnter();
  await t.renderOnce();
  await t.renderOnce();

  expect(sent.filter((command) => command.type === "export_html")).toEqual([{ type: "export_html" }]);
  expect(t.captureCharFrame()).toContain("/work/session.html");
});

test("/export takes a path", async () => {
  const { port, sent } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 70, height: 16 });
  await t.renderOnce();

  await t.mockInput.typeText("/export /tmp/out.html");
  t.mockInput.pressEnter();
  await t.renderOnce();

  expect(sent.filter((command) => command.type === "export_html")).toEqual([
    { type: "export_html", outputPath: "/tmp/out.html" },
  ]);
});

test("/name sets the session name, and does nothing without one", async () => {
  const { port, sent } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 70, height: 16 });
  await t.renderOnce();

  await t.mockInput.typeText("/name");
  t.mockInput.pressEnter();
  await t.renderOnce();
  expect(sent.filter((command) => command.type === "set_session_name")).toEqual([]);

  await t.mockInput.typeText("/name contract work");
  t.mockInput.pressEnter();
  await t.renderOnce();
  expect(sent.filter((command) => command.type === "set_session_name")).toEqual([
    { type: "set_session_name", name: "contract work" },
  ]);
});

test("/stats reports what the session has cost", async () => {
  const { port } = fakePort();
  const t = await testRender(() => <App port={port} />, { width: 70, height: 16 });
  await t.renderOnce();

  await t.mockInput.typeText("/stats");
  t.mockInput.pressEnter();
  await t.renderOnce();
  await t.renderOnce();

  const frame = t.captureCharFrame();
  expect(frame).toContain("6 messages");
  expect(frame).toContain("150 tokens");
  expect(frame).toContain("$0.0042");
  expect(frame).toContain("25%");
});
