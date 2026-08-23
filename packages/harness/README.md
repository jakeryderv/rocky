# @jakeryderv/rocky-harness

Rocky's coding-agent harness: a source fork of
[`@earendil-works/pi-coding-agent`](https://github.com/earendil-works/pi) at tag `v0.84.2`
(commit `914cf1472e715297caa30db4b9535d534a9eb718`), MIT licensed. The pristine vendor commit in this
repository's history is the fork baseline; every Rocky change since is reviewable as diffs against it.

Rocky-specific deviations from upstream (see ADR 0003 in `../../docs/decisions/`):

- Identity from this package's `piConfig` (`rocky`, `.rocky`, `ROCKY_*` environment names).
- No startup version check, self-update, or install reporting.
- Managed `fd`/`rg` downloader disabled: system-installed binaries only.
- Under Bun, the undici global-fetch installation is skipped in favor of native fetch.
- Extension virtual imports accept `@jakeryderv/rocky-harness` alongside the upstream specifiers.
- `CHANGELOG.md` is Rocky's; upstream history lives in `CHANGELOG.upstream.md`.

The original upstream README is preserved as [README.upstream.md](README.upstream.md). The `docs/` and
`examples/` directories are upstream's (still pi-worded); they remain functionally accurate for the
inherited behavior. Upstream fixes are cherry-picked by hand; upstream `pi-*` dependencies are exactly
pinned and upgraded deliberately.

Build and test:

```bash
npm run build --workspace @jakeryderv/rocky-harness
npm test --workspace @jakeryderv/rocky-harness
```
