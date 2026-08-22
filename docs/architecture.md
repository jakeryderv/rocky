# Architecture

## Composition

```text
rocky executable
  -> src/runtime/pi-runtime.ts
     -> Rocky package metadata (`name=rocky`, `configDir=.rocky`)
     -> @earendil-works/pi-coding-agent main()
        -> Pi session/runtime services
        -> Pi InteractiveMode
        -> @earendil-works/pi-tui
```

Rocky delegates argument parsing, project trust, settings, package/resource loading, sessions, models, extensions,
and all run modes to Pi. It does not recreate the TUI. `src/runtime/pi-runtime.ts` is the only Pi runtime import
boundary and exposes only what current callers need: environment preparation, runtime loading for tests/SDK work,
and CLI execution.

## Rebranding boundary

Pi 0.84.2 reads `piConfig` from the package directory at module initialization. Its SDK can override `agentDir`,
but it has no `configDirName` option, so an ordinary wrapper would still discover `.pi` project resources. Rocky
uses Pi's documented `PI_PACKAGE_DIR` asset-relocation hook to point the dependency at `pi-package/package.json`
before dynamically importing Pi. That metadata selects `rocky`, `.rocky`, and Rocky-named directory environment
variables for all stock path consumers.

`npm run build` copies Pi's static themes, interactive assets, HTML-export templates, docs, and examples from the
exactly pinned dependency into `pi-package/`. No dependency code is edited or patched. The copied runtime package
metadata is checked against root package metadata, and `npm run pack:check` verifies required files.

This bridge is intentionally narrow but version-coupled: a Pi upgrade requires rerunning path/discovery, smoke, and
package tests against the new exact version.

## State and trust

See [`configuration.md`](configuration.md) for the path table. Project `.rocky` settings/resources load only after
Pi's trust decision. Trust decisions live globally in `~/.rocky/agent/trust.json`, never in the repository.
Third-party extensions and packages have full process permissions. Trust gates project `.rocky` resources; it does
not isolate code, shell commands, or model requests.

## Known inherited behavior

Rocky starts agent sessions with Pi's general skill discovery disabled. A hidden Rocky extension adds back only
`~/.rocky/agent/skills` and trusted `<cwd>/.rocky/skills`; shared `~/.agents/skills` and ancestor `.agents/skills`
are not loaded. Explicit `--skill` paths remain an intentional user opt-in. Hierarchy context files
(`AGENTS.md`/`AGENTS.override.md`/`CLAUDE.md`) use stock Pi discovery, which has no project-trust gate; Rocky
accepts this deliberately (see ADR 0002) and `--no-context-files` remains a per-invocation opt-out.

Temporary editor, clipboard, bash, and truncated-output files use the OS temporary directory. Some process/session
controls remain `PI_*`, extension virtual imports remain `@earendil-works/pi-*`, and parts of the default prompt/UI
still say Pi. These compatibility surfaces are documented rather than hidden.

The official Pi self-update feed names the official Pi package, so Rocky rejects self-update targets and disables
the startup version check. Provider/model and package update operations remain delegated to Pi. Rocky also requires
system-managed `fd`/`fdfind` and `rg` and refuses `~/.rocky/agent/bin` copies, preventing Pi's unpinned executable
download path. A hidden inline extension plus a restrictive startup umask enforces private POSIX session storage
without changing the umask inherited by model-invoked shell commands.

## Future behavior

Add Rocky behavior through inline extensions, normal extensions, or supported SDK composition before modifying Pi
UI/runtime internals. Do not add a generic plugin framework, persistence layer, daemon, or service without a real
caller and an ADR when the decision crosses the threshold.
