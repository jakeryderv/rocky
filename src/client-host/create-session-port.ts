/**
 * Headless host: builds a real session and exposes it as a `SessionPort`.
 *
 * This is the only file that touches both the harness and the contract on the
 * client's behalf. The client itself receives a `SessionPort` and can be driven
 * entirely by a fake one, which is what keeps it honest about consuming only the
 * contract.
 */

import { PiAgentSessionAdapter } from "../adapter/pi-agent-session-adapter.js";
import type { SessionPort } from "../contract/index.js";
import {
  beginPrivateCreationMask,
  buildRockySessionOptions,
  ensurePrivateDirectory,
  loadPiRuntime,
} from "../runtime/pi-runtime.js";

export interface CreateSessionPortOptions {
  cwd?: string;
}

export interface SessionPortHandle {
  port: SessionPort;
  dispose(): void;
}

/**
 * Create a live session and wrap it in a contract port.
 *
 * Trust resolves through the harness's own `resolveProjectTrusted`, seeded with
 * Rocky's policy extensions, so the client host cannot diverge from the CLI on
 * discovery or trust. There is no interactive prompt here: a headless host has
 * no UI to ask with, so an undecided project resolves to untrusted.
 */
export async function createRockySessionPort(
  options: CreateSessionPortOptions = {},
): Promise<SessionPortHandle> {
  const cwd = options.cwd ?? process.cwd();
  const restoreCreationMask = beginPrivateCreationMask();
  let restored = false;
  const restoreOnce = () => {
    if (!restored) {
      restored = true;
      restoreCreationMask();
    }
  };

  try {
    const harness = await loadPiRuntime();
    const agentDir = harness.getAgentDir();
    ensurePrivateDirectory(agentDir);

    const trustStore = new harness.ProjectTrustStore(agentDir);
    const sessionOptions = buildRockySessionOptions({
      cwd,
      agentDir,
      restoreCreationMask: restoreOnce,
      resolveTrust: async ({ extensionsResult }) =>
        harness.resolveProjectTrusted({
          cwd,
          trustStore,
          ...(extensionsResult !== undefined ? { extensionsResult: extensionsResult as never } : {}),
          projectTrustContext: {
            // A headless host cannot prompt; refusing is the safe answer.
            ui: {
              select: async () => undefined,
              confirm: async () => false,
              input: async () => undefined,
            },
          } as never,
        }),
    });

    const services = await harness.createAgentSessionServices({
      cwd,
      agentDir,
      resourceLoaderOptions: sessionOptions.resourceLoaderOptions as never,
      resourceLoaderReloadOptions: sessionOptions.resourceLoaderReloadOptions as never,
    });
    // Default session directory; SessionManager.create resolves it from cwd.
    const sessionManager = harness.SessionManager.create(cwd);
    const { session } = await harness.createAgentSessionFromServices({
      services,
      sessionManager,
    } as never);

    const adapter = new PiAgentSessionAdapter(session as never, { cwd });
    adapter.start();
    restoreOnce();

    return {
      port: {
        subscribe: (listener) => adapter.subscribe(listener),
        execute: (command) => adapter.execute(command),
      },
      dispose: () => adapter.dispose(),
    };
  } finally {
    restoreOnce();
  }
}
