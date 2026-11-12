#!/usr/bin/env bash
# Opens one GitHub issue per slate when the live job's health file reports a problem, which
# emails the owner. FIELD picks the problem: `reportProblem` (the default; injury reports
# are not reaching the forecasts), `viewsProblem` (the model views were not published:
# projections, team injury lists and player pages) or `scoreProblem` (the player index was
# published without the 548 score). The live workflow runs it after every publish, once per
# field, with the title prefixes "Injury report problem", "Model views problem" and "548
# score problem"; the report-alert-test workflow runs it with a fake problem and its own prefix.
#
# Usage: scripts/live/report-alert.sh "<title prefix>" [reportProblem|viewsProblem|scoreProblem]
# Needs GH_TOKEN and jq. HEALTH_FILE and STATE_FILE override data/live/health.json and
# data/live/state.json. DRY_RUN=1 prints the issue it would open instead of opening it.
set -euo pipefail

prefix="${1:?usage: report-alert.sh \"<title prefix>\" [reportProblem|viewsProblem|scoreProblem]}"
field="${2:-reportProblem}"
health_file="${HEALTH_FILE:-data/live/health.json}"
state_file="${STATE_FILE:-data/live/state.json}"
case "$field" in
  reportProblem | viewsProblem | scoreProblem) ;;
  *) echo "report-alert.sh: unknown field $field" >&2; exit 2 ;;
esac

problem=$(jq -r --arg field "$field" '.[$field] // empty' "$health_file")
if [ -z "$problem" ]; then
  exit 0
fi
slate=$(jq -r '.slateEtDate' "$state_file")
title="$prefix on $slate"
if [ "$field" = viewsProblem ]; then
  consequence="The model views (projections, team injury lists and player pages) were not published, so the site shows none of them until a later run publishes them. Seals and the record are unaffected."
elif [ "$field" = scoreProblem ]; then
  consequence="The player index was published with every 548 score empty, so player pages and tables show a dash for it until a later run computes it. The 548 score is not a forecast input: forecasts, seals, the record and every other view are unaffected."
else
  consequence="Until this clears, forecasts on $slate may not reflect injuries. The site says so on each game, and morning seals are reissued automatically once a usable report arrives."
fi
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

$consequence

cc @bilguutei2k"
