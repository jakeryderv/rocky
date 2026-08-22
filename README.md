# Rocky

Rocky is an early-stage, focused coding-agent distribution built on
[`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent).
It keeps Pi's official `InteractiveMode` and `pi-tui` experience while giving configuration and project
resources a Rocky-owned namespace.

## Status

The scaffold provides the stock Pi CLI/TUI under the `rocky` executable, Rocky path isolation, tests, and a
repeatable development gate. Rocky-specific agent behavior and the experiments in
[`docs/project-idea-outline.md`](docs/project-idea-outline.md) remain future work.

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

The npm package remains `private` while Rocky is pre-release and has no publication target. `npm run pack:check`
still validates the complete installable artifact.

## Current limitations

- Rocky uses a narrow `PI_PACKAGE_DIR` composition bridge because Pi does not expose `configDirName` as an SDK
  option. The bridge points Pi at Rocky-owned metadata and copied package assets; it never patches `node_modules`.
- Pi still uses some `PI_*` compatibility variables, `pi.dev` model infrastructure, extension virtual imports,
  and hardcoded Pi wording in the default system prompt and a few messages.
- Rocky self-update is disabled until Rocky owns an update feed. Package and model update commands remain
  available.
- Rocky requires system-managed `fd`/`rg` and refuses executables under `~/.rocky/agent/bin`; this prevents Pi's
  unpinned managed-tool downloader from running.
- Pi extensions and packages execute with the Rocky process's full permissions; project trust is not a sandbox.

## License

Rocky is Apache-2.0 licensed. Pi-derived static assets and documentation included in built package artifacts are
MIT licensed; see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
