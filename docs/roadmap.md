# Roadmap and carried debt

Status snapshot as of 2026-08-25 (contract slice landed; see ADR 0004). Decisions live in
[`docs/decisions/`](decisions/); this file tracks sequencing and known debt. Update it when items land or
priorities change.

## Done

- Context-file discovery enabled; skills stay Rocky-only (ADR 0002).
- Bun compatibility spike for Pi 0.84.2 (results recorded in ADR 0003).
- `packages/harness`: source fork of `pi-coding-agent` v0.84.2, standalone, Rocky-branded, self-update and
  managed downloads removed, undici gated under Bun; fork suite green (1853 passed / 49 skipped).
- Root CLI runs on the fork; `PI_PACKAGE_DIR` bridge and all runtime-rewriting workarounds deleted.
- **Live provider streaming verified under Bun** (ADR 0003's outstanding verification debt). Print mode, the
  JSON event stream, mid-stream SIGINT abort, and RPC steer all behave identically under Node 24 and Bun
  1.4.0 against a live `openai-codex` provider; streamed content matched exactly.
- **Session-file creation bug fixed.** Rocky's private-storage extension pre-created the session file, so the
  harness's exclusive-create (`wx`) flush failed with `EEXIST` on the first assistant message — every model
  turn crashed. Privacy now lives in the harness at the point of creation; the extension only covers
  directories and pre-existing files.
- **Harness test isolation.** The suite writes to a per-run temporary agent directory instead of the
  developer's real `~/.rocky/agent`, and strips inherited credential/cloud/proxy state like the root suite.
- **Rocky contract, first slice** (`src/contract/`) with `PiAgentSessionAdapter` (`src/adapter/`), derived
  from the harness RPC protocol rather than designed greenfield (ADR 0004). Isolation and JSON /
  `structuredClone` round-trips are enforced by tests.

- **Contract corrections from adversarial review.** Six mapping defects (tool-result rendering, `message_start`
  roles, missing delta block indices, ambiguous tool-call streaming, frozen usage, dropped error text) and one
  vacuous exhaustiveness test, all fixed with regression tests derived from upstream shapes. See ADR 0004.

- **First OpenTUI + Solid client slice** (`packages/client`) over a `SessionPort`, with a headless Bun render
  suite, a root-level client smoke, and a separate Bun CI job. See ADR 0005.

## Next (in order)

1. **Grow the client to daily use** — the first slice renders a streaming transcript (text, thinking, tool
   calls with results), a prompt input, abort on escape, and a status line; it is not yet a daily driver.
   Scrollback and incremental tool output have landed. Next, in rough order: a real editor (history,
   multi-line, paste), slash-command discovery (`get_commands` exists in the harness RPC protocol but not the
   contract), session list and resume, incremental tool output (`tool_execution_update` and
   `bash_execution_update` are dropped by the adapter today), and `state_changed` as a push so the client can
   stop polling `get_state`. Keep the inherited `InteractiveMode` as the default until the client covers daily
   use, then delete `modes/interactive` and drop `pi-tui`.

2. **Bun toolchain migration** — move install/lockfile/CI/bin to Bun once the client work makes Bun the
   actual runtime (`bun install`, lockfile pinning discipline equivalent to npm-shrinkwrap, CI image, test
   runner decision for root vs harness suites).
3. **Longer term** — see [`project-idea-outline.md`](project-idea-outline.md): multi-subagent experimentation
   (isolated workspaces, pinned factors, repeatable scoring) once baseline behavior is stable; a process/RPC
   boundary only when a concrete need appears (web client, remote execution, daemon, sandbox isolation).

## Carried debt

- **Undici dispatcher settings do not apply under Bun.** `configureHttpDispatcher()` returns early when
  `process.versions.bun` is set, so the socket-level HTTP idle timeout and undici's `EnvHttpProxyAgent` are
  not installed. Per-request timeouts still reach the provider SDK through `sdk.ts`, and Bun's native fetch
  reads `HTTP(S)_PROXY` itself, so the practical gap is narrow — but proxied requests under Bun have not been
  exercised. Revisit when Bun becomes the default runtime.
- **Model calls are unreachable from the test suite by policy**, which is what let the `EEXIST` session-flush
  bug reach every turn undetected: no test may make a model call, and nothing else creates a session file.
  The contract adapter narrows this (its mapping functions are pure and fully tested), but a scripted live
  smoke against a real provider remains manual.
- **3 harness test files excluded** (`custom-editor-history-keybindings`, `interactive-tui`,
  `interactive-mode-status`): they import pi-tui's `VirtualTerminal`/`test-themes` helpers, which the npm
  package does not ship. Vendor those helpers into `packages/harness/test/` to recover them — or drop the
  tests with `modes/interactive` when the OpenTUI client replaces the inherited TUI.
- **Toolchain still npm/Node** — intentional until step 3; the `rocky` bin shebang is `node`, CI runs Node 24.
  Bun-run is validated by smoke, by the live streaming/abort/steer checks, and by a live contract round-trip,
  but is not the default.
- **Harness `docs/` and `examples/` are upstream's** — still pi-worded; functionally accurate for inherited
  behavior (the system prompt points the model at them for app questions). Reword or replace incrementally as
  the corresponding behavior becomes Rocky-owned.
- **Kept-compat surfaces** (documented, revisit when they get in the way): `PI_*` env controls
  (`PI_OFFLINE`, `PI_TELEMETRY`, `PI_SESSION_*`, …), upstream extension virtual-import specifiers, the
  `pi.dev` model-catalog overlay (model updates depend on it until Rocky ships its own catalog), the `pi.dev`
  share-viewer default (`PI_SHARE_VIEWER_URL` overrides), and upstream repo links in the vendored changelog.
- **Packaging/publish story deferred** — `pack:check` was dropped from the gate; the workspace layout has no
  installable-artifact validation. Decide packaging (npm workspaces publish vs Bun-era distribution) during
  step 3.
- **Upstream cherry-picks are manual** — the harness no longer receives upstream updates; watch
  `earendil-works/pi` for security-relevant fixes and cherry-pick by hand. Upstream `pi-ai`/`pi-agent-core`
  upgrades remain normal pinned-dependency bumps and require rerunning both suites.
