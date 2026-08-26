---
description: Take the current branch's work from committed to merged — gates, PR, CI, squash-merge, sync.
argument-hint: "[PR title, or an issue number to close]"
allowed-tools: Bash, Read, Edit
---

Ship the current branch. `$ARGUMENTS` is either a PR title, an issue number (`19`, `#19`), or empty.

Do not ask for confirmation between steps. Stop and report only on a real failure.

## 1. Check the starting state

```bash
git branch --show-current && git status --short && git log --oneline origin/main..HEAD
```

- On `main` with changes: create a branch first (`<type>/<short-slug>`, type matching the commit type). Never
  push `main` — it rejects direct pushes.
- Nothing committed and nothing uncommitted: stop, say there is nothing to ship.
- Uncommitted changes: commit them per `CONTRIBUTING.md` — Conventional Commits with an area scope, a body
  saying what was wrong and why this is right, `Closes #N` when `$ARGUMENTS` names an issue, and never a
  `Co-Authored-By` or AI attribution line.

## 2. Update the paper trail before pushing

Check whether these need an entry for this change, and add it if so:

- `CHANGELOG.md` under `## Unreleased` — for anything user- or contributor-visible. Say what was wrong, not
  just what changed.
- `docs/roadmap.md` — when the change completes, adds, or reshapes a roadmap item or a carried debt.
- `docs/decisions/` — only when `docs/decisions/README.md`'s threshold is met.

## 3. Run the gates

```bash
npm run verify
```

Add `npm run client:verify` when the diff touches `packages/client/`, `src/contract/`, or `scripts/client*`.
Record the test counts — the PR body reports them.

Fix any failure and re-run. Do not proceed on red.

## 4. Push and open the PR

```bash
git push -u origin HEAD
```

The pre-push hook re-runs the gates; that is expected, not a duplicate to skip.

Open the PR with `gh pr create`, filling `.github/pull_request_template.md`:

- **Summary** — what was wrong and what this does about it. Not a file list.
- **Verification** — real Pass/Fail/Skip with counts, in `docs/verification.md`'s format. Never assume a pass.
- **Security and trust impact** — "None" only when resource loading, tools, credentials, persistence, and
  network behavior are all genuinely untouched.

Title = the squash-merge commit subject, so write it as a Conventional Commit.

## 5. Wait for CI, then merge

```bash
until [ "$(gh pr checks --json bucket --jq 'all(.[]; .bucket != "pending")')" = "true" ]; do sleep 15; done
gh pr checks
```

Run that wait with `run_in_background: true` rather than blocking.

- Green → `gh pr merge --squash --delete-branch`, then `git checkout main && git pull --ff-only`.
- Red → report the failing job and its log. **Do not merge and do not force.**

## 6. Report

The PR URL, the merged commit on `main`, the gate results with counts, and any issue that closed.
