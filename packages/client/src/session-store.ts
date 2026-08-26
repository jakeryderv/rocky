/**
 * Bridges a `SessionPort` to Solid reactive state.
 *
 * Knows nothing about the harness: give it any port — real or fake — and the
 * UI behaves identically. That is what makes the render tests meaningful
 * without a model call.
 */

import type { ModelRef, SessionCommand, SessionPort, SessionState, SlashCommand } from "@rocky/contract";
import { createSignal } from "solid-js";
import { applyEvent, emptyTranscript, type TranscriptState } from "./model/transcript.js";

export interface SessionStore {
  transcript: () => TranscriptState;
  state: () => SessionState | undefined;
  /** `/name` commands the core can run. Empty until the first load resolves. */
  commands: () => readonly SlashCommand[];
  /** Models the session can switch to. Loaded on demand, not at startup. */
  models: () => readonly ModelRef[];
  loadModels: () => Promise<void>;
  setModel: (model: ModelRef) => Promise<void>;
  submit: (text: string) => Promise<void>;
  abort: () => Promise<void>;
  dispose: () => void;
}

export function createSessionStore(port: SessionPort): SessionStore {
  const [transcript, setTranscript] = createSignal<TranscriptState>(emptyTranscript());
  const [state, setState] = createSignal<SessionState | undefined>(undefined);
  const [commands, setCommands] = createSignal<readonly SlashCommand[]>([]);
  const [models, setModels] = createSignal<readonly ModelRef[]>([]);

  // State arrives as a push. The one `get_state` below is the cold-start
  // snapshot only: without it a client that connects mid-session would render
  // an empty status line until something happened to change state.
  const loadInitialState = async () => {
    const result = await port.execute({ type: "get_state" });
    if (result.ok && result.command === "get_state") {
      setState((current) => current ?? result.state);
    }
  };

  const unsubscribe = port.subscribe((event) => {
    setTranscript((current) => applyEvent(current, event));
    if (event.type === "state_changed") {
      setState(event.state);
    }
    if (event.type === "settled") {
      void loadCommands();
    }
  });

  // Extensions register commands asynchronously and the resource loader
  // reloads, so this is re-read on `settled` rather than only at startup —
  // cheap, and bounded by turns rather than by events.
  const loadCommands = async () => {
    const result = await port.execute({ type: "get_commands" });
    if (result.ok && result.command === "get_commands") {
      setCommands(result.commands);
    }
  };

  void loadInitialState();
  void loadCommands();

  // On demand rather than at startup: the catalog costs a provider-availability
  // snapshot, and most sessions never open the picker.
  const loadModels = async () => {
    const result = await port.execute({ type: "get_available_models" });
    if (result.ok && result.command === "get_available_models") {
      setModels(result.models);
    } else if (!result.ok) {
      setTranscript((current) => ({ ...current, error: result.error }));
    }
  };

  const send = async (command: SessionCommand) => {
    const result = await port.execute(command);
    if (!result.ok) {
      setTranscript((current) => ({ ...current, error: result.error }));
    }
  };

  return {
    transcript,
    state,
    commands,
    models,
    loadModels,
    setModel: (model: ModelRef) => send({ type: "set_model", provider: model.provider, modelId: model.id }),
    submit: (text: string) => send({ type: "prompt", text }),
    abort: () => send({ type: "abort" }),
    dispose: () => unsubscribe(),
  };
}
