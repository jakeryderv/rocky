# Rocky agent guide

## Required local gate

Run `npm run verify` before reporting implementation work complete. Report the actual command outcomes using
Pass/Fail/Skip. Run `npm run security:audit` separately when network access is appropriate.

## Invariants

- Keep `@earendil-works/pi-coding-agent` exactly pinned and do not patch `node_modules`.
- Import Pi runtime code only in `src/runtime/pi-runtime.ts`, after Rocky package metadata is configured.
- Keep global state under `~/.rocky/agent` by default and project resources under `.rocky`; tests must continue to
  prove `.pi`, shared/ancestor `.agents/skills`, and generic AGENTS.md/CLAUDE.md resources are ignored.
- Use Pi's supported `InteractiveMode`/`pi-tui`; do not recreate the terminal UI.
- Required tests and CI must strip inherited provider/cloud/proxy/credential-helper state, must not use real
  provider credentials, and must not make model calls.
- Preserve private POSIX agent/session permissions and the system-only `fd`/`rg` policy; never enable Pi's managed
  executable downloader.
- Do not store credentials, sessions, trust decisions, logs, provider payloads, or model output in `.rocky`.
- Do not commit generated `dist`, coverage, reports, or `pi-package` asset mirrors. Keep the publish-effective
  `npm-shrinkwrap.json` current and verify it through a real consumer install.

See `docs/architecture.md`, `docs/development.md`, and `SECURITY.md` before changing runtime or trust boundaries.
