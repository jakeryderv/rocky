# ADR 0005: A Bun-only client inside an npm/Node workspace

- Status: Accepted
- Date: 2026-08-25
- Implements the client architecture in [ADR 0003](0003-bun-platform-and-harness-fork.md) over the contract
  from [ADR 0004](0004-session-contract-from-rpc-protocol.md).

## Context

ADR 0003 chose OpenTUI + Solid for Rocky's first client and sequenced the Bun toolchain migration *after* the
client work. That leaves a gap: the client needs Bun to run while the repository still installs, builds,
typechecks, and tests on npm + Node 24. The behavior of OpenTUI 0.5.8 was established by probing the real
package rather than from documentation:

- **Bun is required to render, not merely preferred.** `@opentui/core` imports fine on Node 24 (277 exports),
  but constructing a renderer throws `OpenTUI native FFI is not available for this runtime yet`: the Node
  backend requires `node:ffi`, which needs Node >= 26.4 with `--experimental-ffi`. The failure is at run time,
  not at import — so a smoke check that only imports the package reports a false success.
- **`babel-preset-solid` is mandatory.** The shipped `jsx-runtime` compiles under plain `tsc` and renders a
  correct first frame, but props are evaluated eagerly into object literals, so signals never propagate. There
  is no tsc-only path to a working app; the failure mode is a frozen frame rather than an error.
- **No executables are downloaded.** Native code ships as per-platform npm `optionalDependencies` with no
  install scripts, so `npm ci --ignore-scripts` produces a complete tree and Rocky's "never download
  executables" invariant is unaffected.
- **The renderer is testable headlessly.** `testRender` + `captureCharFrame` returns a deterministic character
  grid, so the client is covered without a model call.

## Decision

- **`packages/client` is a private workspace package that is never built.** Bun transpiles it from source;
  `main` points at `src/index.tsx`. Its OpenTUI/Solid dependencies are exact-pinned devDependencies.
- **Two gates, not one.** `npm run verify` stays Node-only and gains just `client:typecheck`. A separate
  `client:verify` (and a separate CI job with Bun installed) runs the Bun typecheck, the render tests, and the
  client smoke. Nothing Bun-only enters the Node gate.
- **The client consumes a `SessionPort`, not a session.** `src/contract/port.ts` declares two methods —
  `subscribe` and `execute` — over serializable values. `src/client-host/` builds a real port from the
  harness; the client never imports the harness, and tests drive it with a fake port.
- **Bun-only specifiers are held in variables**, not string literals, so the Node program does not attempt to
  resolve `@opentui/solid/preload` (no Node typings) or the client entry (`.tsx`, no `jsx` setting in the root
  config). They resolve at run time, which only happens under Bun.
- **Biome's `a11y` rules are disabled for `packages/client/**/*.tsx`.** The recommended preset applies DOM
  rules to OpenTUI's lowercase intrinsic tags, and `noStaticElementInteractions` demands an ARIA `role` that a
  terminal renderable cannot have. Formatter and all other rule groups stay active.
- **The transcript reducer is pure and lives in the Node gate.** `packages/client/src/model/transcript.ts`
  holds the logic most likely to be wrong — delta accumulation, block addressing, tool-result attachment — and
  is covered by the root Vitest suite. The Solid layer only maps its output to elements.

## Consequences

Every `npm ci`, including the Node-only `verify` job that never executes a line of client code, now downloads
the ~27 MB `@opentui/core-linux-x64` payload. This is accepted for now: the alternative is a second lockfile.
The root package is `private: true` with packaging deferred, so there is no user-install path this affects yet;
revisit when packaging is decided.

Two gates mean a Bun regression cannot fail the Node job, and vice versa — deliberate, since they exercise
genuinely different runtimes. The client smoke is run from the repository root rather than from
`packages/client`, so no `bunfig.toml` preload is in play and it exercises what the real launcher does:
register the transform first, then resolve the client through its bare specifier across the workspace symlink.
It asserts across two frames because a broken toolchain still renders the first one.

`state_changed` is declared in the contract but never emitted, so the client polls `get_state` after turn
boundaries. This is cheap in-process and must become a push before any transport exists.
