/**
 * Launches Rocky's OpenTUI client. Bun-only.
 *
 * Ordering here is load-bearing and fails silently if broken: the Solid
 * transform plugin must be registered *before* any `.tsx` module is evaluated,
 * so the client is reached through a dynamic import that runs after the
 * preload. Static imports would be hoisted above it, and the symptom would be a
 * frozen first frame rather than an error.
 */
import { applyRockyProcessIdentity } from "../runtime/pi-runtime.js";
import { createRockySessionPort } from "./create-session-port.js";

export async function runRockyClient(options: { cwd?: string } = {}): Promise<void> {
  // Checked before the runtime, because it is the more fundamental
  // precondition: no terminal means the client cannot work on any runtime,
  // whereas the Bun requirement is specific to the renderer.
  //
  // Refused rather than attempted. The renderer takes the terminal over on
  // start-up, so without one it writes an alternate-screen escape sequence into
  // whatever the stream actually is and then waits for input that can never
  // arrive — a pipe, a log file, or a CI step hangs indefinitely instead of
  // failing. Once `rocky` routes by argv this is also the backstop for a
  // mis-routed non-interactive invocation.
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      'The Rocky client needs an interactive terminal. For non-interactive use, run `rocky -p "…"` or `rocky --mode json`.',
    );
  }

  if (!process.versions["bun"]) {
    throw new Error(
      "The Rocky client requires Bun: OpenTUI's native renderer has no FFI backend on this Node build. Run `bun run client`.",
    );
  }

  // Before the session exists: these reach every bash subprocess the agent runs.
  applyRockyProcessIdentity();

  // Specifiers are held in variables so the Node typecheck/build does not try to
  // resolve them: the preload has no Node type declarations, and the client
  // entry is .tsx, which the root program has no `jsx` setting for. Both resolve
  // fine at run time, which only ever happens under Bun.
  const preloadSpecifier = "@opentui/solid/preload";
  const clientSpecifier = "@jakeryderv/rocky-client";

  // Registers babel-preset-solid. Must precede the client import below.
  await import(preloadSpecifier);

  const { port, dispose } = await createRockySessionPort(options);
  let disposed = false;
  const disposeOnce = () => {
    if (!disposed) {
      disposed = true;
      // Disposing the runtime is async (it emits `session_shutdown` to
      // extensions first), but every caller here is a teardown path with
      // nothing left to await it. Failures are reported rather than swallowed
      // into an unhandled rejection.
      void Promise.resolve(dispose()).catch((error: unknown) => {
        process.stderr.write(`rocky: session teardown failed: ${String(error)}\n`);
      });
    }
  };

  // A signal can still arrive when the terminal is not in raw mode (the app
  // handles Ctrl+C itself once it is), so tear down on those too.
  const onSignal = () => {
    disposeOnce();
    process.exit(0);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    const client = (await import(clientSpecifier)) as {
      mountRockyClient: (port: unknown, options?: { onQuit?: () => void }) => Promise<void>;
    };
    await client.mountRockyClient(port, { onQuit: disposeOnce });
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    disposeOnce();
  }
}
