# Configuration and paths

## Defaults

| Resource | Global | Trusted project |
| --- | --- | --- |
| Settings | `~/.rocky/agent/settings.json` | `<cwd>/.rocky/settings.json` |
| Auth | `~/.rocky/agent/auth.json` | — |
| Models/catalog cache | `~/.rocky/agent/models.json`, `models-store.json` | — |
| Sessions | `~/.rocky/agent/sessions/` | — |
| Trust/keybindings | `~/.rocky/agent/trust.json`, `keybindings.json` | — |
| Extensions | `~/.rocky/agent/extensions/` | `<cwd>/.rocky/extensions/` |
| Skills | `~/.rocky/agent/skills/` | `<cwd>/.rocky/skills/` |
| Prompts | `~/.rocky/agent/prompts/` | `<cwd>/.rocky/prompts/` |
| Themes | `~/.rocky/agent/themes/` | `<cwd>/.rocky/themes/` |
| System prompt | `~/.rocky/agent/SYSTEM.md` | `<cwd>/.rocky/SYSTEM.md` |
| Appended prompt | `~/.rocky/agent/APPEND_SYSTEM.md` | `<cwd>/.rocky/APPEND_SYSTEM.md` |
| Managed packages | `~/.rocky/agent/{npm,git}/` | `<cwd>/.rocky/{npm,git}/` |

A trusted project system/append file takes precedence over its global counterpart. Project settings override global
settings with nested-object merging. Prompt discovery is nonrecursive; skills recursively discover `SKILL.md`.

## Environment and CLI precedence

- `ROCKY_CODING_AGENT_DIR` overrides `~/.rocky/agent` for all global Rocky state.
- `--session-dir` overrides `ROCKY_CODING_AGENT_SESSION_DIR`, which overrides the settings `sessionDir`.
- `ROCKY_OFFLINE=1` is a Rocky alias for `PI_OFFLINE=1`; `--offline` is also supported.
- `ROCKY_TELEMETRY` maps to Pi's install-telemetry control. If neither it nor `PI_TELEMETRY` is set, Rocky
  disables Pi install/update telemetry and the provider attribution controlled by that setting. Provider-specific
  protocol/client headers that are independent of install telemetry may still be sent.
- `PI_CODING_AGENT_DIR` does not redirect Rocky state. Use the Rocky-named variable.

Provider credential variables and other Pi compatibility controls continue to use their upstream names. Rocky
requires system-installed `fd`/`fdfind` and `rg`; the harness resolves them from `PATH` only and never
downloads executables. Run `rocky --help` for the current CLI options.

On POSIX, Rocky restricts the agent directory and all default/custom session directories to mode `0700`, and
pre-creates session files with mode `0600`. The restrictive startup umask is restored after session initialization
so shell commands keep the user's normal umask.

## Project-local policy

`.pi` project settings and resources are ignored. Rocky also disables automatic discovery from
`~/.agents/skills` and ancestor `.agents/skills`. Skills are automatically loaded only from
`~/.rocky/agent/skills` and trusted `<cwd>/.rocky/skills`; an explicit `--skill` path remains available as a
deliberate opt-in.

Hierarchy context files (`AGENTS.override.md`/`AGENTS.md`/`CLAUDE.md`) follow standard Pi discovery: the global
agent directory, then the working directory and its ancestors, first match per directory. They load regardless of
project trust — Pi provides no trust gate for them (ADR 0002) — and `--no-context-files` disables them for an
invocation. Rocky `SYSTEM.md`/`APPEND_SYSTEM.md` still control the system prompt; context files add repository
instructions alongside them.

`.rocky` resources are loaded only after project trust is resolved. The repository's `.rocky/.gitignore` tracks
reviewed behavior and denies runtime state by default; a project cannot store its own trust approval.
