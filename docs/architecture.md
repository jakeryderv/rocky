# Architecture

## Composition

```text
rocky executable (src/cli.ts)
  -> src/runtime/pi-runtime.ts (composition boundary)
     -> @jakeryderv/rocky-harness (packages/harness — forked harness, piConfig name=rocky, configDir=.rocky)
        -> harness session/runtime services, InteractiveMode
        -> exactly pinned upstream @earendil-works/pi-ai, pi-agent-core, pi-tui, pi-client, pi-protocol
```

The harness is a source fork of `@earendil-works/pi-coding-agent` v0.84.2 (vendored pristine in git history,
then modified; see ADR 0003). It reads its identity (`rocky`, `.rocky`, `ROCKY_*` environment names) from its
own package metadata, so no relocation bridge or runtime rewriting exists anymore. Rocky delegates argument
parsing, project trust, settings, package/resource loading, sessions, models, extensions, and all run modes to
the harness. `src/runtime/pi-runtime.ts` composes policy on top: Rocky-only skill discovery, automatic
trust denial for resource-less projects, private session storage, and Rocky env-var mapping.

## Fork boundary

Forked and Rocky-owned: the harness package (`packages/harness`), excluded from root Biome so its diff against
upstream v0.84.2 stays reviewable. Removed in the fork: startup version check, self-update, pi.dev install
reporting, the managed fd/rg downloader (system binaries required), and upstream easter eggs. Under Bun the
undici global-fetch installation is skipped in favor of native fetch. Extension virtual imports accept
`@jakeryderv/rocky-harness` and the upstream specifiers.

Depended on, exactly pinned, not forked: `pi-ai` (providers/models/auth churn tracked upstream),
`pi-agent-core` (agent loop), `pi-tui` (until the Rocky client replaces the inherited TUI), `pi-client`,
`pi-protocol`. Escalation ladder per package: depend, wrap through the Rocky boundary, vendor only when
wrapping cannot express a needed change (ADR 0003).

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

Temporary editor, clipboard, bash, and truncated-output files use the OS temporary directory. Some
process/session controls remain `PI_*` (`PI_OFFLINE`, `PI_TELEMETRY`, `PI_SESSION_*`, …) and the upstream
extension virtual-import specifiers keep working. These compatibility surfaces are documented rather than
hidden.

The harness has no self-update or startup version check; `rocky update --extensions`/`--models` handle managed
resources. `fd`/`fdfind` and `rg` must be system-installed — the fork's tool manager only resolves from PATH
and never downloads. A hidden inline extension plus a restrictive startup umask enforces private POSIX session
storage without changing the umask inherited by model-invoked shell commands.

## Future behavior

Prefer composition in `src/` (inline extensions, SDK composition) for policy, and direct harness edits for
behavior the fork owns; keep harness diffs minimal and reviewable against upstream v0.84.2. Do not add a
generic plugin framework, persistence layer, daemon, or service without a real caller and an ADR when the
decision crosses the threshold.
