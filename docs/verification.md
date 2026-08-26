# Verification

There are two gates, split because the client renders only under Bun and the repo toolchain is still npm +
Node (ADR 0005). Neither gate may contact a model provider.

| Gate | Command | Covers |
| --- | --- | --- |
| Node | `npm run verify` | Biome, clean build, strict TypeScript, `client:typecheck`, credential-free coverage tests, the harness workspace suite, offline CLI/TUI startup smoke |
| Bun | `npm run client:verify` | Client typecheck, headless render tests, client smoke |

Run the Node gate for any change. Run both when touching `packages/client/`, `src/contract/`, or the client
scripts — the `.githooks/pre-push` hook applies exactly that rule and refuses the push if the client changed
and Bun is not on `PATH`, so the gap is never silent.

`npm run security:audit` is separate from both because npm advisories require a live, changing network
service. Run it when network access is appropriate.

## What the gate does not cover

- **No packaged-artifact check.** `pack:check` used to install a tarball and verify asset hashes, installed
  CLI execution, path isolation, and pinned Pi versions. It was dropped when the repo became a workspace and
  has no replacement; packaging is decided in roadmap phase B.
- **No model calls, by policy.** Nothing in either suite reaches a provider. This is what let the `EEXIST`
  session-flush bug reach every turn undetected — a live smoke against a real provider stays manual.
- **No sandboxed tool execution.**

## Reporting

Report each relevant check as **Pass**, **Fail**, or **Skip**, never as an assumption:

```text
Verification
- npm run verify — Pass (N root tests, M harness tests)
- npm run client:verify — Pass (N tests) / Skip (no client change)
- npm run security:audit — Pass / Fail / Skip (reason)

Environment
- Node:
- Bun:
- Git revision:

Not verified
- Live provider calls
- Packaged artifact
- Sandboxed tool execution
```

A pass requires a fresh command with exit code zero and inspected output. On failure, report the failing
command and error; do not summarize the gate as passing. CI logs plus coverage artifacts are the generated
record. Do not commit local verification output.
