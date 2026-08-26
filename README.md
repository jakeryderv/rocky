# Rocky

Rocky is an early-stage coding-agent platform. Its harness lives in
[`packages/harness`](packages/harness), a source fork of
[`@earendil-works/pi-coding-agent`](https://github.com/earendil-works/pi) v0.84.2 rebranded and adapted for
Rocky (see [ADR 0003](docs/decisions/0003-bun-platform-and-harness-fork.md)); the provider/model layer stays
on exactly pinned upstream Pi packages (`pi-ai`, `pi-agent-core`, …).

## Status

The `rocky` executable runs the forked harness with its inherited `InteractiveMode`/`pi-tui` TUI, Rocky path
isolation, the fork's full regression suite, and a repeatable development gate. Sequencing and known debt are
tracked in [`docs/roadmap.md`](docs/roadmap.md): next up are a Rocky-owned contract and an OpenTUI + Solid
client on Bun; the experiments in [`docs/project-idea-outline.md`](docs/project-idea-outline.md) remain
future work.

## Requirements and setup

- Node.js `>=22.19.0` (Node 24 is the development/CI baseline)
- npm
- System-installed `ripgrep` (`rg`) and `fd` (Debian/Ubuntu may provide `fdfind`)

```bash
npm ci --ignore-scripts
npm run build
npm link
rocky --offline
```

To use a model, configure a provider credential through `rocky`'s `/login` flow or the provider's documented
environment variable. Never put credentials in project-local `<cwd>/.rocky/`.

## Trying the new client (preview)

Rocky's own terminal client (OpenTUI + Solid) is early but usable. It requires Bun, because OpenTUI's native
renderer has no FFI backend on Node 24:

```bash
npm run client        # builds, then launches under Bun
```

Keys: `Enter` submits, `↑`/`↓` walk prompt history, `Ctrl+C` aborts a running turn and quits when idle. A
multi-line paste is held aside and submitted as one prompt.

The default `rocky` command still runs the inherited interactive TUI; the new client replaces it once it covers
daily use. See [`docs/roadmap.md`](docs/roadmap.md).

## Configuration at a glance

| Scope | Default |
| --- | --- |
| Global state | `~/.rocky/agent/` |
| Global override | `ROCKY_CODING_AGENT_DIR` |
| Session override | `ROCKY_CODING_AGENT_SESSION_DIR` or `--session-dir` (CLI wins) |
| Project settings/resources | `<cwd>/.rocky/` |

Rocky does not discover `<cwd>/.pi` settings, extensions, skills, prompts, themes, `SYSTEM.md`, or
`APPEND_SYSTEM.md`. It also disables shared `~/.agents/skills` and ancestor `.agents/skills` discovery; automatic
skills come only from Rocky's global and trusted project `skills/` directories. Hierarchy context files
(`AGENTS.md`/`AGENTS.override.md`/`CLAUDE.md`) follow standard Pi discovery and load regardless of project trust
(`--no-context-files` opts out). Project resources remain subject to Pi's project-trust flow.
See [`docs/configuration.md`](docs/configuration.md) for exact paths and compatibility environment variables.

## Development

```bash
npm run verify
npm run security:audit  # separate, network-dependent advisory check
```

See [`docs/development.md`](docs/development.md), [`docs/architecture.md`](docs/architecture.md), and
[`SECURITY.md`](SECURITY.md).

The npm packages remain `private` while Rocky is pre-release and has no publication target.

## Current limitations

- The harness fork retains some `PI_*` compatibility variables (`PI_OFFLINE`, `PI_TELEMETRY`,
  `PI_SESSION_*`, …), `pi.dev` model-catalog infrastructure, and the upstream extension virtual-import
  specifiers (`@earendil-works/pi-coding-agent` works alongside `@jakeryderv/rocky-harness`).
- Rocky has no self-update; update Rocky with the package manager that installed it. `rocky update
  --extensions` and `--models` remain available.
- Rocky requires system-installed `fd`/`rg`; the harness never downloads executables.
- Extensions and packages execute with the Rocky process's full permissions; project trust is not a sandbox.

## License

Rocky is Apache-2.0 licensed. Pi-derived static assets and documentation included in built package artifacts are
MIT licensed; see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
