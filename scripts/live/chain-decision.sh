#!/usr/bin/env bash
# Decides how the live job's self-dispatching chain continues after a run. The chain never
# stops on its own: after BACKOFF_AFTER (3) failures in a row it keeps dispatching, but the
# next run waits about BACKOFF_WAIT (30) minutes instead of NORMAL_WAIT (10). One success
# brings it back to 10. A failing run at or past the threshold also asks for the
# once-a-day issue (scripts/live/failure-alert.sh).
#
# Usage: scripts/live/chain-decision.sh <this run's job.status> [<earlier conclusion> ...]
#   The earlier conclusions are completed real (not dry) runs, most recent first.
#   failure, timed_out and startup_failure count as failures. cancelled, skipped and stale
#   runs are neutral (including pending runs displaced by concurrency). Anything else ends the streak.
#   This run's own "cancelled" is passed over the same way.
#
# Prints, for $GITHUB_OUTPUT:
#   streak=<failures in a row, this run included>
#   wait_minutes=<how long the next run waits: 10 or 30>
#   open_issue=<1 when this run failed and streak >= 3, else 0>
# and one sentence on stderr for the log. Pure: no network, no git.
set -euo pipefail

BACKOFF_AFTER=3
NORMAL_WAIT=10
BACKOFF_WAIT=30

this="${1:?usage: chain-decision.sh <this-run-status> [<earlier-conclusion> ...]}"
shift

kind() {
  case "$1" in
    failure | timed_out | startup_failure) echo failure ;;
    cancelled | skipped | stale | "") echo none ;;
    *) echo success ;;
  esac
}

this_kind=$(kind "$this")
streak=0
if [ "$this_kind" != success ]; then
  if [ "$this_kind" = failure ]; then
    streak=1
  fi
  for conclusion in "$@"; do
    case "$(kind "$conclusion")" in
      failure) streak=$((streak + 1)) ;;
      none) ;;
      success) break ;;
    esac
  done
fi

if [ "$streak" -ge "$BACKOFF_AFTER" ]; then
  wait_minutes=$BACKOFF_WAIT
else
  wait_minutes=$NORMAL_WAIT
fi
open_issue=0
if [ "$this_kind" = failure ] && [ "$streak" -ge "$BACKOFF_AFTER" ]; then
  open_issue=1
fi

echo "streak=$streak"
echo "wait_minutes=$wait_minutes"
echo "open_issue=$open_issue"
if [ "$streak" -ge "$BACKOFF_AFTER" ]; then
  echo "This run: $this. $streak failures in a row; backing off: the next run waits about $wait_minutes minutes." >&2
else
  echo "This run: $this. $streak failure(s) in a row; the next run waits about $wait_minutes minutes." >&2
fi
