/**
 * Rocky's terminal client, first slice: transcript, prompt input, status line.
 *
 * Receives a `SessionPort` and touches nothing else from Rocky, so it renders
 * identically against a real session and a fake one.
 */

import { useKeyboard } from "@opentui/solid";
import type { SessionPort } from "@rocky/contract";
import { createMemo, For, Show } from "solid-js";
import { entryLines } from "./model/transcript.js";
import { createSessionStore } from "./session-store.js";

const ROLE_PREFIX = { user: "›", assistant: "🅡", tool_result: "⚙" } as const;

export function App(props: { port: SessionPort }) {
  const store = createSessionStore(props.port);

  useKeyboard((key) => {
    // Escape aborts an in-flight turn; Ctrl+C is left to the host.
    if (key.name === "escape") {
      void store.abort();
    }
  });

  const status = createMemo(() => {
    const state = store.state();
    const usage = store.transcript().usage;
    const parts = [
      state?.model ? `${state.model.provider}/${state.model.id}` : "no model",
      state?.thinkingLevel ?? "-",
      store.transcript().streaming ? "streaming" : "idle",
    ];
    if (usage) {
      parts.push(`${usage.totalTokens} tok`);
    }
    return parts.join("  ·  ");
  });

  return (
    <box style={{ flexDirection: "column", height: "100%" }}>
      <box style={{ flexGrow: 1, flexDirection: "column", padding: 1 }}>
        <For each={store.transcript().entries}>
          {(entry) => (
            <box style={{ flexDirection: "column", marginBottom: 1 }}>
              <For each={entryLines(entry, store.transcript().toolResults)}>
                {(line, index) => (
                  <text>
                    {index() === 0 ? `${ROLE_PREFIX[entry.role]} ` : "  "}
                    {line}
                  </text>
                )}
              </For>
            </box>
          )}
        </For>
      </box>

      <Show when={store.transcript().error}>
        {(error: () => string) => <text fg="#ff5555">✖ {error()}</text>}
      </Show>

      <text fg="#888888">{status()}</text>

      <input
        focused
        placeholder="Ask Rocky…  (esc aborts)"
        on:enter={(value: string) => {
          if (value.trim().length > 0) {
            void store.submit(value);
          }
        }}
      />
    </box>
  );
}
