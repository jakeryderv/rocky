/**
 * Launches Rocky's OpenTUI client. Bun-only.
 *
 * Ordering here is load-bearing and fails silently if broken: the Solid
 * transform plugin must be registered *before* any `.tsx` module is evaluated,
 * so the client is reached through a dynamic import that runs after the
 * preload. Static imports would be hoisted above it, and the symptom would be a
 * frozen first frame rather than an error.
 */
import { createRockySessionPort } from "./create-session-port.js";

export async function runRockyClient(options: { cwd?: string } = {}): Promise<void> {
  if (!process.versions["bun"]) {
    throw new Error(
      "The Rocky client requires Bun: OpenTUI's native renderer has no FFI backend on this Node build. Run `bun run client`.",
    );
  }

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
      dispose();
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
