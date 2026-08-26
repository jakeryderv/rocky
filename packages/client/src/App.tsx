/**
 * Rocky's terminal client: scrollable transcript, prompt input, status line.
 *
 * Receives a `SessionPort` and touches nothing else from Rocky, so it renders
 * identically against a real session and a fake one.
 */
import type { InputRenderable, MouseEvent, ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, usePaste, useRenderer } from "@opentui/solid";
import type { SessionPort } from "@rocky/contract";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { emptyHistory, newer, older, remember } from "./model/history.js";
import { entryLines } from "./model/transcript.js";
import { createSessionStore } from "./session-store.js";

const ROLE_PREFIX = { user: "›", assistant: "🅡", tool_result: "⚙" } as const;

export function App(props: { port: SessionPort; onQuit?: (() => void) | undefined }) {
  const store = createSessionStore(props.port);
  const [pinned, setPinned] = createSignal(true);
  const [history, setHistory] = createSignal(emptyHistory());
  const [pending, setPending] = createSignal<string[]>([]);
  let scroller: ScrollBoxRenderable | undefined;
  let input: InputRenderable | undefined;
  const renderer = useRenderer();

  /** Quit: tear the renderer down so the terminal is left usable. */
  const quit = () => {
    props.onQuit?.();
    renderer.destroy();
  };

  const showInInput = (text: string) => {
    if (input) {
      input.value = text;
    }
  };

  const submit = (value: string) => {
    // A multi-line paste is held aside and prepended on submit, because the
    // single-line input cannot represent the newlines itself.
    const held = pending();
    const text = held.length > 0 ? [...held, value].join("\n") : value;
    if (text.trim().length === 0) {
      return;
    }
    setPending([]);
    setHistory((current) => remember(current, text));
    // The input keeps its text after Enter; clear it so the next prompt starts
    // empty and history navigation has a known baseline.
    showInInput("");
    void store.submit(text);
  };

  // These handlers run during event dispatch, before scrollTop is updated, so
  // sampling directly would read the pre-scroll position.
  const resamplePinned = () => queueMicrotask(() => setPinned(atBottom()));

  const atBottom = () => {
    if (!scroller) {
      return true;
    }
    return scroller.scrollTop >= scroller.scrollHeight - scroller.viewport.height - 1;
  };

  // There is no scroll event on ScrollBoxRenderable, so re-sample the geometry
  // whenever the transcript changes.
  createEffect(() => {
    store.transcript().entries;
    setPinned(atBottom());
  });

  usePaste((event) => {
    const text = new TextDecoder().decode(event.bytes).replace(/\r\n?/g, "\n");
    const lines = text.split("\n");
    if (lines.length <= 1) {
      // A single-line paste is just typing; let the input handle it.
      return;
    }
    event.preventDefault();
    // Keep every line but the last; the last stays editable in the input.
    setPending((current) => [...current, ...lines.slice(0, -1)]);
    showInInput(`${input?.value ?? ""}${lines.at(-1) ?? ""}`);
  });

  useKeyboard((key) => {
    // Ctrl+C aborts a running turn, and quits when idle — the usual REPL
    // convention, and it means a long turn cannot be ended by accident.
    //
    // Escape is deliberately not used: it never reaches useKeyboard at all
    // (the key parser swallows it as an escape-sequence prefix), so a binding
    // on it would be silently dead.
    if (key.name === "c" && key.ctrl) {
      if (store.transcript().streaming) {
        void store.abort();
      } else {
        quit();
      }
      return;
    }
    if (key.name === "up" || key.name === "down") {
      const current = input?.value ?? "";
      const move = key.name === "up" ? older(history(), current) : newer(history(), current);
      setHistory(move.state);
      if (move.text !== undefined) {
        showInInput(move.text);
      }
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
      <scrollbox
        ref={(element: ScrollBoxRenderable) => {
          scroller = element;
          // Must be cleared before anything can focus it: blur() early-returns
          // when a renderable is not focusable, so a scrollbox that gets focused
          // first can never hand focus back to the input.
          element.focusable = false;
        }}
        stickyScroll
        // stickyScroll alone pins to the TOP, because scrollTop starts at 0.
        stickyStart="bottom"
        // flexBasis: 0 is required. With flexGrow alone the box claims one row
        // too many, painting over the status line and losing the newest entry.
        style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0, padding: 1 }}
        // The handler runs during event dispatch, before scrollTop is updated,
        // so sampling here directly would read the pre-scroll position.
        onMouseScroll={(_event: MouseEvent) => resamplePinned()}
        // Dragging the scrollbar thumb is a drag, not a scroll event.
        onMouseDrag={(_event: MouseEvent) => resamplePinned()}
        onMouseUp={(_event: MouseEvent) => resamplePinned()}
      >
        {/*
          Iterate the entry objects themselves. The reducer preserves the
          identity of unchanged entries, and <For> keys by reference, so only
          the entry that actually changed is re-rendered. Mapping to fresh
          objects here (a memo returning {role, lines}) instead recreates every
          row on every event, which exhausts OpenTUI's native SyntaxStyle
          handles and kills the TUI a few hundred entries into a session.
        */}
        <For each={store.transcript().entries}>
          {(entry) => (
            <box style={{ flexDirection: "column", marginBottom: 1 }}>
              <For each={entryLines(entry, store.transcript().toolResults, store.transcript().toolProgress)}>
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
      </scrollbox>

      <Show when={!pinned()}>
        <text fg="#888888" style={{ flexShrink: 0 }}>
          ↓ more below
        </text>
      </Show>

      <Show when={store.transcript().error}>
        {(error: () => string) => (
          <text fg="#ff5555" style={{ flexShrink: 0 }}>
            ✖ {error()}
          </text>
        )}
      </Show>

      <text fg="#888888" style={{ flexShrink: 0 }}>
        {status()}
      </text>

      <Show when={pending().length > 0}>
        <text fg="#888888" style={{ flexShrink: 0 }}>
          + {pending().length} pasted line{pending().length === 1 ? "" : "s"}
        </text>
      </Show>

      <input
        ref={(element: InputRenderable) => {
          input = element;
        }}
        focused
        placeholder="Ask Rocky…   ↑ history · ctrl+c aborts, or quits when idle"
        style={{ flexShrink: 0 }}
        on:enter={(value: string) => submit(value)}
      />
    </box>
  );
}
