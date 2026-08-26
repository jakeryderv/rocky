/**
 * Bridges a `SessionPort` to Solid reactive state.
 *
 * Knows nothing about the harness: give it any port — real or fake — and the
 * UI behaves identically. That is what makes the render tests meaningful
 * without a model call.
 */

import type {
  ForkPoint,
  ModelRef,
  QueueMode,
  SessionCommand,
  SessionPort,
  SessionState,
  SessionStats,
  SessionSummary,
  SlashCommand,
  ThemeSnapshot,
  ThinkingLevel,
} from "@rocky/contract";
import { createSignal } from "solid-js";
import {
  applyEvent,
  emptyTranscript,
  type TranscriptState,
  transcriptFromMessages,
} from "./model/transcript.js";

export interface SessionStore {
  transcript: () => TranscriptState;
  state: () => SessionState | undefined;
  /** `/name` commands the core can run. Empty until the first load resolves. */
  commands: () => readonly SlashCommand[];
  /** Models the session can switch to. Loaded on demand, not at startup. */
  models: () => readonly ModelRef[];
  loadModels: () => Promise<void>;
  setModel: (model: ModelRef) => Promise<void>;
  /** Past sessions. Loaded on demand: listing reads every transcript on disk. */
  sessions: () => readonly SessionSummary[];
  loadSessions: () => Promise<void>;
  switchSession: (sessionId: string) => Promise<void>;
  newSession: () => Promise<void>;
  runBash: (command: string, excludeFromContext: boolean) => Promise<void>;
  abortBash: () => Promise<void>;
  /** Messages waiting to be released into the current turn, or after it. */
  queue: () => { steering: readonly string[]; followUp: readonly string[] };
  /** Queue a message into a turn that is already running. */
  steer: (text: string) => Promise<void>;
  followUp: (text: string) => Promise<void>;
  compact: (customInstructions?: string) => Promise<void>;
  setAutoCompaction: (enabled: boolean) => Promise<void>;
  setSteeringMode: (mode: QueueMode) => Promise<void>;
  setFollowUpMode: (mode: QueueMode) => Promise<void>;
  /** Points this session can be forked from. Loaded on demand. */
  forkPoints: () => readonly ForkPoint[];
  loadForkPoints: () => Promise<void>;
  fork: (entryId: string) => Promise<string | undefined>;
  clone: () => Promise<void>;
  exportHtml: (outputPath?: string) => Promise<void>;
  setSessionName: (name: string) => Promise<void>;
  stats: () => SessionStats | undefined;
  loadStats: () => Promise<void>;
  /** A one-off line for the user: where an export went, what the stats are. */
  notice: () => string | undefined;
  clearNotice: () => void;
  /** The active theme, and the names a client can switch to. */
  theme: () => ThemeSnapshot | undefined;
  themeNames: () => readonly string[];
  loadThemes: () => Promise<void>;
  setTheme: (name: string) => Promise<void>;
  setThinkingLevel: (level: ThinkingLevel) => Promise<void>;
  submit: (text: string) => Promise<void>;
  abort: () => Promise<void>;
  dispose: () => void;
}

export function createSessionStore(port: SessionPort): SessionStore {
  const [transcript, setTranscript] = createSignal<TranscriptState>(emptyTranscript());
  const [state, setState] = createSignal<SessionState | undefined>(undefined);
  const [commands, setCommands] = createSignal<readonly SlashCommand[]>([]);
  const [models, setModels] = createSignal<readonly ModelRef[]>([]);
  const [sessions, setSessions] = createSignal<readonly SessionSummary[]>([]);
  const [queue, setQueue] = createSignal<{ steering: readonly string[]; followUp: readonly string[] }>({
    steering: [],
    followUp: [],
  });
  const [forkPoints, setForkPoints] = createSignal<readonly ForkPoint[]>([]);
  const [stats, setStats] = createSignal<SessionStats | undefined>(undefined);
  const [notice, setNotice] = createSignal<string | undefined>(undefined);
  const [theme, setTheme] = createSignal<ThemeSnapshot | undefined>(undefined);
  const [themeNames, setThemeNames] = createSignal<readonly string[]>([]);

  // State arrives as a push. The one `get_state` below is the cold-start
  // snapshot only: without it a client that connects mid-session would render
  // an empty status line until something happened to change state.
  const loadInitialState = async () => {
    const result = await port.execute({ type: "get_state" });
    if (result.ok && result.command === "get_state") {
      setState((current) => current ?? result.state);
    }
  };

  /**
   * Replace the transcript with the history of the session now in play.
   *
   * A resumed session already has messages; without this the client would show
   * an empty transcript over a conversation the core can still see.
   */
  const adoptSession = async (next: SessionState) => {
    setState(next);
    setTranscript(emptyTranscript());
    const result = await port.execute({ type: "get_messages" });
    if (result.ok && result.command === "get_messages") {
      setTranscript(transcriptFromMessages(result.messages));
    }
    await loadCommands();
  };

  const unsubscribe = port.subscribe((event) => {
    if (event.type === "session_switched") {
      void adoptSession(event.state);
      return;
    }
    setTranscript((current) => applyEvent(current, event));
    if (event.type === "state_changed") {
      setState(event.state);
    }
    if (event.type === "theme_changed") {
      setTheme(event.theme);
    }
    if (event.type === "queue_update") {
      setQueue({ steering: event.steering, followUp: event.followUp });
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

  const loadTheme = async () => {
    const result = await port.execute({ type: "get_theme" });
    if (result.ok && result.command === "get_theme") {
      setTheme(result.theme);
    }
  };

  void loadInitialState();
  void loadCommands();
  // At startup rather than on demand: the palette is needed for the first
  // frame, not when a picker opens.
  void loadTheme();

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

  // On demand: listing reads every transcript on disk, and most sessions never
  // open the picker.
  const loadSessions = async () => {
    const result = await port.execute({ type: "list_sessions" });
    if (result.ok && result.command === "list_sessions") {
      setSessions(result.sessions);
    } else if (!result.ok) {
      setTranscript((current) => ({ ...current, error: result.error }));
    }
  };

  const loadForkPoints = async () => {
    const result = await port.execute({ type: "get_fork_points" });
    if (result.ok && result.command === "get_fork_points") {
      setForkPoints(result.points);
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
    sessions,
    loadSessions,
    switchSession: (sessionId: string) => send({ type: "switch_session", sessionId }),
    queue,
    steer: (text: string) => send({ type: "steer", text }),
    followUp: (text: string) => send({ type: "follow_up", text }),
    compact: (customInstructions?: string) =>
      send({
        type: "compact",
        ...(customInstructions ? { customInstructions } : {}),
      }),
    setAutoCompaction: (enabled: boolean) => send({ type: "set_auto_compaction", enabled }),
    setSteeringMode: (mode: QueueMode) => send({ type: "set_steering_mode", mode }),
    setFollowUpMode: (mode: QueueMode) => send({ type: "set_follow_up_mode", mode }),
    forkPoints,
    loadForkPoints,
    // Returns the forked-from text so the client can put it back in the editor,
    // which is what makes "fork before this message" mean "edit and retry".
    fork: async (entryId: string) => {
      const result = await port.execute({ type: "fork", entryId, position: "before" });
      if (!result.ok) {
        setTranscript((current) => ({ ...current, error: result.error }));
        return undefined;
      }
      return result.command === "fork" && !result.cancelled ? result.text : undefined;
    },
    clone: () => send({ type: "clone" }),
    exportHtml: async (outputPath?: string) => {
      const result = await port.execute({
        type: "export_html",
        ...(outputPath ? { outputPath } : {}),
      });
      if (!result.ok) {
        setTranscript((current) => ({ ...current, error: result.error }));
        return;
      }
      if (result.command === "export_html") {
        setNotice(`exported to ${result.path}`);
      }
    },
    setSessionName: (name: string) => send({ type: "set_session_name", name }),
    stats,
    loadStats: async () => {
      const result = await port.execute({ type: "get_session_stats" });
      if (result.ok && result.command === "get_session_stats") {
        setStats(result.stats);
        setNotice(undefined);
      } else if (!result.ok) {
        setTranscript((current) => ({ ...current, error: result.error }));
      }
    },
    notice,
    clearNotice: () => setNotice(undefined),
    theme,
    themeNames,
    loadThemes: async () => {
      const result = await port.execute({ type: "get_themes" });
      if (result.ok && result.command === "get_themes") {
        setThemeNames(result.themes);
      } else if (!result.ok) {
        setTranscript((current) => ({ ...current, error: result.error }));
      }
    },
    setTheme: (name: string) => send({ type: "set_theme", name }),
    setThinkingLevel: (level: ThinkingLevel) => send({ type: "set_thinking_level", level }),
    runBash: (command: string, excludeFromContext: boolean) =>
      send({ type: "bash", command, ...(excludeFromContext ? { excludeFromContext: true } : {}) }),
    abortBash: () => send({ type: "abort_bash" }),
    newSession: () => send({ type: "new_session" }),
    setModel: (model: ModelRef) => send({ type: "set_model", provider: model.provider, modelId: model.id }),
    submit: (text: string) => send({ type: "prompt", text }),
    abort: () => send({ type: "abort" }),
    dispose: () => unsubscribe(),
  };
}
