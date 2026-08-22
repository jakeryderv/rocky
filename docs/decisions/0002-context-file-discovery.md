# ADR 0002: Enable standard context-file discovery

- Status: Accepted
- Date: 2026-08-22

## Context

The scaffold disabled all cross-harness discovery by passing `--no-skills` and `--no-context-files` to every
coding session. Hierarchy context files (`AGENTS.override.md`/`AGENTS.md`/`CLAUDE.md`) are now a de facto
cross-agent standard: real repositories carry them, and every mainstream harness reads them. Keeping them
disabled makes Rocky behave worse than other agents on the same repository without a compensating benefit.

Skill discovery is different: shared `~/.agents/skills` and ancestor `.agents/skills` are closer to executable
content, are not standardized across harnesses, and would add an uncontrolled input that varies between runs —
a confound for the planned experimentation work.

Pi 0.84.2 loads context files unconditionally when enabled: `loadProjectContextFiles` reads the global agent
directory plus the working directory and all ancestors, with no project-trust gate, and `main()` exposes no
`agentsFilesOverride` hook through which an inline extension could impose one.

## Decision

Stop passing `--no-context-files`; keep `--no-skills` and the Rocky-only skill roots. Rocky follows stock Pi
context-file discovery: global `~/.rocky/agent/` context file, then working-directory and ancestor
`AGENTS.override.md`/`AGENTS.md`/`CLAUDE.md`. `--no-context-files` remains available as a per-invocation opt-out.

Accept that context files load regardless of project trust. They are declarative prompt content, not code, and
this matches other harnesses' behavior; the residual risk is prompt injection from an untrusted repository's
context file. Revisit if Pi grows a trust gate or override hook reachable from `main()`.

## Consequences

Rocky picks up repository instructions the same way other agents do, including in untrusted projects. Rocky
`SYSTEM.md`/`APPEND_SYSTEM.md` continue to work and now compose with generic context files. Skill isolation and
the reproducible-input posture for experiments are unchanged. The no-trust-gate behavior is pinned by a test so
a Pi upgrade that changes it is caught at verification.
