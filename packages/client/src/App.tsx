/**
 * Rocky's terminal client: scrollable transcript, prompt input, status line.
 *
 * Receives a `SessionPort` and touches nothing else from Rocky, so it renders
 * identically against a real session and a fake one.
 */
import type { MouseEvent, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core";
import { defaultTextareaKeyBindings } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/solid";
import type { ModelRef, QueueMode, SessionPort, SessionSummary } from "@rocky/contract";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { mergeCommands, parseBashPrefix, routeSubmission } from "./model/commands.js";
import {
  applyCompletion,
  clampSelection,
  completionLabel,
  completionQuery,
  filterCommands,
  moveSelection,
} from "./model/completion.js";
import { editorRows, promptKeyBindings } from "./model/editor.js";
import { emptyHistory, newer, older, remember } from "./model/history.js";
import { filterModels, isActiveModel, modelLabel } from "./model/picker.js";
import { filterSessions, sessionLabel, sortSessions } from "./model/sessions.js";
import { entryLines } from "./model/transcript.js";
import { createSessionStore } from "./session-store.js";

/** One queued message, on one line. */
function queuedPreview(text: string, width = 60): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > width ? `${flat.slice(0, width - 1)}…` : flat;
}

const ROLE_PREFIX = { user: "›", assistant: "🅡", tool_result: "⚙", bash: "$" } as const;

export function App(props: { port: SessionPort; onQuit?: (() => void) | undefined }) {
  const store = createSessionStore(props.port);
  const [pinned, setPinned] = createSignal(true);
  const [history, setHistory] = createSignal(emptyHistory());
  const [draft, setDraft] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  // One signal rather than a flag per overlay: two booleans can disagree, and
  // "which overlay is open" is a single fact.
  const [overlay, setOverlay] = createSignal<"model" | "session" | undefined>(undefined);
  const [picked, setPicked] = createSignal(0);
  // Sampled when a picker opens rather than read during render: relative times
  // do not need to tick while the list is on screen, and a clock read inside
  // the render path would make every frame differ from the last.
  const [now, setNow] = createSignal(0);
  let scroller: ScrollBoxRenderable | undefined;
  let editor: TextareaRenderable | undefined;
  const renderer = useRenderer();

  /** Quit: tear the renderer down so the terminal is left usable. */
  const quit = () => {
    props.onQuit?.();
    renderer.destroy();
  };

  const showInInput = (text: string) => {
    if (editor) {
      editor.editBuffer.setText(text);
      // setText leaves the cursor where it was, which lands mid-word when the
      // new text is shorter than the old one.
      editor.cursorOffset = text.length;
    }
    // Mirrored rather than read back off the renderable: the completion popup
    // has to react to programmatic edits (history, accepting a suggestion) as
    // well as to typing, and only typing raises a content change.
    setDraft(text);
  };

  /**
   * Suggestions for what is currently typed.
   *
   * Empty whenever completion does not apply, which is also what "the popup is
   * closed" means — there is no separate open/closed flag to keep in sync.
   */
  const commands = createMemo(() => mergeCommands(store.commands()));

  const suggestions = createMemo(() => {
    if (overlay() !== undefined) {
      return [];
    }
    const query = completionQuery(draft());
    return query === undefined ? [] : filterCommands(commands(), query);
  });

  createEffect(() => setSelected((current) => clampSelection(current, suggestions().length)));

  /** While a picker is open the input is its filter, not a prompt. */
  const pickerModels = createMemo(() => (overlay() === "model" ? filterModels(store.models(), draft()) : []));

  const pickerSessions = createMemo(() =>
    overlay() === "session" ? sortSessions(filterSessions(store.sessions(), draft())) : [],
  );

  const pickerLength = () => (overlay() === "model" ? pickerModels().length : pickerSessions().length);

  createEffect(() => setPicked((current) => clampSelection(current, pickerLength())));

  const openPicker = (kind: "model" | "session") => {
    showInInput("");
    setPicked(0);
    setNow(Date.now());
    setOverlay(kind);
    void (kind === "model" ? store.loadModels() : store.loadSessions());
  };

  const closeOverlay = () => {
    setOverlay(undefined);
    showInInput("");
  };

  const chooseModel = (model: ModelRef | undefined) => {
    if (model) {
      void store.setModel(model);
    }
    closeOverlay();
  };

  const chooseSession = (session: SessionSummary | undefined) => {
    if (session) {
      void store.switchSession(session.id);
    }
    closeOverlay();
  };

  const acceptCompletion = () => {
    const command = suggestions()[selected()];
    if (!command) {
      return false;
    }
    showInInput(applyCompletion(command));
    return true;
  };

  /** The other side of `CLIENT_COMMANDS`: a command offered is a command run. */
  const runClientCommand = (name: string, args: string) => {
    const flip = (mode: QueueMode | undefined): QueueMode =>
      mode === "one-at-a-time" ? "all" : "one-at-a-time";
    switch (name) {
      case "model":
        openPicker("model");
        return;
      case "resume":
        openPicker("session");
        return;
      case "new":
        void store.newSession();
        return;
      case "compact":
        void store.compact(args.length > 0 ? args : undefined);
        return;
      case "autocompact":
        void store.setAutoCompaction(!(store.state()?.autoCompactionEnabled ?? true));
        return;
      case "steering":
        void store.setSteeringMode(flip(store.state()?.steeringMode));
        return;
      case "followup":
        void store.setFollowUpMode(flip(store.state()?.followUpMode));
        return;
    }
  };

  const submit = (text: string) => {
    if (overlay() === "model") {
      chooseModel(pickerModels()[picked()]);
      return;
    }
    if (overlay() === "session") {
      chooseSession(pickerSessions()[picked()]);
      return;
    }
    if (text.trim().length === 0) {
      return;
    }
    setHistory((current) => remember(current, text));
    // The editor keeps its text after submit; clear it so the next prompt
    // starts empty and history navigation has a known baseline.
    showInInput("");
    // A turn that is already running cannot take a prompt: the core rejects one
    // outright. Typing during a turn means steering it, which is why this
    // routes rather than erroring the way it used to.
    if (store.transcript().streaming && !text.startsWith("/") && !text.startsWith("!")) {
      void store.steer(text);
      return;
    }
    const bash = parseBashPrefix(text);
    if (bash) {
      void store.runBash(bash.command, bash.excludeFromContext);
      return;
    }
    const route = routeSubmission(text, commands());
    if (route.kind === "client") {
      // A client command never reaches the core, but it is still history: the
      // user typed it, and ↑ has to bring it back like anything else.
      runClientCommand(route.name, route.args);
      return;
    }
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

  useKeyboard((key) => {
    // Ctrl+C aborts a running turn, and quits when idle — the usual REPL
    // convention, and it means a long turn cannot be ended by accident.
    //
    // Escape is deliberately not used: it never reaches useKeyboard at all
    // (the key parser swallows it as an escape-sequence prefix), so a binding
    // on it would be silently dead.
    if (key.name === "c" && key.ctrl) {
      // Closing the overlay comes first. Escape never reaches this handler, so
      // without this precedence the only way out of the picker would be to
      // pick something — or to quit.
      if (overlay() !== undefined) {
        closeOverlay();
        return;
      }
      // A running shell command is the most immediate thing ctrl+c can be
      // aimed at, so it is cancelled before a turn is aborted.
      if (store.state()?.isBashRunning) {
        void store.abortBash();
      } else if (store.transcript().streaming) {
        void store.abort();
      } else {
        quit();
      }
      return;
    }
    // Tab accepts a suggestion; Enter deliberately does not. Enter always
    // submits what is on screen, so a literal `/whatever` prompt can be sent
    // while the popup is open instead of being silently rewritten.
    if (key.name === "tab" && suggestions().length > 0) {
      acceptCompletion();
      return;
    }
    if (key.name === "up" || key.name === "down") {
      if (overlay() !== undefined) {
        setPicked((current) => moveSelection(current, pickerLength(), key.name === "up" ? -1 : 1));
        return;
      }
      // While the popup is open the arrows drive it, not prompt history.
      if (suggestions().length > 0) {
        setSelected((current) => moveSelection(current, suggestions().length, key.name === "up" ? -1 : 1));
        return;
      }
      // A multi-line draft keeps the arrows for its own cursor. Recalling
      // history over a block the user is halfway through writing would destroy
      // it, and there is no undo across that boundary.
      const current = draft();
      if (current.includes("\n")) {
        return;
      }
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
      state?.model ? modelLabel(state.model) : "no model",
      state?.thinkingLevel ?? "-",
      store.transcript().streaming ? "streaming" : "idle",
    ];
    if (usage) {
      parts.push(`${usage.totalTokens} tok`);
    }
    if (state?.isCompacting) {
      parts.push("compacting");
    }
    // Only when off: the default is on, and a status line that names every
    // default says nothing.
    if (state && !state.autoCompactionEnabled) {
      parts.push("auto-compact off");
    }
    if (state && state.steeringMode !== "all") {
      parts.push(`steer ${state.steeringMode}`);
    }
    if (state && state.followUpMode !== "all") {
      parts.push(`follow-up ${state.followUpMode}`);
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

      <Show when={overlay() === "model"}>
        <box style={{ flexDirection: "column", flexShrink: 0 }}>
          <text fg="#888888">Select a model ↑↓ · enter selects · ctrl+c closes</text>
          <Show
            when={pickerModels().length > 0}
            fallback={
              <text fg="#888888"> {store.models().length === 0 ? "no models available" : "no match"}</text>
            }
          >
            <For each={pickerModels()}>
              {(model, index) => (
                <text fg={index() === picked() ? "#ffffff" : "#888888"}>
                  {index() === picked() ? "› " : "  "}
                  {isActiveModel(model, store.state()?.model) ? "* " : ""}
                  {modelLabel(model)}
                  {model.displayName ? ` — ${model.displayName}` : ""}
                </text>
              )}
            </For>
          </Show>
        </box>
      </Show>

      <Show when={store.queue().steering.length + store.queue().followUp.length > 0}>
        <box style={{ flexDirection: "column", flexShrink: 0 }}>
          <For
            each={[
              ...store.queue().steering.map((text) => ["steer", text] as const),
              ...store.queue().followUp.map((text) => ["follow-up", text] as const),
            ]}
          >
            {([kind, text]) => (
              <text fg="#888888">
                ⇥ {kind}: {queuedPreview(text)}
              </text>
            )}
          </For>
        </box>
      </Show>

      <Show when={overlay() === "session"}>
        <box style={{ flexDirection: "column", flexShrink: 0 }}>
          <text fg="#888888">Resume a session ↑↓ · enter resumes · ctrl+c closes</text>
          <Show
            when={pickerSessions().length > 0}
            fallback={
              <text fg="#888888">
                {"  "}
                {store.sessions().length === 0 ? "no sessions found" : "no match"}
              </text>
            }
          >
            <For each={pickerSessions()}>
              {(session, index) => (
                <text fg={index() === picked() ? "#ffffff" : "#888888"}>
                  {index() === picked() ? "› " : "  "}
                  {sessionLabel(session, now())}
                </text>
              )}
            </For>
          </Show>
        </box>
      </Show>

      <Show when={suggestions().length > 0}>
        <box style={{ flexDirection: "column", flexShrink: 0 }}>
          <For each={suggestions()}>
            {(command, index) => (
              <text fg={index() === selected() ? "#ffffff" : "#888888"}>
                {index() === selected() ? "› " : "  "}
                {completionLabel(command)}
                {command.description ? ` — ${command.description}` : ""}
              </text>
            )}
          </For>
        </box>
      </Show>

      <textarea
        ref={(element: TextareaRenderable) => {
          editor = element;
        }}
        focused
        keyBindings={promptKeyBindings(defaultTextareaKeyBindings)}
        placeholder={
          overlay() === "model"
            ? "Filter models…"
            : overlay() === "session"
              ? "Filter sessions…"
              : "Ask Rocky…   / commands · ! shell · shift+enter newline · ctrl+c aborts, or quits when idle"
        }
        // Grows with the draft rather than scrolling a one-row window, and
        // stops at a bound so a long paste cannot swallow the transcript.
        style={{ flexShrink: 0, height: editorRows(draft()) }}
        onContentChange={() => setDraft(editor?.plainText ?? "")}
        onSubmit={() => submit(editor?.plainText ?? "")}
      />
    </box>
  );
}
