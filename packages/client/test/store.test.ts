/**
 * Session store behaviour, driven by a fake port.
 *
 * State reaches the client as a pushed `state_changed`, not by polling
 * `get_state` on turn boundaries. The regression these guard against is a store
 * that looks correct in-process — where a refresh round-trip is free — and goes
 * stale the moment a transport sits between the client and the core.
 */
import { expect, test } from "bun:test";
import type { CommandResult, SessionCommand, SessionEvent, SessionPort, SessionState } from "@rocky/contract";
import { createSessionStore } from "../src/session-store.js";

const BASE_STATE: SessionState = {
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
  isBashRunning: false,
};

function fakePort(options: { deferInitialState?: boolean } = {}) {
  let listener: ((event: SessionEvent) => void) | undefined;
  const sent: SessionCommand[] = [];
  let releaseInitialState = () => {};
  const initialStateGate = new Promise<void>((resolve) => {
    releaseInitialState = resolve;
  });
  const port: SessionPort = {
    subscribe: (fn) => {
      listener = fn;
      return () => {
        listener = undefined;
      };
    },
    execute: async (command): Promise<CommandResult> => {
      sent.push(command);
      if (command.type === "get_theme") {
        return {
          type: "command_result",
          command: "get_theme",
          ok: true,
          theme: { name: "dark", colors: { text: "#e5e5e7", muted: "#7a7a7a" } },
        };
      }
      if (command.type === "get_messages") {
        return {
          type: "command_result",
          command: "get_messages",
          ok: true,
          messages: [{ role: "user", content: [{ type: "text", text: "resumed history" }], timestamp: 1 }],
        };
      }
      if (command.type === "get_commands") {
        return {
          type: "command_result",
          command: "get_commands",
          ok: true,
          commands: [{ name: "compact", source: "extension" }],
        };
      }
      if (command.type === "get_state") {
        if (options.deferInitialState) {
          await initialStateGate;
        }
        return { type: "command_result", command: "get_state", ok: true, state: BASE_STATE };
      }
      return { type: "command_result", command: command.type as never, ok: true };
    },
  };
  return { port, sent, releaseInitialState, emit: (event: SessionEvent) => listener?.(event) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("takes state from the push rather than polling on turn boundaries", async () => {
  const { port, sent, emit } = fakePort();
  const store = createSessionStore(port);
  await settle();

  emit({ type: "turn_start" });
  emit({ type: "state_changed", state: { ...BASE_STATE, isStreaming: true, thinkingLevel: "high" } });
  emit({ type: "turn_end", stopReason: "stop" });
  emit({ type: "settled" });
  await settle();

  expect(store.state()?.thinkingLevel).toBe("high");
  expect(store.state()?.isStreaming).toBe(true);
  // One cold-start snapshot, and nothing else.
  expect(sent.filter((command) => command.type === "get_state")).toHaveLength(1);
  store.dispose();
});

test("issues no get_state after a command", async () => {
  const { port, sent } = fakePort();
  const store = createSessionStore(port);
  await settle();
  await store.submit("hello");

  expect(sent.map((command) => command.type)).toEqual(["get_state", "get_commands", "get_theme", "prompt"]);
  store.dispose();
});

test("loads slash commands at startup and re-reads them when the agent settles", async () => {
  const { port, sent, emit } = fakePort();
  const store = createSessionStore(port);
  await settle();

  expect(store.commands().map((command) => command.name)).toEqual(["compact"]);

  // Extensions register commands asynchronously and the resource loader
  // reloads, so a list captured once at startup goes stale within the session.
  emit({ type: "settled" });
  await settle();
  expect(sent.filter((command) => command.type === "get_commands")).toHaveLength(2);
  store.dispose();
});

test("keeps a pushed state that overtook the cold-start snapshot", async () => {
  const { port, emit, releaseInitialState } = fakePort({ deferInitialState: true });
  const store = createSessionStore(port);

  emit({ type: "state_changed", state: { ...BASE_STATE, messageCount: 7 } });
  releaseInitialState();
  await settle();

  expect(store.state()?.messageCount).toBe(7);
  store.dispose();
});

test("surfaces a failed command as transcript error", async () => {
  const port: SessionPort = {
    subscribe: () => () => {},
    execute: async (): Promise<CommandResult> => ({
      type: "command_result",
      command: "prompt",
      ok: false,
      error: "provider unavailable",
    }),
  };
  const store = createSessionStore(port);
  await store.submit("hi");
  expect(store.transcript().error).toBe("provider unavailable");
  store.dispose();
});

// The transcript belongs to the session that was just replaced; a resumed
// session already has history the client has never seen.
test("rebuilds the transcript from history when the session is switched", async () => {
  const { port, emit } = fakePort();
  const store = createSessionStore(port);
  await settle();

  emit({ type: "message_start", role: "user" });
  emit({ type: "message_delta", delta: { type: "text_delta", index: 0, text: "old" } });
  expect(store.transcript().entries).toHaveLength(1);

  emit({ type: "session_switched", state: { ...BASE_STATE, sessionId: "s2" } });
  await settle();

  expect(store.state()?.sessionId).toBe("s2");
  expect(store.transcript().entries).toHaveLength(1);
  expect(store.transcript().entries[0]?.blocks[0]).toEqual({ kind: "text", text: "resumed history" });
  store.dispose();
});

// The palette is needed for the first frame, not when a picker opens.
test("loads the theme at startup and repaints when it changes elsewhere", async () => {
  const { port, emit } = fakePort();
  const store = createSessionStore(port);
  await settle();
  expect(store.theme()?.name).toBe("dark");

  emit({ type: "theme_changed", theme: { name: "light", colors: { text: "#000000" } } });
  expect(store.theme()?.name).toBe("light");
  store.dispose();
});
