# Changelog

## Unreleased

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
