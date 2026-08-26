# Roadmap and carried debt

Status snapshot as of 2026-08-26. Decisions live in [`docs/decisions/`](decisions/); this file tracks
sequencing and known debt. Update it when items land or priorities change.

## Where this is going

Rocky replaces the *presentation* half of the forked harness with its own client, then removes `pi-tui`.
The agent underneath stays Pi-derived and Rocky-owned. Concretely:

```text
TODAY                                   AFTER
rocky           -> inherited pi-tui     rocky -> Rocky's OpenTUI client
npm run client  -> Rocky's client              (via src/contract/)

packages/harness  57,701 lines          packages/harness  ~40,000 lines
  pi-tui, pi-agent-core, pi-ai            pi-agent-core, pi-ai
```

`modes/interactive` is 17,415 of those lines. Deleting it is 41 of the 60 files that import `pi-tui`; the
other 19 live in `core/` and `cli/` and need real work (see phase C).

## Done

- Context-file discovery enabled; skills stay Rocky-only (ADR 0002).
- Bun compatibility spike for Pi 0.84.2 (results recorded in ADR 0003).
- `packages/harness`: source fork of `pi-coding-agent` v0.84.2, standalone, Rocky-branded, self-update and
  managed downloads removed, undici gated under Bun.
- Root CLI runs on the fork; `PI_PACKAGE_DIR` bridge and all runtime-rewriting workarounds deleted.
- **Live provider streaming verified under Bun** (ADR 0003's outstanding verification debt). Print mode, the
  JSON event stream, mid-stream SIGINT abort, and RPC steer all behave identically under Node 24 and Bun
  1.4.0 against a live `openai-codex` provider; streamed content matched exactly.
- **Session-file creation bug fixed.** Rocky's private-storage extension pre-created the session file, so the
  harness's exclusive-create (`wx`) flush failed with `EEXIST` on the first assistant message — every model
  turn crashed. Privacy now lives in the harness at the point of creation.
- **Harness test isolation.** The suite writes to a per-run temporary agent directory instead of the
  developer's real `~/.rocky/agent`, and strips inherited credential/cloud/proxy state.
- **Rocky contract, first slice** (`src/contract/`) with `PiAgentSessionAdapter` (`src/adapter/`), derived
  from the harness RPC protocol rather than designed greenfield (ADR 0004). Isolation and JSON /
  `structuredClone` round-trips are enforced by tests.
- **Contract corrections from adversarial review.** Six mapping defects and one vacuous exhaustiveness test,
  all fixed with regression tests derived from upstream shapes. See ADR 0004.
- **First OpenTUI + Solid client slice** (`packages/client`) over a `SessionPort`, with a headless Bun render
  suite, a root-level client smoke, and a separate Bun CI job. See ADR 0005. Scrollback, incremental tool
  output, a working quit path, prompt history, and multi-line paste have since landed.
- **Settings, theme, and key help** ([#27](https://github.com/jakeryderv/rocky/issues/27)). `/settings`,
  `/theme`, `/thinking` and `/keys`, with the client painting from the core's own resolved theme colours so
  both front ends share one theme choice. Keybindings stay fixed and `/keys` is a help screen: the core's
  bindings are `pi-tui`-coupled and their replacement is a phase C2 design decision, not a port.
- **Export, fork, clone, naming, stats, and history** ([#28](https://github.com/jakeryderv/rocky/issues/28),
  which absorbed `get_entries`/`get_tree` from #22). History crosses the seam as `SessionEntrySummary`, a
  projection of the harness's nine-variant `SessionEntry` union: identity, parent, kind, preview, timestamp
  and resolved label. `get_tree` is deliberately not a second command — `parentId` is the tree.
- **Compaction and queue UI** ([#26](https://github.com/jakeryderv/rocky/issues/26)). `/compact`,
  `/autocompact`, `/steering` and `/followup`, the queued messages listed above the prompt, and non-default
  queue settings named in the status line. Also fixed typing during a turn, which sent a `prompt` the core
  rejects rather than steering.
- **Bash passthrough** ([#24](https://github.com/jakeryderv/rocky/issues/24)). `!` and `!!` at the prompt,
  output streaming into the transcript, and ctrl+c cancelling a running command before it aborts a turn.
- **Session list, resume, and new session** ([#22](https://github.com/jakeryderv/rocky/issues/22)).
  `list_sessions`, `switch_session`, `new_session` and a `session_switched` event in the contract, with
  `/resume` and `/new` in the client. The client host was rebuilt on `AgentSessionRuntime` to do it, which
  also fixed two silent defects: extensions never booted under the client (`bindExtensions` was never
  called), and a resumed session rendered an empty transcript.
- **True multi-line prompt editing** ([#23](https://github.com/jakeryderv/rocky/issues/23)). A textarea that
  grows with the draft, replacing the held-aside paste. Enter sends; shift+Enter, alt+Enter and ctrl+J insert
  a newline.
- **Model switcher** ([#21](https://github.com/jakeryderv/rocky/issues/21)). A `/model` picker in the client,
  and the model catalog wired into the client host — it was never supplied, so `get_available_models`
  returned nothing and `set_model` always failed. The client also gained a place for commands of its own,
  which is where `/compact` and the settings screens will land.
- **Slash-command discovery** ([#19](https://github.com/jakeryderv/rocky/issues/19)). `get_commands` and a
  `SlashCommand` shape in the contract, assembled in the client host from the three registries the harness
  merges in a private closure, with a completion popup in the client. Invocation rides the existing `prompt`
  path. Built-in commands stay out: the core's builtins are `pi-tui` screens, so a command the client offers
  is the client's to implement.
- **`state_changed` is a push** ([#25](https://github.com/jakeryderv/rocky/issues/25)). The adapter emits it
  whenever its projected state differs, so the client no longer re-reads `get_state` on turn boundaries and
  after every command. One cold-start `get_state` remains.
- **`pi-client` and `pi-protocol` dropped** with the harness's dead `src/client/` remote-session surface —
  the last dependency on the Pi *ecosystem's* wire protocol rather than on its engine.

## Phase A — grow the client to daily use

The contract exposes 19 commands; the harness RPC protocol has 32. That gap, plus missing UI, is the work.
Blocking items first.

Phase A is the active phase, so it is also tracked as [open issues](https://github.com/jakeryderv/rocky/issues?q=is%3Aopen+label%3Aphase-a).
Later phases stay narrative here until they become active. When an issue's scope changes, change this file
with it.

1. **Auth and login** ([#20](https://github.com/jakeryderv/rocky/issues/20)). The hardest gap: auth was never in the RPC protocol at all. It lives only in
   `modes/interactive` (`login-dialog.ts`, `oauth-selector.ts`) and the `rocky auth` subcommand, so the
   client cannot configure a provider. Shell out to `rocky auth` first; a Rocky-owned auth surface in the
   contract is the real answer.

Every item is done. What is left before phase B is the auth gap above.

## Phase B — flip the default and move to Bun

`rocky` launches the client; the bin shebang, install, lockfile, and CI move to Bun (this is forced — OpenTUI's
renderer has no FFI backend on Node). Keep a `--legacy-tui` escape hatch for one release. Decide the test
runner for the root and harness suites, and settle packaging, which `pack:check` no longer covers.

## Phase C — remove pi-tui

**C1 caveat.** `modes/interactive/theme/theme.ts` must move rather than be deleted: it holds the theme
registry and colour resolution, which the client now reads through `getAvailableThemes` and
`getResolvedThemeColors`. Themes are a Rocky-owned concern that outlives `pi-tui`.

**C1.** Delete `packages/harness/src/modes/interactive/` (17,415 lines, 41 pi-tui files) and the three
excluded harness tests that depend on pi-tui test helpers. Mechanical once nothing imports it.

**C2.** The 19 pi-tui importers outside `modes/interactive`, in rough order of difficulty:

- **Core tools render through pi-tui.** `bash`, `read`, `write`, `edit`, `grep`, `ls`, `find`, and
  `render-utils` build `Text`/`Container` objects as display output, which `map-to-contract.ts` then flattens
  back to strings. Making the tools emit structured data removes that translation and unblocks a web client.
  This is the first place Rocky genuinely diverges from Pi rather than deleting from it — worth pulling
  forward ahead of phase A's tool-display UI so that UI is built once.
- **Keybindings.** `core/keybindings.ts` wraps pi-tui's `TUI_KEYBINDINGS` and `KeybindingsManager`. The
  client's `/keys` is a help screen until this lands: what replaces the binding shape decides what a client
  can rebind, so inventing it early would be inventing it blind.
- **The extension UI API.** `core/extensions/types.ts` types roughly ten signatures against pi-tui's `TUI`,
  `OverlayHandle`, and `EditorComponent`. Whatever replaces them defines what a Rocky extension can draw —
  a design decision, not a port.
- **Pre-session CLI pickers.** `cli/startup-ui`, `config-selector`, `session-picker`, `list-models`.
- **Two type imports** in `core/settings-manager.ts`.

## Longer term

See [`project-idea-outline.md`](project-idea-outline.md): multi-subagent experimentation (isolated
workspaces, pinned factors, repeatable scoring) once baseline behavior is stable. That work is also the most
likely trigger for forking `pi-agent-core`, whose agent loop is about 1,200 of its 8,500 lines — small enough
that forking late stays cheap, so it waits for a concrete need. A process/RPC boundary waits for one too (web
client, remote execution, daemon, sandbox isolation).

## Carried debt

- **The two entry points diverge before the session** ([#29](https://github.com/jakeryderv/rocky/issues/29)). `rocky` runs `harness.main()`, which calls
  `configureHttpDispatcher()` and sets `AI_AGENT`, `PI_CODING_AGENT`, `ROCKY_CODING_AGENT`, and
  `process.title`. `src/client-host/create-session-port.ts` constructs the session directly and does none of
  it, so the client has no HTTP idle timeout or proxy agent and its bash subprocesses see a different
  environment. Below `createAgentSessionServices` the two are identical.
- **Undici dispatcher settings do not apply under Bun.** `configureHttpDispatcher()` returns early when
  `process.versions.bun` is set. Per-request timeouts still reach the provider SDK through `sdk.ts`, and
  Bun's native fetch reads `HTTP(S)_PROXY` itself, so the practical gap is narrow — but proxied requests
  under Bun have not been exercised. Note this is separate from the entry-point gap above: the client path
  skips the call entirely, on either runtime.
- **`export_html` returns a path on the core's machine**, the one place the contract carries a filesystem
  path. For the terminal client that is the answer to "where did it go"; a remote client would need the HTML
  itself, which needs a size story the contract does not have yet.
- **A session whose directory no longer exists cannot be resumed from the client.** The harness asks for a
  replacement cwd through a UI the headless host does not have, so the switch fails with the harness's error
  instead of prompting. Same root cause as the trust gap below.
- **The client cannot resolve project trust interactively** ([#30](https://github.com/jakeryderv/rocky/issues/30)). A headless host has no UI to prompt with, so an
  undecided project resolves to untrusted. Phase A needs a trust prompt in the client.
- **Model calls are unreachable from the test suite by policy**, which is what let the `EEXIST` session-flush
  bug reach every turn undetected. The contract adapter narrows this — its mapping functions are pure and
  fully tested — but a scripted live smoke against a real provider remains manual.
- **3 harness test files excluded** (`custom-editor-history-keybindings`, `interactive-tui`,
  `interactive-mode-status`): they import pi-tui's `VirtualTerminal`/`test-themes` helpers, which the npm
  package does not ship. They go away with `modes/interactive` in phase C1.
- **Toolchain still npm/Node** — intentional until phase B; the `rocky` bin shebang is `node`, CI runs Node
  24. Bun-run is validated by smoke, by the live streaming/abort/steer checks, and by a live contract
  round-trip, but is not the default.
- **Harness `docs/` and `examples/` are upstream's** — still pi-worded; functionally accurate for inherited
  behavior (the system prompt points the model at them for app questions). Reword incrementally as the
  corresponding behavior becomes Rocky-owned.
- **Kept-compat surfaces** (documented, revisit when they get in the way): `PI_*` env controls
  (`PI_OFFLINE`, `PI_TELEMETRY`, `PI_SESSION_*`, …), upstream extension virtual-import specifiers, the
  `pi.dev` model-catalog overlay (model updates depend on it until Rocky ships its own catalog), the `pi.dev`
  share-viewer default (`PI_SHARE_VIEWER_URL` overrides), and upstream repo links in the vendored changelog.
- **Packaging/publish story deferred** — `pack:check` was dropped from the gate; the workspace layout has no
  installable-artifact validation. Decide packaging during phase B.
- **Upstream cherry-picks are manual** — the harness no longer receives upstream updates; watch
  `earendil-works/pi` for security-relevant fixes and cherry-pick by hand. Upstream `pi-ai`/`pi-agent-core`
  upgrades remain normal pinned-dependency bumps and require rerunning both suites.
