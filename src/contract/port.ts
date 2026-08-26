/**
 * The seam a client talks to.
 *
 * A client depends on this interface and the contract types — never on the
 * adapter, the harness, or a session object. That is what makes "the client
 * consumes only the contract" a fact rather than an intention: a client can be
 * driven entirely by a fake port in tests, and a future transport (a socket, a
 * worker, a remote process) can implement the same two methods without any
 * client change, because every value crossing it is serializable.
 */
import type { CommandResult, SessionCommand, SessionEvent } from "./types.js";

export interface SessionPort {
  /** Observe session events. Returns an unsubscribe function. */
  subscribe(listener: (event: SessionEvent) => void): () => void;
  /** Issue a command. Never rejects: failures arrive as `ok: false`. */
  execute(command: SessionCommand): Promise<CommandResult>;
}
