/**
 * Client entry point. Mounts the app against a caller-supplied port.
 *
 * The host owns session construction, so this module stays free of any harness
 * import and can be mounted against a fake port in tests.
 */
import { render } from "@opentui/solid";
import type { SessionPort } from "@rocky/contract";
import { App } from "./App.js";

export { App } from "./App.js";
export * from "./model/transcript.js";
export { createSessionStore } from "./session-store.js";

export async function mountRockyClient(
  port: SessionPort,
  options: { onQuit?: (() => void) | undefined } = {},
): Promise<void> {
  // The renderer's built-in Ctrl+C exits the process directly, which would skip
  // session teardown. The app handles Ctrl+C instead and calls onQuit before
  // destroying the renderer.
  await render(() => <App port={port} onQuit={options.onQuit} />, { exitOnCtrlC: false, targetFps: 30 });
}
