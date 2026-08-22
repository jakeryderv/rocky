# Changelog

## Unreleased

- Restrict automatic skill discovery to Rocky-owned global and trusted project directories.
- Disable shared `.agents/skills` discovery.
- Enable standard hierarchy AGENTS.md/CLAUDE.md context-file discovery (not gated by project trust;
  `--no-context-files` opts out). See ADR 0002.

## 0.1.0

- Initial TypeScript scaffold.
- Stock Pi interactive runtime rebranded to Rocky paths.
- Offline path-isolation tests, smoke checks, packaging checks, and CI.
