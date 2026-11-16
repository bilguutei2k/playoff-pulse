#!/usr/bin/env bash
# Retries a production deploy that Vercel refused. Vercel's Hobby plan allows 100
# deployments a day; a code merge can be refused ("api-deployments-free-per-day") and is
# never retried. The live job runs this after every run:
#
#   1. The deployed commit is VERCEL_GIT_COMMIT_SHA from the site's /api/live/health,
#      or, from a deployment that predates that field, the last successful Production
#      deployment GitHub recorded. Production that is not an ancestor of main is left
#      alone.
#   2. Main is deployable past it when a commit since changes a file outside data/live/
#      and docs/design/.
#   3. Vercel's own word comes first: the newest commit status with context "Vercel" on
#      main's HEAD (gh api repos/$GITHUB_REPOSITORY/commits/<main>/statuses).
#        pending          Vercel is deploying: wait, unless the status has been pending for
#                         over PENDING_MAX_MINUTES (60; a build takes about a minute), when
#                         it counts as stuck and a retry is due.
#        success          Vercel deployed main, yet production is older: a rollback or a
#                         manual promotion. Logged and never retried; retrying would undo it.
#        failure, error   eligible for a retry.
#        none             eligible only when the oldest deployable commit landed on main
#                         more than LAG_MINUTES (20) ago.
#      Unreadable: no retry this run.
#   4. When it landed is the timestamp GitHub's repository activity records for the push
#      or merge that first made that commit reachable from main (gh api
#      "repos/$GITHUB_REPOSITORY/activity?ref=refs/heads/main&per_page=100", walked
#      oldest-first with git merge-base --is-ancestor), never the commit's own time: a
#      commit authored an hour before its merge is not an hour late. On 2026-11-12 and
#      2026-11-14 the committer time made this push a retry 15 and 25 seconds after a merge
#      Vercel was already deploying. Activity unreadable, or no entry found: no retry this
#      run (a retry is cheap to postpone and scarce to spend).
#   5. Then it pushes an empty commit to main, which Vercel builds (vercel.json's ignore
#      step diffs against the last successful deploy). At most one retry an hour and three
#      a day, counted from the retry commits on main. Past three, it opens one issue a day
#      instead.
#
# It never fails: every problem is logged and the script exits 0. DRY_RUN=1 prints what
# it would push or open. Needs GH_TOKEN, GITHUB_REPOSITORY, git, gh, jq and curl.

SITE_URL="${SITE_URL:-https://548-sable.vercel.app}"
LAG_MINUTES="${LAG_MINUTES:-20}"
PENDING_MAX_MINUTES="${PENDING_MAX_MINUTES:-60}"
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

# The newest "Vercel" commit status of $1 and its age in whole minutes: "pending 3",
# "success 50", "failure 0", "error 0", or "none 0". Fails when the statuses cannot be read.
vercel_status() {
  local json
  json=$(gh api "repos/$GITHUB_REPOSITORY/commits/$1/statuses" 2>/dev/null) || return 1
  printf '%s' "$json" | jq -er '[.[] | select(.context == "Vercel")] | sort_by(.updated_at // .created_at) | (last // {}) as $s
    | if $s.state == null then "none 0"
      else "\($s.state) \((($s.updated_at // $s.created_at // null) as $t | if $t == null then 0 else ((now - ($t | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601)) / 60 | floor) end))"
      end' 2>/dev/null
}

# Minutes since GitHub recorded the push or merge that first made $1 reachable from main.
# Returns 1 when the activity cannot be read, 2 when no entry made it reachable.
landed_minutes() {
  local json entries after timestamp
  json=$(gh api "repos/$GITHUB_REPOSITORY/activity?ref=refs/heads/main&per_page=100" 2>/dev/null) || return 1
  entries=$(printf '%s' "$json" | jq -er 'sort_by(.timestamp) | .[] | select((.after // "") != "" and (.timestamp // "") != "") | "\(.after) \(.timestamp)"' 2>/dev/null)
  case $? in 0 | 4) ;; *) return 1 ;; esac
  while read -r after timestamp; do
    [ -n "$after" ] || continue
    if git merge-base --is-ancestor "$1" "$after" 2>/dev/null; then
      jq -nr --arg t "$timestamp" '((now - ($t | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601)) / 60) | floor'
      return 0
    fi
  done <<< "$entries"
  return 2
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
  pending=$(git log --format='%H' "$deployed..$main" -- . ':(exclude)data/live' ':(exclude)docs/design')
  if [ -z "$pending" ]; then
    log "production is current: nothing deployable on main since $deployed (main is $main)."
    return
  fi
  local oldest count status landed why
  oldest=$(echo "$pending" | tail -n 1)
  count=$(echo "$pending" | wc -l | tr -d ' ')
  log "production is at $deployed; main has $count deployable commit(s) since, the oldest $oldest."
  local status_age
  if ! status=$(vercel_status "$main"); then
    log "cannot read Vercel's commit status of $main; no retry this run."
    return
  fi
  status_age=${status#* }
  status=${status%% *}
  case "$status" in
    pending)
      if [ "$status_age" -le "$PENDING_MAX_MINUTES" ]; then
        log "Vercel is deploying $main (commit status pending); waiting."
        return
      fi
      why="Vercel's commit status of $main has been pending for $status_age minutes"
      log "$why, over $PENDING_MAX_MINUTES; treating the deploy as stuck, a retry is due." ;;
    success)
      log "Vercel reports $main deployed (commit status success), yet production is at $deployed: a rollback or a manual promotion. Leaving it alone; this is never retried."
      return ;;
    failure | error)
      why="Vercel's commit status of $main is $status"
      log "$why; a retry is due." ;;
    none)
      landed=$(landed_minutes "$oldest")
      case $? in
        0) ;;
        1) log "cannot read main's repository activity, so when $oldest landed is unknown; no retry this run."; return ;;
        *) log "no push or merge in main's repository activity made $oldest reachable; no retry this run."; return ;;
      esac
      log "Vercel has set no status on $main; $oldest landed on main $landed min ago (repository activity)."
      if [ "$landed" -le "$LAG_MINUTES" ]; then
        log "within $LAG_MINUTES min of landing; Vercel may not have started on it yet."
        return
      fi
      why="$oldest landed on main $landed minutes ago and Vercel has set no status on $main" ;;
    *)
      log "unexpected Vercel commit status \"$status\" on $main; no retry this run."
      return ;;
  esac
  local last_hour last_day
  last_hour=$(git log origin/main --since="1 hour ago" -F --grep="$RETRY_SUBJECT" --format=%H | wc -l | tr -d ' ')
  last_day=$(git log origin/main --since="24 hours ago" -F --grep="$RETRY_SUBJECT" --format=%H | wc -l | tr -d ' ')
  if [ "$last_day" -ge 3 ]; then
    log "three retries in 24 hours already; opening an issue instead."
    open_issue_once "Production deploy stuck on $(date -u +%F)" "Production is still at $deployed, but main has $count deployable commit(s) since, the oldest $oldest; $why. The live job pushed three empty commits in the last 24 hours to retry the deploy, and none reached production. Vercel may be refusing deployments (the Hobby plan allows 100 a day) or the build may be failing. Check the project's deployments on Vercel and redeploy main.

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

Production is at $deployed; $why. Pushed by the live job's
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
