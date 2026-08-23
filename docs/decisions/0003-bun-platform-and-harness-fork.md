# ADR 0003: Bun platform, harness fork, and Rocky-owned client architecture

- Status: Accepted
- Date: 2026-08-22
- Supersedes the fork rejection in [ADR 0001](0001-pi-runtime-boundary.md); ADR 0001's runtime-boundary
  composition remains accurate until the fork integration completes.

## Context

Rocky's direction is a platform Rocky owns: a headless, client-agnostic agent core behind Rocky-defined
contracts, with an OpenTUI + Solid terminal client first and other clients (web, server/API, remote) possible
later. OpenTUI's renderer requires Bun. The changes Rocky needs from the harness (config naming, discovery and
trust policy, update feed, branding, session composition, Bun-native networking) concentrate in
`@earendil-works/pi-coding-agent`, which Rocky currently adapts through workarounds: the `PI_PACKAGE_DIR`
metadata bridge, runtime help-text rewriting, argument injection, and self-update blocking.

A compatibility spike ran Pi 0.84.2 under Bun 1.4.0 using the exact surfaces Rocky consumes. Results: the full
TUI smoke passed unchanged; extension loading (including `@earendil-works/*` virtual imports), skills/context
discovery, settings/session/trust persistence, umask and private file modes, and `spawnSync` all behaved
identically. Upstream treats plain Bun as a supported runtime (`process.versions.bun` checks throughout);
its `src/bun/` entry exists for single-binary packaging, not runtime compatibility. Known deltas: (1)
`configureHttpDispatcher()` unconditionally replaces `globalThis.fetch` with npm-undici, which under Bun routes
through the node-compat layer — the main risk surface; (2) install-method detection reports `bun` whenever
`process.versions.bun` is set, affecting self-update (which Rocky removes anyway); (3) Bun's `os.homedir()`
honors launch-time `HOME` but ignores runtime mutation, which affects test fixtures, not production; (4) live
provider streaming was not exercised (no credentials configured at spike time).

Forking everything was rejected: `pi-ai` (~17k lines) derives its value from upstream tracking of provider,
model, and auth churn, and `pi-agent-core` (~8.5k lines) is a stable engine Rocky has no divergence plans for.
Freezing either would transfer high-churn maintenance to Rocky for no benefit.

## Decision

- **Platform**: TypeScript on Bun, single process. A process/RPC boundary is introduced only when a concrete
  need appears (web client, remote execution, daemon, sandbox isolation) — not preemptively.
- **Fork `pi-coding-agent` only**, from upstream tag `v0.84.2`, vendored as source into this repository. The
  fork is Rocky's harness: rebranding, discovery/trust policy, and update behavior are edited at the source,
  retiring the `PI_PACKAGE_DIR` bridge, help rewriting, argument injection, and self-update interception.
  Under Bun, the undici global-fetch installation is bypassed in favor of native fetch.
- **Depend, exactly pinned, on upstream** `pi-agent-core`, `pi-ai`, and transitively required Pi packages.
  Escalation ladder per package: depend → wrap through a Rocky boundary → vendor only when wrapping cannot
  express a needed change. `pi-tui` remains only until the Rocky client replaces the inherited TUI, then is
  dropped.
- **Client architecture**: the agent core stays headless behind a Rocky-owned contract with serializable
  commands/events/state and no Pi types leaking through; the first client is OpenTUI + Solid. Contract
  discipline is enforced mechanically (no `@earendil-works/*` imports in contract modules; serialization
  round-trip tests).

## Consequences

Rocky owns ~30–48k lines of harness source (shrinking as inherited TUI code is deleted) and stops receiving
upstream harness updates; upstream fixes are cherry-picked by hand when wanted. Provider/model/auth churn
continues to arrive through pinned upstream `pi-ai` upgrades. The vendored fork is committed pristine first,
then modified, so Rocky's divergence from `v0.84.2` stays reviewable as history. Extension virtual imports keep
the `@earendil-works/pi-coding-agent` specifier for compatibility until a Rocky-named alias is decided.
Remaining verification debt: live provider streaming under Bun must be exercised once credentials are
configured, before the Bun runtime ships as the default.
