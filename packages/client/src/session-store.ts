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

  // `state_changed` is declared in the contract but not yet emitted, so the
  // status line is refreshed after each event. Cheap in-process; this becomes a
  // subscription the moment the core pushes state.
  const refreshState = async () => {
    const result = await port.execute({ type: "get_state" });
    if (result.ok && result.command === "get_state") {
      setState(result.state);
    }
  };

  const unsubscribe = port.subscribe((event) => {
    setTranscript((current) => applyEvent(current, event));
    if (event.type === "turn_start" || event.type === "turn_end" || event.type === "settled") {
      void refreshState();
    }
  });

  void refreshState();

  const send = async (command: SessionCommand) => {
    const result = await port.execute(command);
    if (!result.ok) {
      setTranscript((current) => ({ ...current, error: result.error }));
    }
    await refreshState();
  };

  return {
    transcript,
    state,
    submit: (text: string) => send({ type: "prompt", text }),
    abort: () => send({ type: "abort" }),
    dispose: () => unsubscribe(),
  };
}
