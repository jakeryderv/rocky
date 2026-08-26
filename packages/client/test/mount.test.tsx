/**
 * Mount lifetime.
 *
 * `render` resolves when the app is mounted, not when the TUI exits. Treating
 * it as the exit signal made the host dispose the session immediately: the UI
 * kept running and accepting input, prompts still returned ok, and no event
 * ever reached the transcript again. No component-level test can see this,
 * because the bug lives in the composition around the component.
 */
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import type { CommandResult, SessionCommand, SessionPort } from "@rocky/contract";
import { mountRockyClient } from "../src/index.js";

function idlePort(): SessionPort {
  return {
    subscribe: () => () => {},
    execute: async (command: SessionCommand): Promise<CommandResult> => {
      // The fake has to answer the data-bearing commands for real: a result
      // that claims `ok` while omitting its payload is not a shape the contract
      // permits, and faking one only tests the client against a lie.
      if (command.type === "get_theme") {
        return {
          type: "command_result",
          command: "get_theme",
          ok: true,
          theme: { name: "dark", colors: {} },
        };
      }
      if (command.type === "get_themes") {
        return {
          type: "command_result",
          command: "get_themes",
          ok: true,
          themes: ["dark", "light"],
          active: "dark",
        };
      }
      if (command.type === "get_commands") {
        return { type: "command_result", command: "get_commands", ok: true, commands: [] };
      }
      if (command.type === "get_available_models") {
        return { type: "command_result", command: "get_available_models", ok: true, models: [] };
      }
      return command.type === "get_state"
        ? {
            type: "command_result",
            command: "get_state",
            ok: true,
            state: {
              sessionId: "s",
              cwd: "/w",
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
          }
        : { type: "command_result", command: command.type as never, ok: true };
    },
  };
}

test("stays pending after the app mounts, and resolves only on quit", async () => {
  let harness: Awaited<ReturnType<typeof testRender>> | undefined;
  let settled = false;

  // Mount for real, but through the seam, so `renderApp` resolves as soon as
  // the app is mounted — exactly what the real `render` does.
  const mounted = mountRockyClient(idlePort(), {
    renderApp: async (node) => {
      harness = await testRender(node as never, { width: 40, height: 10 });
      await harness.flush();
    },
  });
  void mounted.then(() => {
    settled = true;
  });

  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(harness).toBeDefined();
  expect(settled).toBe(false);

  await harness?.mockInput.pressKey("\x03");
  await mounted;
  expect(settled).toBe(true);
});

test("forwards quit to the host so the session is disposed", async () => {
  let hostQuits = 0;
  let harness: Awaited<ReturnType<typeof testRender>> | undefined;

  const mounted = mountRockyClient(idlePort(), {
    onQuit: () => {
      hostQuits += 1;
    },
    renderApp: async (node) => {
      harness = await testRender(node as never, { width: 40, height: 10 });
      await harness.flush();
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(hostQuits).toBe(0);

  await harness?.mockInput.pressKey("\x03");
  await mounted;
  expect(hostQuits).toBe(1);
});
