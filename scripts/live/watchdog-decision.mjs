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
//   alerts    Each with a stable key and a kind. A `state` persists until a run checks it
//             and finds it clear; an `event` happened once. States: live-forecast disabled
//             other than by hand; live-forecast disabled other than by hand; state.json
//             older than 2.5 hours (or unreadable); a game that tipped more than 10 minutes
//             ago (within the last 24 hours) without a v2 final or v2 morning seal; three or
//             more failed real runs in a row (cancelled, skipped and stale runs are neutral,
//             as in scripts/live/chain-decision.sh); a read that failed (`unreadable-*`,
//             `runs-unreadable`). Events: the chain restarted; the dispatch failed.
//   paused    live-forecast was disabled by hand, which is how the chain is stopped: no
//             dispatch, no alerts.
//   site      (siteAlerts, on the probe planned by probePlan) What readers get, judged by the
//             quiet-period rule at the top of src/lib/view/freshness.ts: a page whose state
//             stamp matches a healthy /api/live/health is fine however long ago that state
//             was published, so nothing is judged on age or on the `age` header. Each key
//             names one cause and stays the same while the cause lasts:
//               site-behind-publication  health's generatedAt is more than 15 minutes behind
//                                        live-data's state.json (read from git): the server
//                                        is not delivering what was published.
//               site-stored-copy         health says delivery "stored": the server is
//                                        rendering the copy bundled at build time.
//               health-unknown           health could not be read; no page is then compared
//                                        with it.
//               page-behind-<path>-<kind>          the page's stamp is more than 15 minutes
//                                                  behind health's (page and health render
//                                                  from the same state within seconds).
//               page-cached-<path>-<kind>          x-vercel-cache PRERENDER, HIT or STALE:
//                                                  every page renders at request time, so a
//                                                  cached copy is a regression.
//               page-stamp-unreadable-<path>-<kind> a 200 without a readable stamp.
//               page-error-<path>-<kind>           a status other than 200, or no answer.
//             <kind> is `html` (a plain GET) or `rsc` (the same URL with `RSC: 1`, which is
//             what a client-side navigation fetches). Before 2026-11-16 every page route was
//             a static prerender, and Vercel served the build-time copy of a quiet route
//             (`PRERENDER`, issues #25 to #33); `/` and `/record` were 2,710 minutes behind.
//
//             Seen twice. A publication takes some seconds to reach every server instance
//             (each keeps the data branch's head for 15 seconds, HEAD_TTL_MS in
//             src/lib/live-data/published.ts), so a reading taken just after one can show
//             health on the previous publication, or a page and health on either side of
//             it; after quiet hours that looks hours behind. `site-behind-publication` and
//             `page-behind-*` therefore count only when a second reading of the site,
//             PROBE_LIMITS.recheckSeconds later, shows them too (mustPersist,
//             settledSiteAlerts); the runner reads again only when the first reading
//             shows one.
//
// The probe (probePlan): PROBE_ROUTES (the nav, the footer's /about and the five archive
// pages; tests/live-watchdog.test.ts keeps it equal to the links the site shows) plus
// yesterday's ET day page. Each run reads health, `/` and one route rotating every 15
// minutes as HTML; the run whose UTC minute is under 15 also reads `/` and one route
// rotating every hour as RSC. While an incident is open, each run also rereads the routes
// its open page conditions name, so they can be seen clear. PROBE_ALL=1 reads every route
// in both forms (the production acceptance check after a deploy).

export const LIMITS = Object.freeze({
  idleMinutes: 25,
  activeMinutes: 90,
  staleMinutes: 150,
  tipGraceMinutes: 10,
  tipLookbackHours: 24,
  failureStreak: 3,
});

/**
 * Every route the site links from its nav and footer. Yesterday's day page is added at run
 * time (probeRoutes). tests/live-watchdog.test.ts fails when a nav or footer link is missing.
 */
export const PROBE_ROUTES = Object.freeze([
  "/",
  "/odds",
  "/injuries",
  "/players",
  "/teams",
  "/record",
  "/how-it-works",
  "/about",
  "/retrospective",
  "/snapshot",
  "/evidence",
  "/methodology",
  "/lab",
]);

/**
 * The probe's limits: how far behind (minutes) health may be of the publication and a page
 * of health, the rotation step, the UTC minutes of the hour in which RSC is read too, and
 * how long the runner waits before the second reading that a "behind" condition needs.
 */
export const PROBE_LIMITS = Object.freeze({ behindMinutes: 15, rotationMinutes: 15, rscBeforeMinute: 15, recheckSeconds: 45 });

/** x-vercel-cache values that mean a stored copy was served instead of a render. */
const CACHED = new Set(["PRERENDER", "HIT", "STALE"]);

/** The v2 model's version and the first ET date it sealed (2026-11-02). */
export const V2 = Object.freeze({ modelVersion: "live-2026.27-v2", firstEtDate: "2026-11-02" });

/**
 * The shadow model v4 (docs/live/registration-v4.md, W3): its version and first ET date, kept
 * equal to src/lib/season/params-v4.ts by a test. Null until v4's cutover is set. Its missing
 * seals are reported under their own `shadow-` keys, labelled as the shadow model's.
 */
export const V4 = Object.freeze({ modelVersion: "live-2026.27-v4", firstEtDate: null });

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
    alerts.push({ kind: "state",
      key: `workflow-${workflowState}`,
      text: `live-forecast.yml is ${workflowState}, so the chain cannot run; enable it in the Actions tab.`,
    });
  }

  let active = null;
  let recent = null;
  let streak = null;
  let dispatch = false;
  if (runs === null) {
    alerts.push({ kind: "state", key: "runs-unreadable", text: "Could not list live-forecast runs, so the chain was not checked or restarted." });
  } else {
    const real = runs.filter((run) => !isDryRun(run));
    const createdWithin = (run, minutes) => Date.parse(run.created_at) >= time - minutes * MINUTE;
    active = real.some((run) => run.status !== "completed" && createdWithin(run, LIMITS.activeMinutes));
    recent = real.some((run) => createdWithin(run, LIMITS.idleMinutes));
    dispatch = enabled && !active && !recent;
    if (dispatch) {
      alerts.push({ kind: "event",
        key: "restart",
        text: `No real live-forecast run was created in the last ${LIMITS.idleMinutes} minutes and none is queued or running, so the watchdog started the chain.`,
      });
    }
    const failing = failureStreak(runs);
    streak = failing.streak;
    if (streak >= LIMITS.failureStreak) {
      alerts.push({ kind: "state",
        key: `failing-since-${failing.since.id}`,
        text: `The live job has failed ${streak} real runs in a row (cancelled runs not counted), since run ${failing.since.id}${failing.since.html_url ? ` (${failing.since.html_url})` : ""}.`,
      });
    }
  }

  if (state) {
    const age = time - Date.parse(state.generatedAt);
    if (!Number.isFinite(age) || age > LIMITS.staleMinutes * MINUTE) {
      const hours = Number.isFinite(age) ? `${(age / 3_600_000).toFixed(1)} hours old` : "unreadable";
      alerts.push({ kind: "state",
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
        alerts.push({ kind: "state",
          key: `unsealed-${game.id}`,
          text: `Game ${game.id} (${game.awayId ?? "?"} at ${game.homeId ?? "?"}, ET ${game.etDate}) tipped at ${game.tipUtc} and has neither a v2 final nor a v2 morning seal.`,
        });
      }
    }
    if (V4.firstEtDate !== null) {
      const shadowSealed = new Set(
        ledger
          .filter((row) => row.type === "seal" && row.modelVersion === V4.modelVersion && (row.sealKind === "final" || row.sealKind === "morning"))
          .map((row) => row.gameId),
      );
      for (const game of games) {
        const tip = Date.parse(game.tipUtc);
        if (
          game.etDate >= V4.firstEtDate &&
          game.status !== "canceled" &&
          game.status !== "postponed" &&
          Number.isFinite(tip) &&
          tip < time - LIMITS.tipGraceMinutes * MINUTE &&
          tip >= time - LIMITS.tipLookbackHours * 60 * MINUTE &&
          !shadowSealed.has(game.id)
        ) {
          alerts.push({ kind: "state",
            key: `shadow-unsealed-${game.id}`,
            text: `Shadow model v4 (not published): game ${game.id} (${game.awayId ?? "?"} at ${game.homeId ?? "?"}, ET ${game.etDate}) tipped at ${game.tipUtc} and has neither a v4 final nor a v4 morning seal.`,
          });
        }
      }
    }
  }

  return { paused: false, dispatch, active, recent, streak, alerts };
}

const ET_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

/** PROBE_ROUTES plus the day page of the ET date 24 hours before `now`. */
export function probeRoutes(now) {
  const time = Date.parse(now);
  if (!Number.isFinite(time)) throw new Error(`Invalid watchdog clock: ${now}`);
  return [...PROBE_ROUTES, `/games/${ET_DATE.format(new Date(time - 86_400_000))}`];
}

/** The route this run reads beside `/`: index floor(now / 15 min) mod the route count. */
export function rotationIndex(nowMs, count) {
  return Math.floor(nowMs / (PROBE_LIMITS.rotationMinutes * MINUTE)) % count;
}

/**
 * The route read as RSC in the run whose UTC minute is under 15: index floor(now / 1 hour)
 * mod the route count. Not the HTML rotation's route: that run is always quarter 4h of the
 * day, and 4h mod 14 is always even, so half the routes would never be read as RSC.
 */
export function rscRotationIndex(nowMs, count) {
  return Math.floor(nowMs / (60 * MINUTE)) % count;
}

/**
 * What one run reads, in order: `/` and the rotating route as HTML, plus `/` and the hourly
 * rotating route as RSC when the UTC minute is under 15; with `all`, every route in both
 * forms. `also` adds reads an open incident is waiting to recheck (incidentRechecks), so a
 * condition on a route the rotation skipped this run can still be seen clear.
 * @param {{now: string, all?: boolean, also?: Array<{path: string, kind: "html" | "rsc"}>}} input
 * @returns {Array<{path: string, kind: "html" | "rsc"}>}
 */
export function probePlan({ now, all = false, also = [] }) {
  const routes = probeRoutes(now);
  const time = Date.parse(now);
  const reads = all
    ? routes.flatMap((path) => [{ path, kind: "html" }, { path, kind: "rsc" }])
    : [
        { path: "/", kind: "html" },
        { path: routes[rotationIndex(time, routes.length)], kind: "html" },
        ...(new Date(time).getUTCMinutes() < PROBE_LIMITS.rscBeforeMinute
          ? [{ path: "/", kind: "rsc" }, { path: routes[rscRotationIndex(time, routes.length)], kind: "rsc" }]
          : []),
      ];
  const plan = [];
  for (const read of [...reads, ...also]) {
    if (!routes.includes(read.path) || plan.some((entry) => entry.path === read.path && entry.kind === read.kind)) continue;
    plan.push({ path: read.path, kind: read.kind });
  }
  return plan;
}

/**
 * The state stamp a served page's HTML carries: the masthead chip's
 * `<time dateTime="…" data-state-stamp="" data-state-delivery="…">`
 * (src/components/layout/FreshnessChip.tsx), or null when the HTML has none. `delivery` is
 * null when the chip does not say.
 * @returns {{generatedAt: string, delivery: string | null} | null}
 */
export function renderedStamp(html) {
  for (const match of String(html ?? "").matchAll(/<time\b([^>]*)>/gi)) {
    const attributes = match[1];
    if (!/\bdata-state-stamp\b/i.test(attributes)) continue;
    const stamp = /\bdatetime="([^"]*)"/i.exec(attributes);
    if (!stamp || !stamp[1]) return null;
    const delivery = /\bdata-state-delivery="([^"]*)"/i.exec(attributes);
    return { generatedAt: stamp[1], delivery: delivery && delivery[1] ? delivery[1] : null };
  }
  return null;
}

/**
 * The state stamp of an RSC payload (a GET with `RSC: 1`): the layout's FreshnessGuard and
 * each page's PageStamp render from one state in one request, so every `"generatedAt":"…"`
 * in it must be the same readable time; otherwise (none, or two differing) null.
 * `delivery` is the payload's `"delivery":"…"` when every one agrees, else null.
 * @returns {{generatedAt: string, delivery: string | null} | null}
 */
export function rscStamp(text) {
  const source = String(text ?? "");
  const stamps = new Set([...source.matchAll(/"generatedAt":"([^"]*)"/g)].map((match) => match[1]));
  if (stamps.size !== 1) return null;
  const [generatedAt] = stamps;
  if (!Number.isFinite(Date.parse(generatedAt))) return null;
  const deliveries = new Set([...source.matchAll(/"delivery":"([^"]*)"/g)].map((match) => match[1]));
  return { generatedAt, delivery: deliveries.size === 1 ? [...deliveries][0] : null };
}

/** Health's generatedAt when it is a readable time, else null (health-unknown). */
const healthStamp = (health) =>
  health && typeof health.generatedAt === "string" && Number.isFinite(Date.parse(health.generatedAt)) ? health.generatedAt : null;
/** A page's stamp when it is a readable time, else null. */
const pageStampOf = (page) => (page.stamp && Number.isFinite(Date.parse(page.stamp.generatedAt)) ? page.stamp.generatedAt : null);

const minutesBetween = (later, earlier) => (Date.parse(later) - Date.parse(earlier)) / MINUTE;

/**
 * Alerts for what readers get (the keys are listed at the top of this file).
 * @param {object} input
 * @param {object | null} input.health /api/live/health's body, whatever its HTTP status
 *   (a 503 still says what the server has), or null when it could not be read.
 * @param {string | null} [input.healthProblem] Why health could not be read.
 * @param {string | null} input.publication live-data's state.json `generatedAt`, or null.
 * @param {Array<{path: string, kind: "html" | "rsc", status: number | null, error?: string | null,
 *   stamp: {generatedAt: string, delivery: string | null} | null, cache: string | null}>} input.pages
 *   One GET per planned read; `status` null with `error` when it got no answer.
 * @returns {Array<{key: string, text: string}>}
 */
export function siteAlerts({ health, healthProblem = null, publication, pages }) {
  const alerts = [];
  const serverStamp = healthStamp(health);
  if (serverStamp === null) {
    const why = healthProblem ?? (health ? "its answer has no readable generatedAt" : "no answer");
    alerts.push({ kind: "state",
      key: "health-unknown",
      text: `Could not read /api/live/health (${why}), so no served page was compared with the server.`,
    });
  } else {
    const data = health.data && typeof health.data === "object" ? health.data : {};
    const where = `delivery ${health.delivery ?? "(none)"}, data.commit ${data.commit ?? "null"}, data.head ${data.head ?? "null"}, data.problem ${data.problem ?? "null"}`;
    if (publication !== null && Number.isFinite(Date.parse(publication))) {
      const behind = minutesBetween(publication, serverStamp);
      if (behind > PROBE_LIMITS.behindMinutes) {
        alerts.push({ kind: "state",
          key: "site-behind-publication",
          text: `/api/live/health serves state from ${serverStamp}, ${Math.round(behind)} minutes behind live-data's state.json (${publication}); the limit is ${PROBE_LIMITS.behindMinutes} minutes (${where}).`,
        });
      }
    }
    if (health.delivery === "stored") {
      alerts.push({ kind: "state",
        key: "site-stored-copy",
        text: `/api/live/health says the server is rendering the stored copy bundled at build time, state from ${serverStamp} (${where}).`,
      });
    }
  }

  for (const page of pages) {
    const name = `${page.path}-${page.kind}`;
    const request = `GET ${page.path}${page.kind === "rsc" ? " (RSC)" : ""}`;
    if (page.status !== null && page.cache && CACHED.has(page.cache.trim().toUpperCase())) {
      alerts.push({ kind: "state",
        key: `page-cached-${name}`,
        text: `${request} was served from a stored copy (x-vercel-cache ${page.cache}); every page should render at request time.`,
      });
    }
    if (page.status !== 200) {
      alerts.push({ kind: "state",
        key: `page-error-${name}`,
        text: page.status === null ? `${request} got no answer: ${page.error ?? "unknown error"}.` : `${request} returned ${page.status}.`,
      });
      continue;
    }
    const pageStamp = pageStampOf(page);
    if (pageStamp === null) {
      alerts.push({ kind: "state",
        key: `page-stamp-unreadable-${name}`,
        text: `${request} returned 200 without a readable state stamp${page.stamp ? ` (${page.stamp.generatedAt})` : ""}, so its freshness could not be checked.`,
      });
      continue;
    }
    if (serverStamp === null) continue;
    const behind = minutesBetween(serverStamp, pageStamp);
    if (behind > PROBE_LIMITS.behindMinutes) {
      alerts.push({ kind: "state",
        key: `page-behind-${name}`,
        text: `${request} showed state from ${pageStamp} (delivery ${page.stamp.delivery ?? "(none)"}, x-vercel-cache ${page.cache ?? "none"}), ${Math.round(behind)} minutes behind the server's ${serverStamp}; the limit is ${PROBE_LIMITS.behindMinutes} minutes.`,
      });
    }
  }
  return alerts;
}

/**
 * True for the conditions a publication that landed seconds ago can cause without any
 * fault ("Seen twice" at the top of this file): they count only when two readings agree.
 */
export function mustPersist(key) {
  return key === "site-behind-publication" || key.startsWith("page-behind-");
}

/**
 * The site alerts of a run that read the site twice. A condition that must persist counts
 * only when both readings show it; every other condition counts from either reading, once.
 * The second reading's alerts keep their order and text; what only the first reading
 * showed follows.
 * @param {Array<{key: string, text: string}>} first
 * @param {Array<{key: string, text: string}>} second
 * @returns {Array<{key: string, text: string}>}
 */
export function settledSiteAlerts(first, second) {
  const firstKeys = new Set(first.map((alert) => alert.key));
  const secondKeys = new Set(second.map((alert) => alert.key));
  return [
    ...second.filter((alert) => !mustPersist(alert.key) || firstKeys.has(alert.key)),
    ...first.filter((alert) => !mustPersist(alert.key) && !secondKeys.has(alert.key)),
  ];
}

// Incidents (planIncident). One open issue per incident, "Live watchdog incident from
// <YYYY-MM-DD HH:MM> UTC", carrying the marker INCIDENT_MARKER. Which state keys are open
// is written in the issue itself: every body or comment that opens keys ends with
// `<!-- live-watchdog-open: … -->`, and every one that clears keys with
// `<!-- live-watchdog-resolved: … -->`; read in order, they give the keys still open.
//   - No open incident and some alert: open one listing every alert; its open keys are the
//     states. It links the newest closed incident, so a recurrence reads as one.
//   - An open incident: one comment for what changed. A state not already open, or any
//     event (an event is an occurrence, so each is reported), is new. An open state that
//     this run positively checked (checkedKeys) and that did not fire is "recovered"; one
//     whose route or game is no longer watched (yesterday's day page after midnight ET, a
//     game past the 24-hour lookback) is "no longer watched". An open state this run did
//     not check stays open: a route the rotation skipped is never counted as recovered.
//   - Closed, with a final comment, only by a run with no alert at all (so no read
//     problem and no event) that leaves no state open. Events never hold an incident open:
//     an incident of events only closes on the next clean run.

export const INCIDENT_TITLE_PREFIX = "Live watchdog incident from ";
export const INCIDENT_MARKER = "<!-- live-watchdog-incident -->";

/** The incident title for a run at `now`: its UTC date and minute. */
export const incidentTitle = (now) => `${INCIDENT_TITLE_PREFIX}${new Date(Date.parse(now)).toISOString().slice(0, 16).replace("T", " ")} UTC`;

/** True for an issue that is a watchdog incident: its title and its marker. */
export const isIncident = (issue) =>
  typeof issue?.title === "string" && issue.title.startsWith(INCIDENT_TITLE_PREFIX) && String(issue.body ?? "").includes(INCIDENT_MARKER);

const markerKeys = (text, name) =>
  [...String(text ?? "").matchAll(new RegExp(`<!-- live-watchdog-${name}:([^>]*?)-->`, "g"))].flatMap((match) => match[1].split(/\s+/).filter(Boolean));

/** The state keys still open in an incident, from its body and comments in order. */
export function openKeys(texts) {
  const open = new Set();
  for (const text of texts) {
    for (const key of markerKeys(text, "open")) open.add(key);
    for (const key of markerKeys(text, "resolved")) open.delete(key);
  }
  return [...open];
}

const PAGE_KEY = /^page-(behind|cached|stamp-unreadable|error)-(.+)-(html|rsc)$/;

/** The (path, kind) reads an incident's open page keys need to be seen clear. */
export function incidentRechecks(keys) {
  const reads = [];
  for (const key of keys) {
    const match = PAGE_KEY.exec(key);
    if (match && !reads.some((read) => read.path === match[2] && read.kind === match[3])) reads.push({ path: match[2], kind: match[3] });
  }
  return reads;
}

/**
 * What this run positively checked, for deciding that an open state recovered.
 * `has(key)`: the condition behind `key` was checked this run (so its absence means it is
 * clear). `retired(key)`: the condition can no longer be checked because what it watched
 * left the probe (yesterday's day page after midnight ET) or the lookback (a game more
 * than 24 hours past tip). Events, and keys this code does not know, are neither.
 * @param {object} input
 * @param {string} input.now
 * @param {string | null} input.workflowState
 * @param {Array<object> | null} input.runs
 * @param {object | null} input.state
 * @param {Array<object> | null} input.games
 * @param {Array<object> | null} input.ledger
 * @param {Iterable<string>} input.attempted Labels of the reads this run attempted (`unreadable-<label>`).
 * @param {{enabled: boolean, health: object | null, publication: string | null,
 *   pages: Array<{path: string, kind: string, status: number | null, stamp: object | null}>}} input.site
 */
export function checkedKeys({ now, workflowState, runs, state, games, ledger, attempted, site }) {
  const time = Date.parse(now);
  const routes = probeRoutes(now);
  const tried = new Set(attempted);
  const healthRead = site.enabled && healthStamp(site.health) !== null;
  const publicationRead = site.publication !== null && Number.isFinite(Date.parse(site.publication));
  const pageOf = (path, kind) => site.pages.find((page) => page.path === path && page.kind === kind) ?? null;
  const watchedGame = (id) => {
    const game = (games ?? []).find((entry) => entry.id === id);
    const tip = game ? Date.parse(game.tipUtc) : NaN;
    return Number.isFinite(tip) && tip >= time - LIMITS.tipLookbackHours * 60 * MINUTE;
  };
  const has = (key) => {
    if (key.startsWith("unreadable-")) return tried.has(key.slice("unreadable-".length));
    if (key === "runs-unreadable") return true;
    if (key.startsWith("workflow-")) return workflowState !== null;
    if (key.startsWith("failing-since-")) return runs !== null;
    if (key.startsWith("stale-")) return state !== null;
    if (key.startsWith("unsealed-")) return games !== null && ledger !== null && watchedGame(key.slice("unsealed-".length));
    if (key === "health-unknown") return site.enabled;
    if (key === "site-stored-copy") return healthRead;
    if (key === "site-behind-publication") return healthRead && publicationRead;
    const match = PAGE_KEY.exec(key);
    if (!match) return false;
    const [, condition, path, kind] = match;
    const page = pageOf(path, kind);
    if (!site.enabled || page === null) return false;
    if (condition === "error") return true;
    if (condition === "cached") return page.status !== null;
    if (condition === "stamp-unreadable") return page.status === 200;
    return page.status === 200 && pageStampOf(page) !== null && healthRead;
  };
  const retired = (key) => {
    if (key.startsWith("unsealed-")) return games !== null && ledger !== null && !watchedGame(key.slice("unsealed-".length));
    const match = PAGE_KEY.exec(key);
    return Boolean(match) && !routes.includes(match[2]);
  };
  return { has, retired };
}

const bullets = (lines) => lines.map((line) => `- ${line}`);

function runLine({ now, dataCommit, runUrl }) {
  return `Live watchdog at ${now}; live-data ${dataCommit ?? "unreadable"}.${runUrl ? ` Run: ${runUrl}` : ""}`;
}

const FOOTER = [
  "A condition stays open until a watchdog run checks it and finds it clear; this issue closes itself after a run with no alert and nothing open. Events (a restart, a failed dispatch) are reported but never keep it open.",
  "",
  "The watchdog runs on GitHub Actions like the job it watches: a second path, not an external monitor. An issue notifies only people who watch the repository or are mentioned; it does not prove anyone read it.",
];

/** The body of a new incident. */
export function incidentBody({ context, alerts, previous }) {
  const states = alerts.filter((alert) => alert.kind !== "event");
  const events = alerts.filter((alert) => alert.kind === "event");
  return [
    runLine(context),
    ...(previous ? ["", `The previous incident was #${previous.number}${previous.closedAt ? `, closed ${previous.closedAt}` : ""}.`] : []),
    ...(states.length > 0 ? ["", "Open conditions:", ...bullets(states.map((alert) => alert.text))] : []),
    ...(events.length > 0 ? ["", "Events:", ...bullets(events.map((alert) => alert.text))] : []),
    "",
    ...FOOTER,
    "",
    "cc @bilguutei2k",
    INCIDENT_MARKER,
    `<!-- live-watchdog-open: ${states.map((alert) => alert.key).join(" ")} -->`,
  ].join("\n");
}

/** A comment on an open incident: what is new, what recovered, and, when closing, that. */
export function incidentComment({ context, fresh, recovered, retired, closing }) {
  const states = fresh.filter((alert) => alert.kind !== "event");
  const events = fresh.filter((alert) => alert.kind === "event");
  const resolved = [...recovered, ...retired];
  return [
    runLine(context),
    ...(states.length > 0 ? ["", "New conditions:", ...bullets(states.map((alert) => alert.text))] : []),
    ...(events.length > 0 ? ["", "Events:", ...bullets(events.map((alert) => alert.text))] : []),
    ...(recovered.length > 0 ? ["", "Checked this run and clear:", ...bullets(recovered.map((key) => `recovered: ${key}`))] : []),
    ...(retired.length > 0 ? ["", "No longer watched (left the probe or the 24-hour lookback, so not checked again):", ...bullets(retired)] : []),
    ...(closing ? ["", "This run raised no alert and no condition is open, so the incident is closed. A recurrence opens a new incident that links this one."] : []),
    ...(states.length > 0 ? [`<!-- live-watchdog-open: ${states.map((alert) => alert.key).join(" ")} -->`] : []),
    ...(resolved.length > 0 ? [`<!-- live-watchdog-resolved: ${resolved.join(" ")} -->`] : []),
  ].join("\n");
}

/**
 * What to do with incidents this run. Pure.
 * @param {object} input
 * @param {{number: number, open: string[]} | null} input.incident The open incident and its open keys.
 * @param {{number: number, closedAt?: string | null} | null} [input.previous] The newest closed incident.
 * @param {Array<{key: string, text: string, kind: "state" | "event"}>} input.alerts
 * @param {{has: (key: string) => boolean, retired: (key: string) => boolean}} input.checked
 * @param {string} input.now
 * @param {{dataCommit?: string | null, runUrl?: string | null}} [input.context]
 * @returns {{action: "none"} | {action: "create", title: string, body: string, open: string[]}
 *   | {action: "comment" | "close", number: number, body: string, open: string[], recovered: string[], retired: string[]}}
 */
export function planIncident({ incident, previous = null, alerts, checked, now, context = {} }) {
  const ctx = { now, dataCommit: context.dataCommit ?? null, runUrl: context.runUrl ?? null };
  if (!incident) {
    if (alerts.length === 0) return { action: "none" };
    return {
      action: "create",
      title: incidentTitle(now),
      body: incidentBody({ context: ctx, alerts, previous }),
      open: alerts.filter((alert) => alert.kind !== "event").map((alert) => alert.key),
    };
  }
  const firing = new Set(alerts.map((alert) => alert.key));
  const wasOpen = new Set(incident.open);
  const fresh = alerts.filter((alert) => alert.kind === "event" || !wasOpen.has(alert.key));
  const recovered = incident.open.filter((key) => !firing.has(key) && checked.has(key));
  const retired = incident.open.filter((key) => !firing.has(key) && !recovered.includes(key) && checked.retired(key));
  const open = [
    ...incident.open.filter((key) => !recovered.includes(key) && !retired.includes(key)),
    ...fresh.filter((alert) => alert.kind !== "event").map((alert) => alert.key),
  ];
  const closing = alerts.length === 0 && open.length === 0;
  if (!closing && fresh.length === 0 && recovered.length === 0 && retired.length === 0) return { action: "none" };
  return {
    action: closing ? "close" : "comment",
    number: incident.number,
    body: incidentComment({ context: ctx, fresh, recovered, retired, closing }),
    open,
    recovered,
    retired,
  };
}
