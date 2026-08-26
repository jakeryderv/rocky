# Changelog

Rocky harness changelog. Upstream pi-coding-agent history (through v0.84.2, the fork point) is preserved in
[CHANGELOG.upstream.md](CHANGELOG.upstream.md).

## Unreleased

### Fixed

- **The image-resize worker is no longer resolved from the working directory.** A Bun compiled executable
  resolves worker entrypoints by string path, so the release binary needs the relative form to reach its
  embedded worker. The guard was `process.versions.bun`, not "is this a compiled binary" — and a relative
  path resolves against the current working directory, so under `bun run` a planted
  `src/utils/image-resize-worker.ts` in the project being worked on was executed whenever an image was
  processed. Now gated on `isBunBinary`. Inherited from upstream v0.84.2; worth reporting upstream.

## [0.1.0] - 2026-08-22

### Changes

- Forked from `@earendil-works/pi-coding-agent` v0.84.2 as Rocky's harness (`@jakeryderv/rocky-harness`).
- Rocky identity (`rocky`, `.rocky`, `ROCKY_*`) from package metadata; startup version check, self-update,
  and install reporting removed; system-installed `fd`/`rg` required (no managed downloads); native fetch
  under Bun.
