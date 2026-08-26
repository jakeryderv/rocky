/**
 * Headless render tests, driven by a fake port.
 *
 * These prove the client toolchain is actually reactive — the failure mode
 * `babel-preset-solid` protects against is a silent frozen first frame, not an
 * error — and they make no model call.
 */
import { expect, test } from "bun:test";
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
