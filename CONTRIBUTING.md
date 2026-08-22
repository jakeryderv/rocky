# Contributing

1. Open a focused issue or PR; discuss changes to runtime, trust, persistence, or public CLI boundaries first.
2. Use Node 24 and install with `npm ci --ignore-scripts`.
3. Keep changes small, documented, credential-free, and covered by deterministic tests.
4. Run `npm run verify` and report Pass/Fail/Skip results. Run `npm run security:audit` separately when online.
5. Do not commit generated artifacts or secrets.

Create an ADR only when the threshold in [`docs/decisions/README.md`](docs/decisions/README.md) is met.
