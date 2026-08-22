# Project-local Rocky files

Track only reviewed Pi-supported Rocky resources that intentionally affect this repository: `settings.json`,
`SYSTEM.md`, `APPEND_SYSTEM.md`, and files under `extensions/`, `skills/`, `prompts/`, or `themes/`.

Runtime state, credentials, sessions, packages, logs, caches, reports, machine overrides, provider payloads, model
output, and trust decisions must not be committed. This directory's deny-by-default `.gitignore` enforces that
policy. A repository must never store its own trust approval.
