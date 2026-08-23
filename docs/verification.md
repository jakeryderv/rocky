# Verification

`npm run verify` is the deterministic local gate. It runs Biome, strict TypeScript, credential-free coverage tests,
a clean build, an offline CLI/TUI startup smoke, and an actual tarball install/consumer check. The package check
verifies asset hashes, installed CLI execution, project path isolation, operational docs, and all Pi-family runtime
versions. The gate must not contact a model provider. `npm run security:audit` is separate because npm advisories require a live, changing network service.

Report each relevant check as **Pass**, **Fail**, or **Skip**, never as an assumption:

```text
Verification
- npm run check — Pass
- npm run typecheck — Pass
- npm run test:coverage — Pass (N tests)
- npm run build — Pass
- npm run smoke:built — Pass
- npm run security:audit — Pass / Fail / Skip (reason)

Environment
- Node:
- npm:
- Git revision:

Not verified
- Live provider calls
- Sandboxed tool execution
```

A pass requires a fresh command with exit code zero and inspected output. On failure, report the failing command and
error; do not summarize the gate as passing. CI logs plus JUnit/coverage artifacts are the generated record. Do not
commit local verification output.
