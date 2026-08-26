/**
 * How to spawn the Rocky CLI from a test, on whichever runtime is running it.
 *
 * `process.execPath` is not enough. Under `bun --bun` the name `node` on PATH
 * is a shim for Bun itself, so asking for Node gets Bun anyway — and Bun cannot
 * load tsx's ESM loader, which is how the Node path executes TypeScript.
 *
 * Rather than fight that, the child runs on the same runtime as the suite. That
 * is also the more useful test: the Bun job exists to say what Bun breaks, and
 * a child forced back onto Node would answer a question nobody asked.
 */
export const tsxLoader = import.meta.resolve("tsx");

const runningUnderBun = Boolean(process.versions["bun"]);

/** The command and leading arguments that execute a TypeScript entry point. */
export function cliCommand(entry: string, args: readonly string[]): [string, string[]] {
  // Bun executes TypeScript directly; Node needs the loader.
  return runningUnderBun
    ? ["bun", [entry, ...args]]
    : [process.execPath, ["--import", tsxLoader, entry, ...args]];
}
