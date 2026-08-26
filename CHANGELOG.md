# Changelog

## Unreleased

- **The client no longer polls for session state.** `state_changed` was declared in the contract but never
  emitted, so `session-store.ts` compensated by re-issuing `get_state` after every turn boundary and after
  every command. That is free in-process and wrong the moment a transport sits in between. The adapter now
  publishes `state_changed` whenever its projected state actually differs — after every harness event,
  including ones the contract does not translate, and after every command, because several of them mutate
  state through synchronous setters the harness reports no event for. The diff is what keeps a streaming turn
  from pushing an identical snapshot per delta. The client keeps exactly one `get_state`: the cold-start
  snapshot, which a later push overtakes rather than being clobbered by.

- **The repository's agent guide now actually reaches Claude Code.** `AGENTS.md` held the invariants, the
  layout, and the fork boundary — and was never loaded, because Claude Code reads `CLAUDE.md` and the project
  had neither that nor a `.claude/` directory. A session therefore rediscovered the architecture from source
  every time. `CLAUDE.md` is now a symlink to `AGENTS.md`, so there is still one file to maintain; Pi's own
  context discovery takes the first match per directory (`core/resource-loader.ts:70`), so the pair never
  loads twice.

- **`AGENTS.md` gained the orientation that was expensive to rediscover**: which Pi packages are forked versus
  depended on and why, the measured size of the fork's divergence from upstream, and the fact that `rocky` and
  `npm run client` are two front ends that diverge only above `createAgentSessionServices`. It also states
  where fanning out to subagents pays here — investigation and review — and where it does not: the client is
  three files, so parallel edits collide rather than parallelize.

- **Editing on `main` is now refused**, by a `PreToolUse` hook in `.claude/`. `main` rejects direct pushes, so
  work started there has to be moved to a branch regardless; failing at the edit is cheaper than failing at
  the push. The hook ignores paths outside the repository.

- **`/ship`** runs the branch-to-merged sequence in one command: paper-trail check, both gates, push, PR from
  the template with real Pass/Fail/Skip counts, CI wait, squash-merge, and sync.

- **Repository workflow defined and enforced.** `main` now requires both CI jobs green and rejects
  force-pushes and deletion, so work goes through a branch and a PR; before this, a red `main` was one
  `git push` away and nothing prevented it. `.githooks/pre-push` runs the same gates locally (enable once
  with `npm run hooks:install` — `npm ci --ignore-scripts` means lifecycle hooks never fire), selecting the
  Bun gate from the diff and refusing the push if the client changed and Bun is missing, so that gap cannot
  pass silently. Branch naming, Conventional Commit scopes, and the squash-merge policy are written down in
  `CONTRIBUTING.md` and `AGENTS.md` instead of being inferred from history.

- **Fixed `docs/verification.md`, which described a gate that no longer exists.** It claimed `npm run verify`
  runs a tarball install/consumer check verifying asset hashes, installed CLI execution, and pinned Pi
  versions; `pack:check` was dropped when the repo became a workspace. It also never mentioned
  `client:verify`. Anyone following it reported checks that had not run.

- The active roadmap phase is now also tracked as GitHub issues (#19-#28, plus #29-#30 for carried debt),
  linked from `docs/roadmap.md`. Later phases stay narrative until they become active, so there is one place
  to change when the plan changes.

- **Dropped `pi-client` and `pi-protocol`.** The harness's `src/client/` remote-session surface — a
  `RemoteSession` over pi.dev's wire protocol, plus its transcript reducer and the `./client` package export —
  was dead code: nothing in Rocky imported it, and the experimental `client`/`server` CLI commands that would
  have driven it parse arguments into a context whose `runClient`/`runServer` hooks are never implemented.
  Deleting it removes Rocky's last dependency on the Pi *ecosystem* (its wire protocol) as opposed to the Pi
  *engine* (`pi-ai`, `pi-agent-core`, `pi-tui`). 8 files and 23 tests removed; harness suite 1830 passed / 49
  skipped.

- **Fix: the client rendered nothing.** `render()` resolves when the app is mounted, not when the TUI exits,
  so the host's `finally` disposed the session immediately: the UI kept running and accepting input, prompts
  still returned `ok: true`, and no event ever reached the transcript again. `mountRockyClient` now stays
  pending until the user quits. Covered by a mount-lifetime test, which no component-level test could catch —
  the bug lived in the composition around the component, not in it.

- `npm run client` builds first and launches through `scripts/client.mjs`, which reports a missing Bun or a
  non-interactive terminal instead of hanging silently or surfacing an unhandled rejection.

- **Fix: the client could not be exited.** `exitOnCtrlC` was disabled with a comment saying the host handled
  Ctrl+C; the host handled nothing, so there was no quit path at all. Ctrl+C now aborts a running turn and
  quits when idle, disposing the session and destroying the renderer so the terminal is left usable; the host
  also tears down on SIGINT/SIGTERM.
- **Fix: abort-on-escape never worked.** Escape does not reach `useKeyboard` at all — the key parser swallows
  it as an escape-sequence prefix — so the binding was dead while the input placeholder advertised it. Abort
  moved onto Ctrl+C, which is verified by a test.
- **Fix: the input kept its text after Enter**, so the next prompt started with the previous one still in the
  box and history navigation had no baseline.
- Client: prompt history on ↑/↓, including restoring the half-typed draft when walking back past the newest
  entry.
- Client: multi-line paste is held aside (shown as `+ N pasted lines`) and submitted as one prompt, since the
  single-line input cannot represent the newlines itself.

- Client: scrollable transcript. The transcript now lives in a `<scrollbox>` pinned to the newest content, with
  a `↓ more below` indicator when scrolled away; previously anything past the terminal height simply overflowed.
- Client: show a running tool's output. New `tool_progress` contract event carries the cumulative snapshot the
  harness already emits for the bash tool (only bash emits these; other built-in tools accept the callback and
  ignore it), so a long command shows its output instead of a frozen `⚙ bash …`. Output is tail-clipped with a
  count of dropped lines, and the finished result supersedes it.
- Fix: tool results were rendered twice — inline under the tool call and again as a separate `tool_result`
  entry, the second copy unclipped, so a noisy command buried the transcript. Tool output now renders once,
  under its call.
- Fix: `tool_end` dumped the raw `AgentToolResult` wrapper as JSON instead of its text. Same bug class as the
  one ADR 0004 records, which had been fixed only on the message path; the test that should have caught it used
  an invented `result: "done"` shape. Both paths now unwrap, and the fixtures use real shapes.
- Fix: an aborted or failed turn zeroed the token counter, because the synthetic assistant message carries an
  all-zero usage.

- Add `packages/client`, Rocky's first OpenTUI + Solid terminal client: a streaming transcript (text,
  thinking, tool calls with their results), a prompt input, abort on escape, and a status line with model,
  thinking level, streaming state, and live token usage. It consumes only the contract, through a new
  `SessionPort` (`src/contract/port.ts`), and is built by `src/client-host/`. Bun-only to run — OpenTUI's
  native FFI has no Node 24 backend — so the Node gate stays Node-only and a separate `client:verify` plus CI
  job cover the Bun lane. See ADR 0005.
- Add `buildRockySessionOptions` so the CLI and the client host cannot diverge on skill discovery or project
  trust, and export `resolveProjectTrusted` from the harness so the host resolves trust the same way the CLI
  does rather than reimplementing it.
- Fix `CommandResult` so narrowing on `command` discriminates: the catch-all acknowledgement variant
  overlapped the data-bearing ones, leaving `state`, `messages`, and `model` unreachable to a client.
- Add `tool_call_start` to `MessageDelta`, completing the delta union against upstream's streaming events.

- **Fix six contract-mapping defects found by adversarial review**, each of which would have rendered visibly
  wrong output in a client: tool results were stringified as `[{"type":"text",…}]` instead of flattened;
  `message_start` reported every message as `assistant`, opening phantom bubbles for user prompts and tool
  results; `MessageDelta` dropped the upstream `contentIndex`, making interleaved blocks unreconstructable;
  tool-call fragments and terminal events shared one variant; streaming usage was read from a field that only
  exists on the RPC wire form, freezing the token counter on the live path; and provider error text was
  dropped. Also fixes an exhaustiveness test whose union scan stopped at the first semicolon and so checked
  2 of 16 event types while passing. See ADR 0004.

- **Fix: every model turn crashed with `EEXIST`.** Rocky's private-storage extension pre-created the session
  file, so the harness's exclusive-create flush failed on the first assistant message. Session privacy is now
  enforced by the harness at the point of creation (`0600` files, `0700` directories, re-applied after the
  umask mask); the extension covers directories and pre-existing files only. No test caught this because the
  suite may not make model calls.
- Add `src/contract/`, Rocky's client-agnostic session contract (serializable commands, events, and state
  with no harness or Pi types), and `src/adapter/` with `PiAgentSessionAdapter` over the harness
  `AgentSession`. Derived from the harness RPC protocol rather than designed greenfield; isolation and
  JSON/`structuredClone` round-trips are enforced by tests. See ADR 0004.
- Verify live provider streaming, mid-stream abort, and steer under Bun 1.4.0 — identical to Node 24. Closes
  ADR 0003's verification debt.
- Isolate the harness test suite: a per-run temporary agent directory instead of the developer's real
  `~/.rocky/agent` (the suite was leaving ~21 session directories behind per run), plus credential/cloud/proxy
  env stripping to match the root suite.

- Fork `@earendil-works/pi-coding-agent` v0.84.2 as `packages/harness` (`@jakeryderv/rocky-harness`) and run
  the CLI on it; the `PI_PACKAGE_DIR` bridge, runtime help rewriting, and self-update interception are gone.
  Provider/model layers stay on exactly pinned upstream Pi packages. See ADR 0003.
- Harness fork changes: Rocky identity from its own metadata, startup version check and self-update removed,
  pi.dev install reporting removed, managed fd/rg downloader disabled (system binaries only), undici global
  fetch skipped under Bun, extension virtual imports accept `@jakeryderv/rocky-harness`.
- Validate Pi 0.84.2 under Bun (ADR 0003); adopt TypeScript + Bun + OpenTUI + Solid as the platform direction.

- Restrict automatic skill discovery to Rocky-owned global and trusted project directories.
- Disable shared `.agents/skills` discovery.
- Enable standard hierarchy AGENTS.md/CLAUDE.md context-file discovery (not gated by project trust;
  `--no-context-files` opts out). See ADR 0002.

## 0.1.0

- Initial TypeScript scaffold.
- Stock Pi interactive runtime rebranded to Rocky paths.
- Offline path-isolation tests, smoke checks, packaging checks, and CI.
