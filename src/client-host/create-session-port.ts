/**
 * Headless host: builds a real session runtime and exposes it as a `SessionPort`.
 *
 * This is the only file that touches both the harness and the contract on the
 * client's behalf. The client itself receives a `SessionPort` and can be driven
 * entirely by a fake one, which is what keeps it honest about consuming only the
 * contract.
 *
 * It builds an `AgentSessionRuntime` rather than a bare session, because a
 * session cannot resume or replace itself: `switchSession` and `newSession`
 * live on the runtime, which tears the old session down and installs a new
 * object. Everything downstream therefore reads the live session through the
 * runtime rather than capturing it once.
 */

import { PiAgentSessionAdapter, type SessionLifecycle } from "../adapter/pi-agent-session-adapter.js";
import type { SessionPort } from "../contract/index.js";
import {
  beginPrivateCreationMask,
  buildRockySessionOptions,
  ensurePrivateDirectory,
  loadPiRuntime,
} from "../runtime/pi-runtime.js";
import { collectSlashCommands, type SlashCommandSources } from "./collect-slash-commands.js";

/** The slice of the model runtime provider listing needs. Structural, so it is testable. */
export interface ProviderDirectorySources {
  readonly modelRuntime?: {
    getProviders(): readonly {
      id: string;
      name?: string;
      auth?: {
        oauth?: { name?: string; loginLabel?: string; isSubscription?: boolean };
        apiKey?: { name?: string; login?: unknown };
      };
    }[];
    getProviderAuthStatus(id: string): { configured?: boolean; source?: string };
  };
}

/**
 * Describe every provider and how it can be logged into.
 *
 * The method list is derived from `provider.auth`, the way the inherited TUI's
 * own login selector does it — there is no static table to read. A provider
 * whose `apiKey` has no `login` is credential-from-the-environment only: it can
 * be authenticated but never logged into, so it reports no methods rather than
 * offering one that would fail.
 */
export function describeProviders(session: ProviderDirectorySources): Record<string, unknown>[] {
  const runtime = session.modelRuntime;
  if (!runtime) {
    return [];
  }
  const described: Record<string, unknown>[] = [];
  for (const provider of runtime.getProviders()) {
    const methods: string[] = [];
    if (provider.auth?.oauth) {
      methods.push("oauth");
    }
    if (provider.auth?.apiKey?.login) {
      methods.push("api_key");
    }
    let status: { configured?: boolean; source?: string } = {};
    try {
      status = runtime.getProviderAuthStatus(provider.id) ?? {};
    } catch {
      // A provider that cannot report its status is still worth listing.
    }
    described.push({
      id: provider.id,
      name: provider.name ?? provider.id,
      methods,
      authenticated: status.configured ?? false,
      ...(status.source !== undefined ? { source: status.source } : {}),
      ...(provider.auth?.oauth?.isSubscription ? { subscription: true } : {}),
      ...(provider.auth?.oauth?.loginLabel !== undefined
        ? { loginLabel: provider.auth.oauth.loginLabel }
        : {}),
    });
  }
  return described;
}

export interface CreateSessionPortOptions {
  cwd?: string;
}

export interface SessionPortHandle {
  port: SessionPort;
  dispose(): void | Promise<void>;
}

interface SessionInfoLike {
  id: string;
  path: string;
}

/**
 * Create a live session runtime and wrap it in a contract port.
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
    // Memoized per directory, the way the CLI does it: a switch into another
    // project re-runs the factory, and re-resolving trust each time would ask
    // the same unanswerable question again.
    const trustByCwd = new Map<string, boolean>();

    const createRuntime = async (input: {
      cwd: string;
      agentDir: string;
      sessionManager: unknown;
      sessionStartEvent?: unknown;
    }) => {
      const runtimeCwd = input.cwd;
      const sessionOptions = buildRockySessionOptions({
        cwd: runtimeCwd,
        agentDir: input.agentDir,
        restoreCreationMask: restoreOnce,
        resolveTrust: async ({ extensionsResult }) => {
          const cached = trustByCwd.get(runtimeCwd);
          if (cached !== undefined) {
            return cached;
          }
          const trusted = await harness.resolveProjectTrusted({
            cwd: runtimeCwd,
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
          });
          trustByCwd.set(runtimeCwd, trusted);
          return trusted;
        },
      });

      const services = await harness.createAgentSessionServices({
        cwd: runtimeCwd,
        agentDir: input.agentDir,
        resourceLoaderOptions: sessionOptions.resourceLoaderOptions as never,
        resourceLoaderReloadOptions: sessionOptions.resourceLoaderReloadOptions as never,
      });
      const created = await harness.createAgentSessionFromServices({
        services,
        sessionManager: input.sessionManager,
        // Threaded through so extensions see why the session changed. It is
        // undefined for the first runtime, which is how the harness recognizes
        // an initial start rather than a swap.
        sessionStartEvent: input.sessionStartEvent,
      } as never);
      return { ...created, services, diagnostics: services.diagnostics };
    };

    // Default session directory; SessionManager.create resolves it from cwd.
    const sessionManager = harness.SessionManager.create(cwd);
    const runtime = await harness.createAgentSessionRuntime(
      createRuntime as never,
      {
        cwd,
        agentDir,
        sessionManager,
      } as never,
    );

    const liveSession = () => (runtime as unknown as { session: unknown }).session;

    /**
     * Bind extensions to whichever session the runtime is now driving.
     *
     * Not optional and not cosmetic: `bindExtensions` is what emits
     * `session_start` and extends resources from extensions. Without it an
     * extension never boots — which was true of this host before it grew a
     * runtime, and would be true again for every session after a switch.
     */
    const bind = async () => {
      const session = liveSession() as {
        bindExtensions(bindings: unknown): Promise<void>;
      };
      await session.bindExtensions({
        mode: "rpc",
        commandContextActions: {
          waitForIdle: () => (liveSession() as { waitForIdle(): Promise<void> }).waitForIdle(),
          newSession: async (newSessionOptions: unknown) =>
            (runtime as unknown as { newSession(o?: unknown): Promise<{ cancelled: boolean }> }).newSession(
              newSessionOptions,
            ),
          fork: async (entryId: string, forkOptions: unknown) => {
            const result = await (
              runtime as unknown as {
                fork(id: string, o?: unknown): Promise<{ cancelled: boolean }>;
              }
            ).fork(entryId, forkOptions);
            return { cancelled: result.cancelled };
          },
          navigateTree: async (targetId: string, navigateOptions: unknown) => {
            const result = await (
              liveSession() as {
                navigateTree(id: string, o?: unknown): Promise<{ cancelled: boolean }>;
              }
            ).navigateTree(targetId, navigateOptions);
            return { cancelled: result.cancelled };
          },
          switchSession: async (sessionPath: string, switchOptions: unknown) =>
            (
              runtime as unknown as {
                switchSession(p: string, o?: unknown): Promise<{ cancelled: boolean }>;
              }
            ).switchSession(sessionPath, switchOptions),
          reload: async () => {
            await (liveSession() as { reload(): Promise<void> }).reload();
          },
        },
      });
    };

    // `list` reads every transcript in the directory, so the index is built
    // from whatever listing the client last asked for and refreshed only when
    // an id is not in it. A picker always lists before it switches.
    let sessionPaths = new Map<string, string>();

    const listSessions = async (): Promise<readonly SessionInfoLike[]> => {
      const manager = (liveSession() as { sessionManager: unknown }).sessionManager as {
        getCwd(): string;
        getSessionDir(): string;
      };
      const infos = (await harness.SessionManager.list(
        manager.getCwd(),
        manager.getSessionDir(),
      )) as unknown as SessionInfoLike[];
      sessionPaths = new Map(infos.map((info) => [info.id, info.path]));
      return infos;
    };

    const lifecycle: SessionLifecycle = {
      list: () => listSessions() as never,
      switchTo: async (sessionId: string) => {
        if (!sessionPaths.has(sessionId)) {
          await listSessions();
        }
        const path = sessionPaths.get(sessionId);
        if (path === undefined) {
          throw new Error(`Unknown session: ${sessionId}`);
        }
        // A session recorded against a directory that no longer exists makes
        // the harness ask for a replacement cwd. A headless host has nothing to
        // ask with, so the failure is reported rather than guessed at.
        return (
          runtime as unknown as { switchSession(p: string): Promise<{ cancelled: boolean }> }
        ).switchSession(path);
      },
      create: async () =>
        (runtime as unknown as { newSession(): Promise<{ cancelled: boolean }> }).newSession(),
      fork: async (entryId: string, position: "before" | "at") =>
        (
          runtime as unknown as {
            fork(
              id: string,
              options: { position: "before" | "at" },
            ): Promise<{ cancelled: boolean; selectedText?: string }>;
          }
        ).fork(entryId, { position }),
      current: () => liveSession() as never,
    };

    // `getAvailableSnapshot` is what the harness's own RPC mode reads for both
    // listing and resolving, so the client host cannot diverge from it on which
    // models exist or on which object `setModel` is given. Read through the
    // runtime: a switch replaces `services.modelRuntime` too.
    const availableModels = () =>
      (
        liveSession() as { modelRuntime?: { getAvailableSnapshot(): readonly unknown[] } }
      ).modelRuntime?.getAvailableSnapshot() ?? [];

    const adapter = new PiAgentSessionAdapter(liveSession() as never, {
      cwd,
      // Read on every call rather than snapshotted: extensions register
      // commands asynchronously, the resource loader reloads, and a switch
      // replaces the session outright.
      listCommands: () => collectSlashCommands(liveSession() as unknown as SlashCommandSources),
      listModels: () => availableModels() as readonly { provider: string; id: string }[],
      lookupModel: (provider, modelId) =>
        (availableModels() as readonly { provider: string; id: string }[]).find(
          (model) => model.provider === provider && model.id === modelId,
        ),
      sessions: lifecycle,
      // Authentication lives on the model runtime, not on the session, and the
      // harness's own login is already headless: it drives everything through
      // the `prompt`/`notify` callbacks the adapter supplies. The pi-tui login
      // dialog is only one implementation of those two callbacks.
      auth: {
        list: () => describeProviders(liveSession() as never),
        login: async (provider, method, interaction) => {
          await (
            liveSession() as {
              modelRuntime: {
                login(id: string, type: string, interaction: unknown): Promise<unknown>;
              };
            }
          ).modelRuntime.login(provider, method, interaction);
        },
        logout: async (provider) => {
          await (
            liveSession() as { modelRuntime: { logout(id: string): Promise<void> } }
          ).modelRuntime.logout(provider);
        },
      },
      // Themes come from the core's settings, so a change here is a change for
      // `rocky` too — one theme choice, not one per front end.
      themes: {
        list: () => harness.getAvailableThemes(),
        // The setting is unset until someone chooses a theme, and the core
        // then paints with its default — so reporting "" would leave the
        // picker unable to mark what is actually in use.
        active: () =>
          (
            liveSession() as { settingsManager?: { getTheme(): string | undefined } }
          ).settingsManager?.getTheme() ?? harness.getDefaultTheme(),
        resolve: (name?: string) => harness.getResolvedThemeColors(name),
        set: (name: string) => {
          (liveSession() as { settingsManager?: { setTheme(name: string): void } }).settingsManager?.setTheme(
            name,
          );
        },
      },
    });

    // The runtime also swaps sessions on its own — an extension can call
    // `switchSession` — so rebinding is registered rather than only done after
    // a client command.
    (runtime as unknown as { setRebindSession(fn: () => Promise<void>): void }).setRebindSession(async () => {
      await bind();
      // The runtime fires this for extension-initiated swaps too, which no
      // command result would account for. Retargeting here rather than only
      // after a client command is what keeps those from silently detaching
      // the event stream.
      adapter.retarget();
    });
    await bind();
    adapter.start();
    restoreOnce();

    return {
      port: {
        subscribe: (listener) => adapter.subscribe(listener),
        execute: (command) => adapter.execute(command),
      },
      dispose: async () => {
        adapter.dispose();
        await (runtime as unknown as { dispose(): Promise<void> }).dispose();
      },
    };
  } finally {
    restoreOnce();
  }
}
