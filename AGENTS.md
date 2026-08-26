# Rocky agent guide

## Required local gate

Run `npm run verify` before reporting implementation work complete (it includes the harness workspace's own
test suite). Report the actual command outcomes using Pass/Fail/Skip. Run `npm run security:audit` separately
when network access is appropriate.

## Layout

- `packages/harness` — Rocky's harness: a source fork of `@earendil-works/pi-coding-agent` v0.84.2 (ADR
  0003). It is Rocky-owned code: edit it directly, but keep diffs minimal and reviewable against the pristine
  vendor commit, match its upstream style (tabs; excluded from root Biome), and keep its test suite green.
- `src/` — the `rocky` CLI and Rocky policy composition over the harness.
- `src/contract/` — the client-agnostic session contract (ADR 0004). It must import nothing outside itself:
  no `@earendil-works/*`, no harness, no other Rocky module. Translation belongs in `src/adapter/`.
- `packages/client` — Rocky's OpenTUI + Solid terminal client (ADR 0005). Bun-only to run; consumes only
  `@rocky/contract` through a `SessionPort` and must never import the harness or `@earendil-works/*`
  (`test/client-isolation.test.ts` enforces this over both `src` and `test`).
- `src/client-host/` — builds a real `SessionPort`; the only file allowed to know both vocabularies.
- `docs/decisions/` — ADRs; `docs/roadmap.md` — sequencing and carried debt.

## Gates

`npm run verify` is the Node gate and must stay Node-only. Bun-only work runs in `npm run client:verify`
(typecheck, render tests, client smoke) and a separate CI job. Report both when touching the client, in the
Pass/Fail/Skip format in `docs/verification.md`.

`.githooks/pre-push` runs both gates and selects the Bun one from the diff; enable it once with
`npm run hooks:install`. It is a convenience, not the contract — the gate is still yours to run and report.

## Git workflow

`main` requires both CI jobs green and rejects force-pushes, so all work goes through a branch and a pull
request; see `CONTRIBUTING.md`. Branches are `<type>/<short-slug>`, commits are Conventional Commits with an
area scope (`feat(client):`, `chore(deps):`), and merges are squashed. Never add `Co-Authored-By` or AI
attribution lines. Reference issues with `Closes #N`.

Open issues track the active roadmap phase only; `docs/roadmap.md` holds the plan and the reasoning. Keep
them consistent: when an issue's scope changes, the roadmap changes with it.

## Invariants

- Keep upstream `@earendil-works/pi-*` dependencies (`pi-ai`, `pi-agent-core`, `pi-tui`, …) exactly pinned and
  never patch `node_modules`; escalation ladder is depend → wrap → vendor with an ADR (ADR 0003).
- Import the harness in root code only through `src/runtime/pi-runtime.ts`.
- Keep global state under `~/.rocky/agent` by default and project resources under `.rocky`; tests must
  continue to prove `.pi` and shared/ancestor `.agents/skills` are ignored. Hierarchy `AGENTS.md`/`CLAUDE.md`
  context files are deliberately loaded, untrusted included (ADR 0002).
- Required tests and CI must strip inherited provider/cloud/proxy/credential-helper state, must not use real
  provider credentials, and must not make model calls.
- Preserve private POSIX agent/session permissions and the system-only `fd`/`rg` policy; the harness must
  never download executables. Session files are created owner-only by the harness itself — never pre-create a
  session file from Rocky policy code, because the harness flushes it with an exclusive-create.
- Tests must not write to the developer's real `~/.rocky/agent`; both suites redirect the agent directory and
  strip inherited credential state. `packages/harness/test/test-environment-isolation.test.ts` guards this.
- No self-update and no startup version check in the harness; `update --extensions`/`--models` stay.
- Do not store credentials, sessions, trust decisions, logs, provider payloads, or model output in `.rocky`.
- Do not commit generated `dist`, coverage, or reports. Keep `npm-shrinkwrap.json` current.
- Every entry point that creates a session must build its options from `buildRockySessionOptions` in
  `src/runtime/pi-runtime.ts`, or the CLI and the client host silently diverge on skill discovery and project
  trust.
- Rocky's changelog surfaces are Rocky's: root `CHANGELOG.md` and `packages/harness/CHANGELOG.md`; upstream
  history stays in `packages/harness/CHANGELOG.upstream.md`.

See `docs/architecture.md`, `docs/development.md`, `docs/roadmap.md`, and `SECURITY.md` before changing
runtime or trust boundaries.
