# Roadmap and carried debt

Status snapshot as of 2026-08-22 (post ADR 0003 fork integration). Decisions live in
[`docs/decisions/`](decisions/); this file tracks sequencing and known debt. Update it when items land or
priorities change.

## Done

- Context-file discovery enabled; skills stay Rocky-only (ADR 0002).
- Bun compatibility spike for Pi 0.84.2 (results recorded in ADR 0003).
- `packages/harness`: source fork of `pi-coding-agent` v0.84.2, standalone, Rocky-branded, self-update and
  managed downloads removed, undici gated under Bun; fork suite green (1853 passed / 49 skipped).
- Root CLI runs on the fork; `PI_PACKAGE_DIR` bridge and all runtime-rewriting workarounds deleted.

## Next (in order)

1. **Rocky contract** — headless, client-agnostic session contract (serializable commands/events/state, no
   Pi types leaking) with a `PiAgentSessionAdapter` over the fork's `AgentSession`. Enforce mechanically:
   contract modules import nothing from `@earendil-works/*`; fixtures survive JSON/`structuredClone`
   round-trips in tests.
2. **OpenTUI + Solid client on Bun** — the first Rocky-owned TUI, consuming only the contract. Keep the
   inherited `InteractiveMode` reachable (e.g. `rocky --classic`) until the new client covers daily use, then
   delete `modes/interactive` from the fork and drop the `pi-tui` dependency.
3. **Bun toolchain migration** — move install/lockfile/CI/bin to Bun once the client work makes Bun the
   actual runtime (`bun install`, lockfile pinning discipline equivalent to npm-shrinkwrap, CI image, test
   runner decision for root vs harness suites).
4. **Longer term** — see [`project-idea-outline.md`](project-idea-outline.md): multi-subagent experimentation
   (isolated workspaces, pinned factors, repeatable scoring) once baseline behavior is stable; a process/RPC
   boundary only when a concrete need appears (web client, remote execution, daemon, sandbox isolation).

## Carried debt

- **Live provider streaming under Bun is unverified** — no provider credentials were configured at spike
  time. Before Bun becomes the shipped default runtime: `/login`, then run one `--print` prompt and an
  abort/steer under `bun`, including the pi-ai SSE path. (ADR 0003 flags this as verification debt.)
- **3 harness test files excluded** (`custom-editor-history-keybindings`, `interactive-tui`,
  `interactive-mode-status`): they import pi-tui's `VirtualTerminal`/`test-themes` helpers, which the npm
  package does not ship. Vendor those helpers into `packages/harness/test/` to recover them — or drop the
  tests with `modes/interactive` when the OpenTUI client replaces the inherited TUI.
- **Toolchain still npm/Node** — intentional until step 3; the `rocky` bin shebang is `node`, CI runs Node 24.
  Bun-run is validated by smoke but not the default.
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
