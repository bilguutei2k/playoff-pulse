#!/usr/bin/env bash
# Opens one GitHub issue per slate when the live job's health file has a report problem
# (`reportProblem` in data/live/health.json), which emails the owner. The live workflow
# runs it after every publish with the title prefix "Injury report problem"; the
# report-alert-test workflow runs it with a fake problem and its own prefix.
#
# Usage: scripts/live/report-alert.sh "<title prefix>"
# Needs GH_TOKEN and jq. HEALTH_FILE and STATE_FILE override data/live/health.json and
# data/live/state.json. DRY_RUN=1 prints the issue it would open instead of opening it.
set -euo pipefail

prefix="${1:?usage: report-alert.sh \"<title prefix>\"}"
health_file="${HEALTH_FILE:-data/live/health.json}"
state_file="${STATE_FILE:-data/live/state.json}"

problem=$(jq -r '.reportProblem // empty' "$health_file")
if [ -z "$problem" ]; then
  exit 0
fi
slate=$(jq -r '.slateEtDate' "$state_file")
title="$prefix on $slate"
seen=$(gh issue list --state all --search "\"$title\" in:title" --json title \
  --jq "[.[] | select(.title == \"$title\")] | length")
if [ "$seen" != "0" ]; then
  echo "Already reported: $title"
  exit 0
fi
if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "Dry run: would open issue: $title"
  exit 0
fi
gh issue create --title "$title" --body "$problem

Until this clears, forecasts on $slate may not reflect injuries. The site says so on each game, and morning seals are reissued automatically once a usable report arrives.

cc @bilguutei2k"
