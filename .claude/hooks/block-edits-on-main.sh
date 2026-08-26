#!/usr/bin/env bash
#
# Refuse Edit/Write while HEAD is on main.
#
# `main` requires both CI jobs green and rejects direct pushes, so anything
# edited here has to be moved to a branch before it can land. Blocking at the
# edit is cheaper than discovering it at the push.
#
# Only guards files inside this repository: an edit to ~/.claude or /tmp is not
# repository work and is none of this hook's business.
set -uo pipefail

payload="$(cat)"
file="$(jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' <<<"$payload" 2>/dev/null || true)"

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$repo_root" ] || exit 0

# An edit outside the repo (or with no path at all) is not ours to police.
if [ -n "$file" ]; then
  case "$file" in
    "$repo_root"/*) ;;
    /*) exit 0 ;;
  esac
fi

branch="$(git -C "$repo_root" branch --show-current 2>/dev/null || true)"
[ "$branch" = "main" ] || exit 0

jq -n --arg r "Refusing to edit on main: it requires both CI jobs green and rejects direct pushes, so this change cannot land from here. Create a branch first — git checkout -b <type>/<slug>, per CONTRIBUTING.md — then retry the edit." \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
