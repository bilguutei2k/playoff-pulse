#!/usr/bin/env bash
# Opens one GitHub issue per UTC day while the live job keeps failing, which emails the
# owner. The live workflow runs it when scripts/live/chain-decision.sh says open_issue=1
# (this run failed, three or more failures in a row), with the title prefix
# "Live job failing", so the title is "Live job failing on <YYYY-MM-DD>" (UTC). The first
# failing run of the day opens it with that run's URL; later runs that day find it.
# Same pattern as report-alert.sh.
#
# Usage: scripts/live/failure-alert.sh "<title prefix>" "<failing run URL>" "<failures in a row>"
# Needs GH_TOKEN, gh and jq. ALERT_DATE overrides today's UTC date. DRY_RUN=1 prints the
# issue it would open instead of opening it. It never fails: every problem is logged and
# it exits 0, so it can never fail the job or stop the chain.

prefix="${1:-Live job failing}"
run_url="${2:-}"
streak="${3:-?}"
day="${ALERT_DATE:-$(date -u +%F)}"
title="$prefix on $day"

log() { echo "[failure-alert] $*" >&2; }

seen=$(gh issue list --state all --search "\"$title\" in:title" --json title \
  --jq "[.[] | select(.title == \"$title\")] | length" 2>/dev/null)
if [ "$seen" != "0" ]; then
  if [ -z "$seen" ]; then
    log "could not list issues; not opening one this run."
  else
    log "Already reported: $title"
  fi
  exit 0
fi
if [ "${DRY_RUN:-0}" = "1" ]; then
  log "Dry run: would open issue: $title"
  exit 0
fi
if gh issue create --title "$title" --body "The live forecast job has failed $streak runs in a row. Failing run: $run_url

Nothing is published while it fails; the site keeps serving the last good data from the live-data branch. The job keeps retrying about every 30 minutes, and one successful run brings it back to every 10 minutes. This issue opens at most once per UTC day while the failures continue.

cc @bilguutei2k" > /dev/null; then
  log "Opened issue: $title"
else
  log "could not open the issue; the next failing run tries again."
fi
exit 0
