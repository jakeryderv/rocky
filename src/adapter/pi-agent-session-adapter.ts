/**
 * Adapter from the harness's `AgentSession` to Rocky's contract.
 *
 * Clients drive this with contract commands and consume contract events; they
 * never see an `AgentSession`, a `Model<Api>`, or any other Pi type. When Rocky
 * gains a process boundary, this adapter is what a transport wraps — the
 * contract shapes already survive serialization.
 */
import type {
  BashResult,
  CommandResult,
  ModelRef,
  SessionCommand,
  SessionEvent,
  SessionMessage,
  SessionState,
  SessionSummary,
  SlashCommand,
} from "../contract/index.js";
import {
  indexSessionsByPath,
  toModelRef,
  toSessionEvent,
  toSessionMessage,
  toSessionSummary,
  toSlashCommand,
  toThinkingLevel,
} from "./map-to-contract.js";

/**
 * The slice of `AgentSession` this adapter uses.
 *
 * Structural rather than nominal so the adapter is testable with a fake and
 * does not force the contract's consumers to resolve harness types.
 */
export interface AgentSessionLike {
  readonly sessionId: string;
  readonly sessionName?: string | undefined;
  readonly sessionFile?: string | undefined;
  readonly model?: { provider: string; id: string } | undefined;
  readonly thinkingLevel: string;
  readonly isStreaming: boolean;
  readonly isCompacting: boolean;
  readonly steeringMode: "all" | "one-at-a-time";
  readonly followUpMode: "all" | "one-at-a-time";
  readonly autoCompactionEnabled: boolean;
  readonly messages: readonly unknown[];
  readonly pendingMessageCount: number;
  readonly isBashRunning?: boolean;
  subscribe(listener: (event: unknown) => void): () => void;
  prompt(text: string, options?: { images?: unknown[] }): Promise<void>;
  steer(text: string, images?: unknown[]): Promise<void>;
  followUp(text: string, images?: unknown[]): Promise<void>;
  abort(): Promise<void>;
  setModel(model: unknown): Promise<void>;
  setThinkingLevel(level: string): void;
  setSteeringMode(mode: "all" | "one-at-a-time"): void;
  setFollowUpMode(mode: "all" | "one-at-a-time"): void;
  setAutoCompactionEnabled(enabled: boolean): void;
  compact(customInstructions?: string): Promise<unknown>;
  executeBash?(
    command: string,
    onChunk?: (chunk: string) => void,
    options?: { excludeFromContext?: boolean; id?: string },
  ): Promise<{
    output?: string;
    exitCode?: number;
    cancelled?: boolean;
    truncated?: boolean;
  }>;
  abortBash?(): void;
}

/** Resolves a provider/model id pair to the harness model object to activate. */
export type ModelLookup = (provider: string, modelId: string) => unknown | undefined;

/** Lists models the session could switch to. */
export type ModelCatalog = () => readonly { provider: string; id: string }[];

/**
 * Lists the `/name` commands the session can run.
 *
 * A callback rather than a session getter, because the harness never exposes
 * one: the merged list lives in a private closure and is reassembled from three
 * registries. The host that owns those registries supplies it, the same way it
 * supplies the model catalog.
 */
export type SlashCommandCatalog = () =>
  | readonly {
      name: string;
      description?: string | undefined;
      source: string;
      argumentHint?: string | undefined;
      sourceInfo?: { scope?: string; [key: string]: unknown } | undefined;
    }[]
  | undefined;

/**
 * Listing, resuming and starting sessions.
 *
 * The harness splits this across two objects: `SessionManager` knows what
 * sessions exist, and `AgentSessionRuntime` is what replaces the live one. The
 * adapter should not have to know that, so the host supplies one interface —
 * and `current()` is part of it because a switch replaces the session object
 * outright, which the adapter must re-point at and re-subscribe to.
 */
export interface SessionLifecycle {
  list(): Promise<readonly Record<string, unknown>[]> | readonly Record<string, unknown>[];
  switchTo(sessionId: string): Promise<{ cancelled: boolean }>;
  create(): Promise<{ cancelled: boolean }>;
  current(): AgentSessionLike;
}

export interface PiAgentSessionAdapterOptions {
  cwd: string;
  lookupModel?: ModelLookup;
  listModels?: ModelCatalog;
  listCommands?: SlashCommandCatalog;
  sessions?: SessionLifecycle;
}

export class PiAgentSessionAdapter {
  private session: AgentSessionLike;
  private readonly options: PiAgentSessionAdapterOptions;
  private readonly listeners = new Set<(value: SessionEvent) => void>();
  private unsubscribe: (() => void) | undefined;
  /**
   * Serialized last-published state, used to suppress no-op `state_changed`.
   *
   * The harness has no single "state changed" signal: state moves both through
   * session events and through synchronous setters that emit nothing at all
   * (`setThinkingLevel`, `setSteeringMode`, …). Diffing one projection after
   * every one of those paths is what makes the push complete, and comparing it
   * is what keeps a streaming turn from pushing an identical snapshot per delta.
   */
  private lastStateJson: string | undefined;

  constructor(session: AgentSessionLike, options: PiAgentSessionAdapterOptions) {
    this.session = session;
    this.options = options;
  }

  /** Begin translating session events. Returns a disposer. */
  start(): () => void {
    if (this.unsubscribe === undefined) {
      // Seed the baseline before any event can arrive, so the first push
      // reflects a real change rather than the session's opening state.
      this.lastStateJson = JSON.stringify(this.getState());
      this.unsubscribe = this.session.subscribe((event) => {
        const mapped = toSessionEvent(event as never);
        if (mapped) {
          this.emit(mapped);
        }
        // Unmapped harness events still move state, so this runs for every
        // event, not only translated ones.
        this.publishStateIfChanged();
      });
    }
    return () => this.dispose();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.lastStateJson = undefined;
    this.listeners.clear();
  }

  /**
   * Point at the session the runtime is now driving, and tell clients.
   *
   * Re-subscribing is not optional: a switch replaces the session object, and
   * the old subscription belongs to an object nothing drives any more — the
   * transcript would simply stop updating while commands kept succeeding.
   *
   * Public because a session can also be replaced without a command: an
   * extension can switch or fork one, and the host forwards that here.
   */
  retarget(): void {
    const next = this.options.sessions?.current();
    if (!next || next === this.session) {
      // Still worth republishing state: a new session has a new id even when
      // the object identity happens to be reused.
      this.publishSwitched();
      return;
    }
    const wasRunning = this.unsubscribe !== undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.session = next;
    if (wasRunning) {
      this.start();
    }
    this.publishSwitched();
  }

  private publishSwitched(): void {
    const state = this.getState();
    this.lastStateJson = JSON.stringify(state);
    this.emit({ type: "session_switched", state });
  }

  subscribe(listener: (event: SessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: SessionEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /**
   * Push `state_changed` when the projected state actually differs.
   *
   * Ordered after the event that caused the change so a client applies the
   * transcript update and the state update in the order they happened.
   */
  private publishStateIfChanged(): void {
    if (this.unsubscribe === undefined) {
      return;
    }
    const state = this.getState();
    const json = JSON.stringify(state);
    if (json === this.lastStateJson) {
      return;
    }
    this.lastStateJson = json;
    this.emit({ type: "state_changed", state });
  }

  getState(): SessionState {
    const session = this.session;
    const state: SessionState = {
      sessionId: session.sessionId,
      cwd: this.options.cwd,
      thinkingLevel: toThinkingLevel(session.thinkingLevel),
      isStreaming: session.isStreaming,
      isCompacting: session.isCompacting,
      steeringMode: session.steeringMode,
      followUpMode: session.followUpMode,
      autoCompactionEnabled: session.autoCompactionEnabled,
      messageCount: session.messages.length,
      pendingMessageCount: session.pendingMessageCount,
      isBashRunning: session.isBashRunning ?? false,
    };
    if (session.sessionName !== undefined) {
      state.sessionName = session.sessionName;
    }
    if (session.sessionFile !== undefined) {
      state.sessionFile = session.sessionFile;
    }
    const model = toModelRef(session.model as never);
    if (model !== undefined) {
      state.model = model;
    }
    return state;
  }

  getMessages(): SessionMessage[] {
    const messages: SessionMessage[] = [];
    for (const raw of this.session.messages) {
      const mapped = toSessionMessage(raw as never);
      if (mapped) {
        messages.push(mapped);
      }
    }
    return messages;
  }

  /**
   * Execute one contract command.
   *
   * Never throws: failures come back as `ok: false` results so a transport can
   * forward them verbatim and a client has exactly one error path.
   *
   * Publishes `state_changed` before resolving, because several commands mutate
   * state through synchronous setters the harness reports no event for.
   */
  async execute(command: SessionCommand): Promise<CommandResult> {
    const result = await this.runCommand(command);
    this.publishStateIfChanged();
    return result;
  }

  private async runCommand(command: SessionCommand): Promise<CommandResult> {
    const id = command.id;
    try {
      switch (command.type) {
        case "prompt":
          await this.session.prompt(command.text, command.images ? { images: command.images } : undefined);
          return { type: "command_result", id, command: "prompt", ok: true };
        case "steer":
          await this.session.steer(command.text, command.images);
          return { type: "command_result", id, command: "steer", ok: true };
        case "follow_up":
          await this.session.followUp(command.text, command.images);
          return { type: "command_result", id, command: "follow_up", ok: true };
        case "abort":
          await this.session.abort();
          return { type: "command_result", id, command: "abort", ok: true };
        case "get_state":
          return { type: "command_result", id, command: "get_state", ok: true, state: this.getState() };
        case "get_messages":
          return {
            type: "command_result",
            id,
            command: "get_messages",
            ok: true,
            messages: this.getMessages(),
          };
        case "get_available_models": {
          const models: ModelRef[] = [];
          for (const model of this.options.listModels?.() ?? []) {
            const ref = toModelRef(model as never);
            if (ref) {
              models.push(ref);
            }
          }
          return { type: "command_result", id, command: "get_available_models", ok: true, models };
        }
        case "get_commands": {
          const commands: SlashCommand[] = [];
          for (const command of this.options.listCommands?.() ?? []) {
            const mapped = toSlashCommand(command);
            if (mapped) {
              commands.push(mapped);
            }
          }
          return { type: "command_result", id, command: "get_commands", ok: true, commands };
        }
        case "list_sessions": {
          const lifecycle = this.options.sessions;
          if (!lifecycle) {
            return {
              type: "command_result",
              id,
              command: "list_sessions",
              ok: false,
              error: "This host cannot list sessions",
            };
          }
          const infos = await lifecycle.list();
          const parentIds = indexSessionsByPath(infos as never);
          const sessions: SessionSummary[] = infos.map((info) => toSessionSummary(info as never, parentIds));
          return { type: "command_result", id, command: "list_sessions", ok: true, sessions };
        }
        case "switch_session": {
          const lifecycle = this.options.sessions;
          if (!lifecycle) {
            return {
              type: "command_result",
              id,
              command: "switch_session",
              ok: false,
              error: "This host cannot switch sessions",
            };
          }
          const result = await lifecycle.switchTo(command.sessionId);
          if (!result.cancelled) {
            this.retarget();
          }
          // A cancelled switch is not a failure — an extension may veto one —
          // and the acknowledgement deliberately does not report it. The
          // `session_switched` event is the signal a client acts on, so a
          // client that never receives one simply keeps the session it had.
          return { type: "command_result", id, command: "switch_session", ok: true };
        }
        case "new_session": {
          const lifecycle = this.options.sessions;
          if (!lifecycle) {
            return {
              type: "command_result",
              id,
              command: "new_session",
              ok: false,
              error: "This host cannot start a new session",
            };
          }
          const result = await lifecycle.create();
          if (!result.cancelled) {
            this.retarget();
          }
          return { type: "command_result", id, command: "new_session", ok: true };
        }
        case "bash": {
          if (!this.session.executeBash) {
            return {
              type: "command_result",
              id,
              command: "bash",
              ok: false,
              error: "This session cannot run shell commands",
            };
          }
          // Start and end are emitted here rather than mapped, because the
          // harness reports only the output stream. Every client watching the
          // session needs the command text and the exit code, and a command
          // result reaches only the one that asked.
          this.emit({
            type: "bash_start",
            ...(id !== undefined ? { commandId: id } : {}),
            command: command.command,
          });
          const raw = await this.session.executeBash(command.command, undefined, {
            ...(command.excludeFromContext !== undefined
              ? { excludeFromContext: command.excludeFromContext }
              : {}),
            ...(id !== undefined ? { id } : {}),
          });
          const result: BashResult = {
            output: raw.output ?? "",
            ...(raw.exitCode !== undefined ? { exitCode: raw.exitCode } : {}),
            cancelled: raw.cancelled ?? false,
            truncated: raw.truncated ?? false,
          };
          this.emit({ type: "bash_end", ...(id !== undefined ? { commandId: id } : {}), result });
          return { type: "command_result", id, command: "bash", ok: true, result };
        }
        case "abort_bash":
          this.session.abortBash?.();
          return { type: "command_result", id, command: "abort_bash", ok: true };
        case "set_model": {
          const model = this.options.lookupModel?.(command.provider, command.modelId);
          if (model === undefined) {
            return {
              type: "command_result",
              id,
              command: "set_model",
              ok: false,
              error: `Unknown model: ${command.provider}/${command.modelId}`,
            };
          }
          await this.session.setModel(model);
          const ref = toModelRef(model as never);
          if (!ref) {
            return {
              type: "command_result",
              id,
              command: "set_model",
              ok: false,
              error: "Model is not describable",
            };
          }
          return { type: "command_result", id, command: "set_model", ok: true, model: ref };
        }
        case "set_thinking_level":
          this.session.setThinkingLevel(command.level);
          return { type: "command_result", id, command: "set_thinking_level", ok: true };
        case "set_steering_mode":
          this.session.setSteeringMode(command.mode);
          return { type: "command_result", id, command: "set_steering_mode", ok: true };
        case "set_follow_up_mode":
          this.session.setFollowUpMode(command.mode);
          return { type: "command_result", id, command: "set_follow_up_mode", ok: true };
        case "set_auto_compaction":
          this.session.setAutoCompactionEnabled(command.enabled);
          return { type: "command_result", id, command: "set_auto_compaction", ok: true };
        case "compact":
          await this.session.compact(command.customInstructions);
          return { type: "command_result", id, command: "compact", ok: true };
      }
    } catch (error) {
      return {
        type: "command_result",
        id,
        command: (command as { type: string }).type,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
