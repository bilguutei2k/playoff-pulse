#!/usr/bin/env bash
# Commits data/live to live-data and pushes it. The live workflow runs it after the
# pipeline and the ledger checks ("Commit and push data to live-data");
# tests/live-data-git.test.ts runs it against a throwaway origin.
#
# The commit's tree is DATA_BASE's tree with data/live replaced by the working tree's
# data/live, built in a temporary index, so live-data's other files (vercel.json included)
# stay as they were cut from main and the real index and main's checkout are untouched.
# Its parent is DATA_BASE, so the push is a fast-forward (never forced).
#
#   - Nothing changed: prints "No real change to publish." and pushes nothing. On a
#     bootstrap it creates live-data at main's HEAD instead.
#   - vercel.json in the new tree must keep git.deploymentEnabled["live-data"] false,
#     or it refuses to push and exits 1 (a dry run only prints the error).
#   - DRY_RUN=1 prints the diff and the push it would make, and pushes nothing.
#
# Needs DATA_BRANCH, DATA_BASE and DATA_BOOTSTRAP (from data-checkout.sh), RUNNER_TEMP,
# the GIT_AUTHOR_* / GIT_COMMITTER_* identity, git and jq.
set -euo pipefail

: "${DATA_BRANCH:?DATA_BRANCH is not set}"
: "${DATA_BASE:?DATA_BASE is not set}"
: "${DATA_BOOTSTRAP:?DATA_BOOTSTRAP is not set}"
: "${RUNNER_TEMP:?RUNNER_TEMP is not set}"
DRY_RUN="${DRY_RUN:-0}"

export GIT_INDEX_FILE="$RUNNER_TEMP/live-data.index"
git read-tree "$DATA_BASE"
# Stage data/live exactly as the pipeline left it, deletions included. The temporary
# index holds live-data's tree, which differs from main's, so `git rm --cached` would
# refuse those paths once the branches diverge.
git add -A -- data/live
tree=$(git write-tree)
if [ "$tree" = "$(git rev-parse "$DATA_BASE^{tree}")" ]; then
  if [ "$DATA_BOOTSTRAP" = "0" ]; then
    echo "No real change to publish."
    exit 0
  fi
  commit="$DATA_BASE"
else
  commit=$(git commit-tree "$tree" -p "$DATA_BASE" -m "chore(live): update forecasts")
fi
if ! git show "$tree:vercel.json" | jq -e '.git.deploymentEnabled["live-data"] == false' > /dev/null; then
  echo "::error::vercel.json in live-data's tree does not turn off deployments for live-data; refusing to push."
  if [ "$DRY_RUN" != "1" ]; then
    exit 1
  fi
fi
if [ "$DATA_BOOTSTRAP" = "1" ]; then
  what="create $DATA_BRANCH at $commit, cut from main's HEAD $DATA_BASE"
else
  what="fast-forward $DATA_BRANCH from $DATA_BASE to $commit"
fi
git diff --stat "$DATA_BASE" "$commit" | tail -n 25
if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run: would $what (git push origin $commit:refs/heads/$DATA_BRANCH)."
  exit 0
fi
for attempt in 1 2; do
  if git push origin "$commit:refs/heads/$DATA_BRANCH"; then
    echo "Pushed: $what."
    exit 0
  fi
  echo "Push attempt $attempt failed."
  sleep "${PUSH_RETRY_SECONDS:-15}"
done
exit 1
