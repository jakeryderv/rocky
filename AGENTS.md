# Rocky agent guide

Read this before exploring. Everything below was expensive to rediscover from the source.

## Orientation

Rocky replaces the presentation half of a forked coding agent with its own client. Pi ships as a stack;
Rocky copied the top of it and depends on the rest.

```text
packages/harness        COPY of @earendil-works/pi-coding-agent v0.84.2 — Rocky-owned, 57.7k lines
  ├── pi-tui            60 files. Dies with modes/interactive (roadmap phase C)
  ├── pi-agent-core     33 files. Agent loop + core tools. Fork only when subagent work needs loop control
  └── pi-ai             50 files. Providers/models/auth. Never fork — it is pure upstream churn
```

The fork is 98% untouched upstream: 21 source files changed, 131 insertions, 1,344 deletions, almost all
removals (self-update, version check, fd/rg downloader, install reporting) plus `.pi` → `.rocky` renames.
Rocky has not diverged from Pi yet — it bought the option to.

**Two entry points, one session.** They diverge above `createAgentSessionServices` and are identical below it:

| | `rocky` (Node) | `npm run client` (Bun) |
| --- | --- | --- |
| Entry | `src/cli.ts` → `runRocky` → `harness.main()` | `scripts/client.mjs` → `src/client-host/tui-entry.ts` |
| UI | inherited pi-tui `InteractiveMode` | `packages/client` (OpenTUI + Solid) over the contract |
| Gets | arg parsing, subcommands, auth, session picker, `configureHttpDispatcher()`, `AI_AGENT` env | none of it (see the carried debt in `docs/roadmap.md`) |

**The seam.** `packages/client` imports only `@rocky/contract`. `src/adapter/` translates Pi types to it, and
`src/client-host/create-session-port.ts` is the single file that knows both vocabularies. Keep it that way:
that boundary is what makes the harness replaceable.

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

`/ship` runs the whole sequence: gates, changelog and roadmap check, push, PR, CI wait, squash-merge, sync.

A `PreToolUse` hook refuses edits while HEAD is on `main`. That is deliberate — `main` rejects direct pushes,
so work started there has to be moved anyway. Branch first.

## When to fan out, and when not to

This repo is small and centralized, so parallel *editing* mostly produces merge conflicts rather than speed.
`packages/client` is three files; issues #19, #21, #23, #26 and #27 all edit `App.tsx`, and #24, #25 and #28
all edit `src/contract/types.ts`. Run those sequentially.

Fan out on investigation and review instead:

- **`Explore` agents** for "where does X live" across the 57.7k-line harness. This is the highest-value use —
  the alternative is a dozen greps in the main context.
- **Parallel review before a PR.** Independent adversarial passes already caught six real contract defects
  (ADR 0004). Worth it on anything touching the contract or trust.
- **Per issue: fan out to map the surface, then edit in one place.** Investigation parallelizes; the edit does
  not.
- **Worktree isolation** only for genuinely disjoint files — for example a debt issue (#29, #30) alongside
  client work.

Use context7 for OpenTUI (`0.5.8`) and Solid (`1.9.12`) APIs rather than recalling them. Both are fast-moving
and pinned exactly; guessing an API here costs more than the lookup.

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
