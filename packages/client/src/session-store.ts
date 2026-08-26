/**
 * Bridges a `SessionPort` to Solid reactive state.
 *
 * Knows nothing about the harness: give it any port — real or fake — and the
 * UI behaves identically. That is what makes the render tests meaningful
 * without a model call.
 */

import type { SessionCommand, SessionPort, SessionState } from "@rocky/contract";
import { createSignal } from "solid-js";
import { applyEvent, emptyTranscript, type TranscriptState } from "./model/transcript.js";

export interface SessionStore {
  transcript: () => TranscriptState;
  state: () => SessionState | undefined;
  submit: (text: string) => Promise<void>;
  abort: () => Promise<void>;
  dispose: () => void;
}

export function createSessionStore(port: SessionPort): SessionStore {
  const [transcript, setTranscript] = createSignal<TranscriptState>(emptyTranscript());
  const [state, setState] = createSignal<SessionState | undefined>(undefined);

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
  });

  void loadInitialState();

  const send = async (command: SessionCommand) => {
    const result = await port.execute(command);
    if (!result.ok) {
      setTranscript((current) => ({ ...current, error: result.error }));
    }
  };

  return {
    transcript,
    state,
    submit: (text: string) => send({ type: "prompt", text }),
    abort: () => send({ type: "abort" }),
    dispose: () => unsubscribe(),
  };
}
