# Development

## Setup

```bash
node --version   # >=22.19.0; Node 24 is the baseline
npm ci --ignore-scripts
npm run dev -- --offline
```

Direct dependencies are exact-pinned. Add another Pi package directly only when Rocky imports it directly, and pin
all Pi packages to the same release. `npm-shrinkwrap.json` is the publish-effective production dependency lock;
consumer installation checks must continue to prove every runtime `@earendil-works/pi-*` package is `0.84.2`.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run format` / `format:check` | Write/check Biome formatting |
| `npm run lint` / `check` | Biome lint or combined static check |
| `npm run typecheck` | Strict TypeScript without emit |
| `npm test` / `test:coverage` | Credential-free Vitest suite |
| `npm run build` | Build the harness workspace, then the root CLI |
| `npm run smoke` | Build, then run offline CLI/TUI startup smoke checks |
| `npm run verify` | Deterministic local completion gate |
| `npm run security:audit` | Live production dependency advisory check |

The harness fork in `packages/harness` has its own test suite (`npm test --workspace @jakeryderv/rocky-harness`)
and is excluded from root Biome to keep its diff against upstream v0.84.2 reviewable. Change the exact pinned Pi
dependency versions only as a deliberate upgrade, then update the third-party notice if needed and run both the
harness suite and the full root gate.

## Testing rules

Use temporary `HOME`, agent, and project directories. Set offline/version-check/telemetry controls. Never require a
provider credential or prompt a model in required tests. Test setup and subprocesses remove inherited provider,
cloud, proxy, telemetry, credential-helper, and session variables rather than copying the ambient environment. Path tests must place poison resources in `.pi`,
`~/.agents/skills`, ancestor `.agents/skills`, and generic context files so a regression fails positively rather
than merely assuming absence. At least one Rocky-owned skill must be loaded positively in the TUI smoke test.

## Change lifecycle

Keep changes focused. Discuss broad runtime, trust, packaging, persistence, or public CLI direction before editing.
Use an ADR only at the threshold in [`decisions/README.md`](decisions/README.md). Preserve replacement seams, but do
not create abstractions with no caller.

Experimental subharness, combinatorial interaction, factorial-design, and ablation work remains staged in
[`project-idea-outline.md`](project-idea-outline.md): first establish stable Rocky behavior and measurable outcomes,
then add isolated, reproducible experiments outside required CI.
