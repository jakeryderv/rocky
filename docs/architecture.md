# Architecture

## Composition

```text
rocky executable (src/cli.ts)
  -> src/runtime/pi-runtime.ts (composition boundary)
     -> @jakeryderv/rocky-harness (packages/harness — forked harness, piConfig name=rocky, configDir=.rocky)
        -> harness session/runtime services, InteractiveMode
        -> exactly pinned upstream @earendil-works/pi-ai, pi-agent-core, pi-tui, pi-client, pi-protocol

packages/client (OpenTUI + Solid, Bun-only; also web/remote later)
  -> src/contract/ (serializable commands/events/state + SessionPort; no harness or Pi types)
     -> src/client-host/ (builds a real SessionPort; the only both-vocabularies file)
        -> src/adapter/ (PiAgentSessionAdapter, pure mapping functions)
           -> harness AgentSession
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

## Session contract

`src/contract/` is Rocky's client-agnostic session contract: serializable commands, events, and state that
any client can compile against without resolving a harness or Pi type. Its shapes derive from the harness RPC
protocol (`packages/harness/src/modes/rpc/`) with the four upstream type leaks replaced by Rocky-owned
equivalents — `ThinkingLevel`, `ModelRef`, `ImageBlock`, `SessionMessage` (ADR 0004).

Two rules make this hold rather than merely intend it, both enforced by `test/contract-isolation.test.ts`:
contract modules import nothing outside their own directory, and every fixture survives `JSON` and
`structuredClone` round-trips. Translation belongs in `src/adapter/`, never in the contract.

`PiAgentSessionAdapter` consumes a structural `AgentSessionLike` interface rather than the harness class, so
it can be tested against a fake and harness signature drift surfaces in one place. Harness events and message
kinds with no contract shape are dropped rather than leaked, and enum values are normalized with explicit
fallbacks so an upstream addition degrades to a safe default.

The contract is deliberately smaller than the RPC protocol. Session fork/clone/switch, bash execution,
extension UI, and slash commands stay in the harness protocol until a client actually consumes them; growing
the contract alongside its first client is what keeps it from modeling surface nobody reads.

## Client

`packages/client` is Rocky's own terminal client: OpenTUI + Solid, private, never built (Bun transpiles it from
source). It talks to a `SessionPort` — `subscribe` plus `execute`, over serializable values only — so it can be
driven by a fake port in tests and by a transport later without changing. `src/client-host/` is the only place
that knows both the harness and the contract.

The client renders only under Bun: OpenTUI's native FFI has no backend on Node 24 (Node >= 26.4 with
`--experimental-ffi` would work). The repo toolchain stays npm + Node, so there are two gates — `npm run
verify` is Node-only and adds just `client:typecheck`; `npm run client:verify` and a separate CI job run the
Bun typecheck, render tests, and client smoke. Bun-only specifiers are held in variables so the Node program
never tries to resolve them. See ADR 0005.

The pure transcript reducer (`packages/client/src/model/transcript.ts`) carries the logic most likely to be
wrong and runs in the Node suite; the Solid layer only maps its output to elements.

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

Session files and session directories are created owner-only (`0600`/`0700`) by the harness at the point of
creation, and re-`chmod`ed there because open/mkdir modes are masked by the ambient umask. Rocky's hidden
inline extension covers the directories and any pre-existing file; it must not create the session file
itself, because the harness flushes it with an exclusive-create and would fail with `EEXIST`.

Temporary editor, clipboard, bash, and truncated-output files use the OS temporary directory. Some
process/session controls remain `PI_*` (`PI_OFFLINE`, `PI_TELEMETRY`, `PI_SESSION_*`, …) and the upstream
extension virtual-import specifiers keep working. These compatibility surfaces are documented rather than
hidden.

The harness has no self-update or startup version check; `rocky update --extensions`/`--models` handle managed
resources. `fd`/`fdfind` and `rg` must be system-installed — the fork's tool manager only resolves from PATH
and never downloads. A restrictive startup umask covers early file creation without changing the umask
inherited by model-invoked shell commands; session storage modes are enforced at creation time as described
above.

## Future behavior

Prefer composition in `src/` (inline extensions, SDK composition) for policy, and direct harness edits for
behavior the fork owns; keep harness diffs minimal and reviewable against upstream v0.84.2. Do not add a
generic plugin framework, persistence layer, daemon, or service without a real caller and an ADR when the
decision crosses the threshold.
