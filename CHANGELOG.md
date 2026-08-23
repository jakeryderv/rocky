# Changelog

## Unreleased

- Fork `@earendil-works/pi-coding-agent` v0.84.2 as `packages/harness` (`@jakeryderv/rocky-harness`) and run
  the CLI on it; the `PI_PACKAGE_DIR` bridge, runtime help rewriting, and self-update interception are gone.
  Provider/model layers stay on exactly pinned upstream Pi packages. See ADR 0003.
- Harness fork changes: Rocky identity from its own metadata, startup version check and self-update removed,
  pi.dev install reporting removed, managed fd/rg downloader disabled (system binaries only), undici global
  fetch skipped under Bun, extension virtual imports accept `@jakeryderv/rocky-harness`.
- Validate Pi 0.84.2 under Bun (ADR 0003); adopt TypeScript + Bun + OpenTUI + Solid as the platform direction.

- Restrict automatic skill discovery to Rocky-owned global and trusted project directories.
- Disable shared `.agents/skills` discovery.
- Enable standard hierarchy AGENTS.md/CLAUDE.md context-file discovery (not gated by project trust;
  `--no-context-files` opts out). See ADR 0002.

## 0.1.0

- Initial TypeScript scaffold.
- Stock Pi interactive runtime rebranded to Rocky paths.
- Offline path-isolation tests, smoke checks, packaging checks, and CI.
