#!/usr/bin/env bash
# Retries a production deploy that Vercel refused. Vercel's Hobby plan allows 100
# deployments a day; a code merge can be refused ("api-deployments-free-per-day") and is
# never retried. The live job runs this after every run:
#
#   1. The deployed commit is VERCEL_GIT_COMMIT_SHA from the site's /api/live/health,
#      or, from a deployment that predates that field, the last successful Production
#      deployment GitHub recorded.
#   2. Main is deployable past it when a commit since changes a file outside data/live/
#      and docs/design/.
#   3. If the oldest such commit is more than LAG_MINUTES (20) old, it pushes an empty
#      commit to main, which Vercel builds (vercel.json's ignore step diffs against the
#      last successful deploy). At most one retry an hour and three a day, counted from
#      the retry commits on main. Past three, it opens one issue a day instead.
#
# It never fails: every problem is logged and the script exits 0. DRY_RUN=1 prints what
# it would push or open. Needs GH_TOKEN, GITHUB_REPOSITORY, git, gh, jq and curl.

SITE_URL="${SITE_URL:-https://548-sable.vercel.app}"
LAG_MINUTES="${LAG_MINUTES:-20}"
RETRY_SUBJECT="chore(deploy): retry production deploy"
DRY_RUN="${DRY_RUN:-0}"

log() { echo "[deploy-check] $*" >&2; }

deployed_commit() {
  local commit
  commit=$(curl -fsS --max-time 15 "$SITE_URL/api/live/health" 2>/dev/null | jq -r '.deployment.commit // empty' 2>/dev/null)
  if [ -n "$commit" ]; then
    log "production reports commit $commit (/api/live/health)."
    echo "$commit"
    return
  fi
  log "production does not report its commit; asking GitHub for the last successful Production deployment."
  local id state
  for id in $(gh api "repos/$GITHUB_REPOSITORY/deployments?environment=Production&per_page=10" --jq '.[].id' 2>/dev/null); do
    state=$(gh api "repos/$GITHUB_REPOSITORY/deployments/$id/statuses?per_page=1" --jq '.[0].state' 2>/dev/null)
    if [ "$state" = "success" ]; then
      commit=$(gh api "repos/$GITHUB_REPOSITORY/deployments/$id" --jq '.sha' 2>/dev/null)
      log "GitHub's last successful Production deployment is $commit."
      echo "$commit"
      return
    fi
  done
}

open_issue_once() {
  local title="$1" body="$2" seen
  seen=$(gh issue list --state all --search "\"$title\" in:title" --json title \
    --jq "[.[] | select(.title == \"$title\")] | length" 2>/dev/null)
  if [ "$seen" != "0" ]; then
    log "Already reported: $title"
    return
  fi
  if [ "$DRY_RUN" = "1" ]; then
    log "Dry run: would open issue \"$title\"."
    return
  fi
  gh issue create --title "$title" --body "$body" >/dev/null && log "Opened issue: $title"
}

check() {
  git fetch -q --no-tags --depth=200 origin main || { log "cannot fetch main; skipping."; return; }
  local main deployed
  main=$(git rev-parse origin/main)
  deployed=$(deployed_commit)
  if [ -z "$deployed" ]; then
    log "deployed commit unknown; skipping."
    return
  fi
  if ! git cat-file -e "$deployed^{commit}" 2>/dev/null; then
    git fetch -q --no-tags origin "$deployed" 2>/dev/null || true
  fi
  if ! git merge-base --is-ancestor "$deployed" "$main" 2>/dev/null; then
    log "deployed $deployed is not an ancestor of main $main (a rollback, or outside the fetched history); leaving it alone."
    return
  fi
  local pending
  pending=$(git log --format='%H %ct' "$deployed..$main" -- . ':(exclude)data/live' ':(exclude)docs/design')
  if [ -z "$pending" ]; then
    log "production is current: nothing deployable on main since $deployed (main is $main)."
    return
  fi
  local oldest oldest_time age count
  oldest=$(echo "$pending" | tail -n 1 | cut -d' ' -f1)
  oldest_time=$(echo "$pending" | tail -n 1 | cut -d' ' -f2)
  count=$(echo "$pending" | wc -l | tr -d ' ')
  age=$(( ($(date +%s) - oldest_time) / 60 ))
  log "production is at $deployed; main has $count deployable commit(s) since, the oldest $oldest from $age min ago."
  if [ "$age" -le "$LAG_MINUTES" ]; then
    log "within $LAG_MINUTES min; Vercel may still be building it."
    return
  fi
  local last_hour last_day
  last_hour=$(git log origin/main --since="1 hour ago" -F --grep="$RETRY_SUBJECT" --format=%H | wc -l | tr -d ' ')
  last_day=$(git log origin/main --since="24 hours ago" -F --grep="$RETRY_SUBJECT" --format=%H | wc -l | tr -d ' ')
  if [ "$last_day" -ge 3 ]; then
    log "three retries in 24 hours already; opening an issue instead."
    open_issue_once "Production deploy stuck on $(date -u +%F)" "Production is still at $deployed, but main has $count deployable commit(s) since; the oldest, $oldest, is $age minutes old. The live job pushed three empty commits in the last 24 hours to retry the deploy, and none reached production. Vercel may be refusing deployments (the Hobby plan allows 100 a day) or the build may be failing. Check the project's deployments on Vercel and redeploy main.

The forecasts themselves keep updating: the site reads live data from the live-data branch at request time.

cc @bilguutei2k"
    return
  fi
  if [ "$last_hour" -ge 1 ]; then
    log "already retried within the hour; waiting."
    return
  fi
  local retry
  retry=$(GIT_AUTHOR_NAME="github-actions[bot]" GIT_AUTHOR_EMAIL="41898282+github-actions[bot]@users.noreply.github.com" \
    GIT_COMMITTER_NAME="github-actions[bot]" GIT_COMMITTER_EMAIL="41898282+github-actions[bot]@users.noreply.github.com" \
    git commit-tree "$main^{tree}" -p "$main" -m "$RETRY_SUBJECT

Production is at $deployed; $oldest has waited $age minutes. Pushed by the live job's
deploy check (scripts/live/deploy-check.sh). Retry $((last_day + 1)) of at most 3 a day.")
  if [ "$DRY_RUN" = "1" ]; then
    log "Dry run: would push empty commit $retry to main (retry $((last_day + 1)) of 3 today)."
    return
  fi
  if git push -q origin "$retry:refs/heads/main"; then
    log "pushed empty commit $retry to main to retry the deploy (retry $((last_day + 1)) of 3 today)."
  else
    log "push to main failed (main moved?); the next run tries again."
  fi
}

check || true
exit 0
