# Changelog

Rocky harness changelog. Upstream pi-coding-agent history (through v0.84.2, the fork point) is preserved in
[CHANGELOG.upstream.md](CHANGELOG.upstream.md).

## [0.1.0] - 2026-08-22

### Changes

- Forked from `@earendil-works/pi-coding-agent` v0.84.2 as Rocky's harness (`@jakeryderv/rocky-harness`).
- Rocky identity (`rocky`, `.rocky`, `ROCKY_*`) from package metadata; startup version check, self-update,
  and install reporting removed; system-installed `fd`/`rg` required (no managed downloads); native fetch
  under Bun.
