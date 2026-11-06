// The live watchdog's decisions (.github/workflows/live-watchdog.yml, run by
// scripts/live/watchdog.mjs). Pure: no network, no git, no clock; tests/live-watchdog.test.ts.
//
// The watchdog is a second path on the same platform, not an external monitor: it runs on
// GitHub Actions like the job it watches, so a GitHub outage, a disabled Actions account or
// a lost schedule stops both. GitHub's schedule is also unreliable for this repository: it
// created 7 of live-forecast's 96 scheduled runs on 2026-11-04 and 2026-11-05 (UTC), so the
// watchdog may run far less often than its 15-minute cron asks.
//
// Decisions:
//   dispatch  Start the chain (a plain workflow_dispatch of live-forecast.yml on main) when
//             live-forecast is enabled, no real run was created in the last 25 minutes and
//             no real run is queued, waiting or in progress. A run that has shown as not
//             completed for over 90 minutes is not counted as active: a job is capped at 60
//             minutes, and on 2026-11-04 run 41860183917, whose job had finished at 15:50,
//             was not marked completed until 16:15, which is how the chain stalled then. A
//             duplicate dispatch is harmless: the concurrency group keeps one pending run.
//   alerts    Each with a stable key, so one condition is reported once per daily issue:
//             the chain restarted; live-forecast disabled other than by hand; state.json
//             older than 2.5 hours (or unreadable); a game that tipped more than 10 minutes
//             ago (within the last 24 hours) without a v2 final or v2 morning seal; three or
//             more failed real runs in a row (cancelled, skipped and stale runs are neutral,
//             as in scripts/live/chain-decision.sh).
//   paused    live-forecast was disabled by hand, which is how the chain is stopped: no
//             dispatch, no alerts.

export const LIMITS = Object.freeze({
  idleMinutes: 25,
  activeMinutes: 90,
  staleMinutes: 150,
  tipGraceMinutes: 10,
  tipLookbackHours: 24,
  failureStreak: 3,
});

/** The v2 model's version and the first ET date it sealed (2026-11-02). */
export const V2 = Object.freeze({ modelVersion: "live-2026.27-v2", firstEtDate: "2026-11-02" });

const MINUTE = 60_000;
const FAILED = new Set(["failure", "timed_out", "startup_failure"]);
const NEUTRAL = new Set(["cancelled", "skipped", "stale", "", null, undefined]);

/** Dry runs are labelled by live-forecast.yml's run-name and never count. */
export const isDryRun = (run) => (run.display_title ?? "").endsWith("(dry run)");

/**
 * Failed real runs in a row, newest first, and the oldest run of that streak.
 * @param {Array<{id: number, created_at: string, status: string, conclusion: string | null, display_title?: string}>} runs
 */
export function failureStreak(runs) {
  const completed = runs
    .filter((run) => !isDryRun(run) && run.status === "completed")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  let streak = 0;
  let since = null;
  for (const run of completed) {
    if (NEUTRAL.has(run.conclusion)) continue;
    if (!FAILED.has(run.conclusion)) break;
    streak += 1;
    since = run;
  }
  return { streak, since };
}

/**
 * @param {object} input
 * @param {string} input.now ISO time of this check.
 * @param {string | null} input.workflowState live-forecast.yml's state from the REST API
 *   ("active", "disabled_manually", ...), or null when it could not be read.
 * @param {Array<object> | null} input.runs live-forecast runs: the last day's plus every
 *   non-completed one; null when they could not be read.
 * @param {{generatedAt?: string} | null} input.state live-data's state.json, or null.
 * @param {Array<object> | null} input.games live-data's games file for the season, or null.
 * @param {Array<object> | null} input.ledger live-data's ledger rows for the season, or null.
 * @returns {{paused: boolean, dispatch: boolean, active: boolean | null, recent: boolean | null,
 *   streak: number | null, alerts: Array<{key: string, text: string}>}}
 */
export function decideWatchdog({ now, workflowState, runs, state, games, ledger }) {
  const time = Date.parse(now);
  if (!Number.isFinite(time)) throw new Error(`Invalid watchdog clock: ${now}`);
  if (workflowState === "disabled_manually") {
    return { paused: true, dispatch: false, active: null, recent: null, streak: null, alerts: [] };
  }
  const alerts = [];
  const enabled = workflowState === null || workflowState === "active";
  if (!enabled) {
    alerts.push({
      key: `workflow-${workflowState}`,
      text: `live-forecast.yml is ${workflowState}, so the chain cannot run; enable it in the Actions tab.`,
    });
  }

  let active = null;
  let recent = null;
  let streak = null;
  let dispatch = false;
  if (runs === null) {
    alerts.push({ key: "runs-unreadable", text: "Could not list live-forecast runs, so the chain was not checked or restarted." });
  } else {
    const real = runs.filter((run) => !isDryRun(run));
    const createdWithin = (run, minutes) => Date.parse(run.created_at) >= time - minutes * MINUTE;
    active = real.some((run) => run.status !== "completed" && createdWithin(run, LIMITS.activeMinutes));
    recent = real.some((run) => createdWithin(run, LIMITS.idleMinutes));
    dispatch = enabled && !active && !recent;
    if (dispatch) {
      alerts.push({
        key: "restart",
        text: `No real live-forecast run was created in the last ${LIMITS.idleMinutes} minutes and none is queued or running, so the watchdog started the chain.`,
      });
    }
    const failing = failureStreak(runs);
    streak = failing.streak;
    if (streak >= LIMITS.failureStreak) {
      alerts.push({
        key: `failing-since-${failing.since.id}`,
        text: `The live job has failed ${streak} real runs in a row (cancelled runs not counted), since run ${failing.since.id}${failing.since.html_url ? ` (${failing.since.html_url})` : ""}.`,
      });
    }
  }

  if (state) {
    const age = time - Date.parse(state.generatedAt);
    if (!Number.isFinite(age) || age > LIMITS.staleMinutes * MINUTE) {
      const hours = Number.isFinite(age) ? `${(age / 3_600_000).toFixed(1)} hours old` : "unreadable";
      alerts.push({
        key: `stale-${state.generatedAt}`,
        text: `live-data's state.json was generated at ${state.generatedAt ?? "(missing)"}, ${hours}; the limit is ${LIMITS.staleMinutes / 60} hours.`,
      });
    }
  }

  if (games && ledger) {
    const sealed = new Set(
      ledger
        .filter((row) => row.type === "seal" && row.modelVersion === V2.modelVersion && (row.sealKind === "final" || row.sealKind === "morning"))
        .map((row) => row.gameId),
    );
    for (const game of games) {
      const tip = Date.parse(game.tipUtc);
      if (
        game.etDate >= V2.firstEtDate &&
        game.status !== "canceled" &&
        game.status !== "postponed" &&
        Number.isFinite(tip) &&
        tip < time - LIMITS.tipGraceMinutes * MINUTE &&
        tip >= time - LIMITS.tipLookbackHours * 60 * MINUTE &&
        !sealed.has(game.id)
      ) {
        alerts.push({
          key: `unsealed-${game.id}`,
          text: `Game ${game.id} (${game.awayId ?? "?"} at ${game.homeId ?? "?"}, ET ${game.etDate}) tipped at ${game.tipUtc} and has neither a v2 final nor a v2 morning seal.`,
        });
      }
    }
  }

  return { paused: false, dispatch, active, recent, streak, alerts };
}

/** The keys a watchdog issue or comment already reported, from its hidden markers. */
export function reportedKeys(texts) {
  const keys = new Set();
  for (const text of texts) {
    for (const match of (text ?? "").matchAll(/<!-- live-watchdog: ([^>]*?) -->/g)) {
      for (const key of match[1].split(/\s+/).filter(Boolean)) keys.add(key);
    }
  }
  return keys;
}

/** The issue or comment body for new alerts, ending with the marker of their keys. */
export function alertBody({ now, dataCommit, runUrl, alerts }) {
  return [
    `Live watchdog at ${now}; live-data ${dataCommit ?? "unreadable"}.${runUrl ? ` Run: ${runUrl}` : ""}`,
    "",
    ...alerts.map((alert) => `- ${alert.text}`),
    "",
    "The watchdog runs on GitHub Actions like the job it watches: a second path, not an external monitor. It reports each condition once per daily issue. An issue notifies only people who watch the repository or are mentioned; it does not prove anyone read it.",
    "",
    "cc @bilguutei2k",
    `<!-- live-watchdog: ${alerts.map((alert) => alert.key).join(" ")} -->`,
  ].join("\n");
}
