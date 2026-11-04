#!/usr/bin/env bash
# Replaces the checkout's data/live with live-data's copy, so the run executes main's code
# on live-data's data. The live workflow runs it right after checking out main's code
# ("Check out data/live from live-data"); tests/live-data-git.test.ts runs it against a
# throwaway origin.
#
# If live-data does not exist yet, the run bootstraps it: the base is main's HEAD, and
# data-commit.sh creates the branch there.
#
# Needs DATA_BRANCH and GITHUB_ENV, and a checkout whose `origin` holds main. Appends
# DATA_BASE (the commit data/live came from) and DATA_BOOTSTRAP (1 when live-data does not
# exist yet, else 0) to GITHUB_ENV. Only data/live changes in the working tree; the index
# is left at HEAD (main's code).
set -euo pipefail

: "${DATA_BRANCH:?DATA_BRANCH is not set}"
: "${GITHUB_ENV:?GITHUB_ENV is not set}"

git fetch --no-tags --depth=20 origin main
echo "Code: $(git rev-parse --abbrev-ref HEAD) at $(git rev-parse HEAD)."
if git fetch --no-tags --depth=20 origin "+refs/heads/$DATA_BRANCH:refs/remotes/origin/$DATA_BRANCH"; then
  base=$(git rev-parse "origin/$DATA_BRANCH")
  bootstrap=0
  echo "Data: $DATA_BRANCH at $base."
else
  base=$(git rev-parse origin/main)
  bootstrap=1
  echo "Data: $DATA_BRANCH does not exist yet; this run bootstraps it from main's HEAD $base."
fi
rm -rf data/live
git checkout "$base" -- data/live
git reset -q
echo "DATA_BASE=$base" >> "$GITHUB_ENV"
echo "DATA_BOOTSTRAP=$bootstrap" >> "$GITHUB_ENV"
