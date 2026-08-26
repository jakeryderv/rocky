/**
 * Bun-only client smoke, run from the repo root so no bunfig.toml preload is in
 * play. This is the one place that exercises what tui-entry.ts actually does:
 * register the Solid transform first, then resolve the client through its bare
 * specifier across the workspace symlink, then render a real frame.
 *
 * Every failure mode here is a silent frozen frame rather than an error, so the
 * assertions compare two frames rather than just checking that one exists.
 */
if (!process.versions.bun) {
  console.error("client-smoke requires Bun");
  process.exit(1);
}

await import("@opentui/solid/preload");

const { testRender } = await import("@opentui/solid");
const { App } = await import("@jakeryderv/rocky-client");

let listener;
const port = {
  subscribe: (fn) => {
    listener = fn;
    return () => {
      listener = undefined;
    };
  },
  execute: async (command) => {
    // The data-bearing commands have to be answered for real. A result that
    // claims `ok` while omitting its payload is not a shape the contract
    // permits, and the client is entitled to read the payload without guarding.
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
            sessionId: "smoke",
            cwd: process.cwd(),
            model: { provider: "smoke-provider", id: "smoke-model" },
            thinkingLevel: "medium",
            isStreaming: false,
            isCompacting: false,
            steeringMode: "all",
            followUpMode: "all",
            autoCompactionEnabled: true,
            messageCount: 0,
            pendingMessageCount: 0,
          },
        }
      : { type: "command_result", command: command.type, ok: true };
  },
};

const t = await testRender(() => App({ port }), { width: 70, height: 12 });
await t.renderOnce();
const first = t.captureCharFrame();
if (!first.includes("smoke-provider/smoke-model")) {
  throw new Error(`status line missing from first frame:\n${first}`);
}
if (first.includes("REACTIVE_OK")) {
  throw new Error("test string present before it was emitted");
}

listener?.({ type: "message_start", role: "assistant" });
listener?.({ type: "message_delta", delta: { type: "text_delta", index: 0, text: "REACTIVE_OK" } });
await t.renderOnce();
const second = t.captureCharFrame();
if (!second.includes("REACTIVE_OK")) {
  throw new Error(`client is not reactive — frame did not update:\n${second}`);
}

console.log("client smoke passed; renderer reactive under bun");
