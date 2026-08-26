/**
 * Client entry point. Mounts the app against a caller-supplied port.
 *
 * The host owns session construction, so this module stays free of any harness
 * import and can be mounted against a fake port in tests.
 */
import { render } from "@opentui/solid";
import type { SessionPort } from "@rocky/contract";
import type { JSX } from "solid-js";
import { App } from "./App.js";

export { App } from "./App.js";
export * from "./model/transcript.js";
export { createSessionStore } from "./session-store.js";

export interface MountOptions {
  onQuit?: (() => void) | undefined;
  /**
   * Renderer injection point. Exists so the mount lifetime can be tested
   * without a terminal — the bug this guards against is invisible to any test
   * that renders the component directly.
   */
  renderApp?: ((node: () => JSX.Element) => Promise<void>) | undefined;
}

export async function mountRockyClient(port: SessionPort, options: MountOptions = {}): Promise<void> {
  // `render` resolves once the app is MOUNTED, not when the TUI exits. It must
  // therefore not be the caller's signal to tear the session down: doing so
  // unsubscribes the event stream out from under a UI that is still running,
  // and the transcript then never updates while prompts appear to succeed.
  // Stay pending until the user actually quits.
  let signalQuit!: () => void;
  const untilQuit = new Promise<void>((resolve) => {
    signalQuit = resolve;
  });

  // The renderer's built-in Ctrl+C exits the process directly, which would skip
  // session teardown. The app handles Ctrl+C instead and calls onQuit before
  // destroying the renderer.
  const node = () => (
    <App
      port={port}
      onQuit={() => {
        options.onQuit?.();
        signalQuit();
      }}
    />
  );

  if (options.renderApp) {
    await options.renderApp(node);
  } else {
    await render(node, { exitOnCtrlC: false, targetFps: 30 });
  }

  await untilQuit;
}
