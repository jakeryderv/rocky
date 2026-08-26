# Contributing

## Before you change anything

1. Discuss changes to runtime, trust, persistence, or public CLI boundaries first — open an issue.
2. Use Node 24, install with `npm ci --ignore-scripts`, then run `npm run hooks:install` once to enable the
   pre-push gate (`--ignore-scripts` means npm lifecycle hooks never fire, so this is not automatic).
3. Create an ADR only when the threshold in [`docs/decisions/README.md`](docs/decisions/README.md) is met.

## Git workflow

`main` is protected: it rejects deletions and force-pushes, and requires both CI jobs (`verify` and `client`)
to pass. Direct pushes to `main` are therefore not possible — work goes through a pull request.

```bash
git checkout -b <type>/<short-slug>     # e.g. feat/slash-commands
# ... work, committing as you go ...
git push -u origin HEAD                  # pre-push runs the gates
gh pr create --fill
# ... CI green ...
gh pr merge --squash --delete-branch
```

**Branch names** are `<type>/<short-slug>`, where `<type>` matches the commit type below.

**Commits** follow Conventional Commits with an optional scope: `type(scope): subject`.

| Type | Use |
| --- | --- |
| `feat` | new behavior |
| `fix` | corrected behavior |
| `docs` | documentation only |
| `test` | tests only |
| `chore` | dependencies, tooling, cleanup |
| `ci` | workflow and automation |

Scopes are the area, not the file: `client`, `contract`, `harness`, `deps`. The subject is lowercase,
imperative, and no more than about 72 characters.

The body matters more than the subject. Say what was wrong and why the change is right — a defect's commit
should let a reader reconstruct the failure without checking out the code. Reference issues with
`Closes #N`. Do not add `Co-Authored-By` or AI attribution lines.

**Merging** is squash-and-merge, so the PR title becomes the commit subject on `main` — write it as a
conventional commit.

## Verification

Run `npm run verify` before marking work complete, and `npm run client:verify` as well when the change
touches `packages/client/`, `src/contract/`, or the client scripts. Report results as Pass/Fail/Skip in the
format in [`docs/verification.md`](docs/verification.md). Run `npm run security:audit` separately when
online.

The pre-push hook runs both gates for you and picks the Bun one based on what changed. `git push --no-verify`
bypasses it; CI does not.

## Rules

- Keep changes small, documented, credential-free, and covered by deterministic tests.
- Do not commit generated artifacts (`dist/`, `coverage/`, `reports/`) or secrets.
- Keep `npm-shrinkwrap.json` current when dependencies change.
- The invariants in [`AGENTS.md`](AGENTS.md) apply to human contributors too.
