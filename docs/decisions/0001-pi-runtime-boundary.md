# ADR 0001: Pi runtime and rebranding boundary

- Status: Accepted
- Date: 2026-04-10

## Context

Rocky needs Pi's official interactive CLI/TUI with Rocky-owned global and project paths. Pi 0.84.2 accepts an
`agentDir` SDK option, but project discovery uses a package-level `CONFIG_DIR_NAME`; there is no SDK
`configDirName` option. A thin static import would silently retain `.pi` project discovery. Forking all coding-agent
source would provide metadata control but increase scaffold size and rebase cost.

## Decision

Use exactly pinned `@earendil-works/pi-coding-agent` as Rocky's primary runtime. Keep all runtime imports behind a
small dynamic adapter. Before import, point Pi's documented `PI_PACKAGE_DIR` hook at Rocky-owned package metadata
with `name=rocky` and `configDir=.rocky`. Build a publishable static-asset/docs mirror from the pinned dependency;
do not patch `node_modules`. Delegate CLI orchestration and TUI behavior to Pi's public `main()` and
`InteractiveMode` composition.

Disable Pi release checks and reject self-update targets until Rocky has its own update implementation. Require
system `fd`/`rg` rather than allowing Pi's managed executable downloader. Use a Rocky inline extension and
restrictive startup umask to protect session storage, restoring the caller's umask before shell tools run. Publish
`npm-shrinkwrap.json` so consumers receive the complete exact Pi 0.84.2 dependency set.

## Consequences

Rocky gets stock argument parsing, trust, sessions, package/resource handling, extensions, models, run modes, and
TUI behavior while all stock config-directory consumers see `.rocky`. The adapter is small and path behavior can be
falsified with fixtures.

The bridge relies on Pi's package-metadata, extension lifecycle, session lifecycle, and asset-layout contracts and
must be reverified on every Pi upgrade. Some Pi identity and compatibility surfaces remain hardcoded and are
documented. Built artifacts include generated Pi MIT-licensed static materials and must preserve their notice.
