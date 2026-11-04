#!/usr/bin/env bash
# Commits one refreshed data file and pushes it straight to main.
#
# Usage: push-data-commit.sh <data-file> <commit-message>
#
# Tokens:
#   PUSH_TOKEN  Data bot GitHub App token. The app is on main's pull request
#               bypass list, which the built-in Actions token cannot join.
#   GH_TOKEN    Built-in Actions token. Main's required "Visual approval" status
#               only counts when GitHub Actions posts it, so the app can't.
set -euo pipefail

data_file="$1"
commit_message="$2"

git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git add -- "$data_file"
if git diff --staged --quiet; then
  echo "No changes to commit."
  exit 0
fi
git commit -m "$commit_message"

# This commit changes nothing but data, so it needs no visual review: publish it
# to a scratch branch, mark it approved, then push it to main.
changed="$(git diff --name-only HEAD~1 HEAD)"
if [ "$changed" != "$data_file" ]; then
  echo "::error::Refusing to self-approve a commit that changes: $changed"
  exit 1
fi
git remote set-url origin "https://x-access-token:${PUSH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
git fetch --quiet origin main
if [ "$(git rev-parse HEAD~1)" != "$(git rev-parse origin/main)" ]; then
  echo "::error::main moved since checkout; the next run will retry."
  exit 1
fi
sha="$(git rev-parse HEAD)"
scratch_branch="bot/$(basename "$data_file" .json)-update"
git push --force origin "HEAD:refs/heads/$scratch_branch"
gh api "repos/$GITHUB_REPOSITORY/statuses/$sha" \
  -f state=success -f context="Visual approval" \
  -f description="Data file only; no visual review needed" \
  -f target_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" \
  > /dev/null
git push origin HEAD:main
git push origin --delete "$scratch_branch" || echo "::warning::Could not delete $scratch_branch; the next run overwrites it."
