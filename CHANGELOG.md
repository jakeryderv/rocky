# Changelog

## Unreleased

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
