/**
 * Launcher for Rocky's OpenTUI client.
 *
 * A file rather than an inline `bun -e` so that failures surface as real errors
 * instead of an unhandled rejection, and so the preconditions (Bun, a TTY) are
 * reported in terms a person can act on.
 */
if (!process.versions.bun) {
  console.error("The Rocky client requires Bun. Run: npm run client");
  process.exit(1);
}

if (!process.stdout.isTTY) {
  console.error("The Rocky client needs an interactive terminal (stdout is not a TTY).");
  process.exit(1);
}

try {
  const { runRockyClient } = await import("../dist/client-host/tui-entry.js");
  await runRockyClient({ cwd: process.cwd() });
} catch (error) {
  console.error(`Rocky client failed to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
