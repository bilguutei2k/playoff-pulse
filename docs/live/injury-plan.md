# Injury model plan

Status: decided. Written and reviewed 2026-11-01, before anything was run on the test
seasons. Sections 1-9 are the original proposal. **Section 10 is the binding decision,
and wins wherever it differs.**

## 1. Goal and constraints

The owner wants injuries in day-to-day game probabilities, and playoff and title odds
that reflect them and update constantly. The owner accepted these rules: the model must
pass a test on held-out seasons, and if it fails we stop and go back to the owner with a
recommendation rather than ship it.

Project rules that apply (`AGENTS.md`): parameters are frozen per version, the record is
reported per version, never refit on all history or tune on validation seasons, sealed
rows are append-only and never backfilled, a backtest may use only what was known at
prediction time, publication fails closed, new probability outputs need invariants.

v1 (`live-2026.27-v1`) has its parameters fitted on 2005-2015. Its known deficits (game
calibration slope 0.860, midseason playoff reliability) are out of scope here. They are
not to be fixed by tuning in this work.

## 2. What was verified about the data

| Source | Finding | How verified |
|---|---|---|
| ESPN `summary.injuries` on a past game | **Unusable and dangerous.** Returns today's list. A 2013 game shows rows dated 2026 | Sampled 28 games, 2013-2026 |
| ESPN box score (`summary.boxscore.players`) | Minutes, counting stats, plus/minus, `starter`, `didNotPlay`, `reason` per player. `didNotPlay` is sparse in some samples (0 in both 2015 samples and one 2021 sample). The list is written after the game | Same sample |
| NBA injury report PDFs, `ak-static.cms.nba.com/referee/injury/` | Exist from at least 2021-03-15. Named `Injury-Report_YYYY-MM-DD_HHPM.pdf` (hourly) until partway through 2025-12-22, then `..._HH_MMPM.pdf` (every 15 minutes). Each carries its own timestamp in the header (`_05PM` on 2022-01-15 says 05:30 PM). Columns: game date, time, matchup, team, player, status, reason. Statuses: Out, Doubtful, Questionable, Probable, Available. Teams not yet filed show `NOT YET SUBMITTED` | Read 2022-01-15 and 2026-11-01 reports. Fetched from a GitHub-hosted runner |
| Rate limiting on that host | Bursts get refused and recover later. Single requests succeed. Ingestion must be slow with retries | Observed |
| ESPN live injuries | 88 rows, all with `details.returnDate` (an estimate), `details.fantasyStatus` (OUT, GTD, OFS) and a status of Out or Day-To-Day. No history | Live call |
| ESPN `pickcenter` spreads | Present in samples 2013-2023 and 2026. Empty in the 2024 and 2025 samples, so market comparison will have gaps | Same sample |

Today's evidence that morning seals are too early: Boston's Mitchell Robinson was
Day-To-Day at the 11:48 UTC seal and Out by the 1:15 PM ET report, and the Lakers' spread
moved from -4.5 to -2.5 in the same window. These are anecdotes, not findings.

Also relevant: the outside scheduler (every 10 minutes) is being set up in a separate
step, because GitHub's schedule ran 2 of about 27 slots in the first 13 hours. The final
seal below depends on it.

## 3. Proposed model

**Player value.** For each player, using only games before the date:

- Production per minute: a recency-weighted average of Hollinger Game Score per minute,
  weighted by minutes, carried across seasons and teams, and shrunk toward a replacement
  level `g_rep` with `k` pseudo-minutes.
- Expected minutes `m`: a shorter-memory average of minutes in games played.
- `lost_p = (g_p - g_rep) * m_p`, floored at 0.

**Status to absence probability.** A table from the fit seasons: how often players listed
Out, Doubtful, Questionable, Probable or Available at T-60 actually did not play. Unlisted
players use the fit-season rate for unlisted rotation players.

**Expected absence for a team and game.** `A_t = sum over listed players of
P(absent | status) * lost_p`.

**Game forecast.** `mu = r_h - r_a + hca + b2b - beta * (A_h - A_a)`. Variance is unchanged.
`beta` converts Game Score to points and is fitted.

**Full-strength ratings.** The Kalman update sees the margin adjusted for who actually
missed the game: `y = cap(margin) + beta * (actual_h - actual_a)`, where `actual_t` is the
sum of `lost_p` for players who did not play and whom the team would have expected to
have (listed on the last report, or in its recent rotation). Otherwise a long absence is
counted twice: once baked into the rating and again as an adjustment. v1's Kalman
parameters stay frozen, including `sigma`.

Margins before 2020-21 have no box scores in this dataset, so the replay runs unadjusted
until then and adjusted afterward.

**Alternative to compare on fit seasons only, B.** Leave ratings unchanged and adjust
only for the change from recent absences: `-beta * ((A_h - base_h) - (A_a - base_a))`,
with `base_t` a moving average of `actual_t`. Simpler, and needs no adjusted replay. The
better of the two on fit seasons goes to the test. Only one goes to the test.

**Fitted parameters, on 2021-22 to 2023-24 only:** `beta`, `g_rep`, `k`, the two memory
lengths, the status table. Coarse grids and no others. Grid boundaries get widened as
with v1, and sensitivity is written down.

## 4. Season, playoff and title odds

Each simulated future game uses `A_h(d)` and `A_a(d)`: currently absent players' `lost_p`
for games on dates up to their expected return, then zero. Expected return:

- ESPN's `returnDate` when present, with `OFS` meaning out for the season.
- Otherwise a survival rule from fit seasons: expected further games missed, given how
  many the player has already missed in this absence.

Unknown future injuries are not simulated. Every team will have some, and they mostly
cancel in a rating difference.

ESPN return dates have no history, so the backtest can only use the survival rule. The
live version uses a better input than was tested, and the methodology page must say so.
Return dates get stored at each run, so they can be evaluated prospectively.

Odds move after a final or after injury news that changes them. They do not move during
a game, because live scores stay out of everything but the in-game estimate.

## 5. Two seals per game

- **Morning seal:** as today, from 06:00 ET, plus the availability known then.
- **Final seal:** first run with `0 < tip - now <= 60 minutes`.
- **Scored forecast:** the final seal if one exists, otherwise the morning seal, and that
  game is counted publicly as "no final seal".
- Both stay in the ledger. Morning-seal scores are reported separately.
- Between seals, the page shows a live forecast labeled as current and not yet final.
- Each v2 row also records v1's number for the same game, from v1's own frozen ratings, so
  the head-to-head continues prospectively on identical games.
- A failed or unparseable report does not block sealing. The run uses the last good report,
  and the row is flagged. If no report is under 24 hours old, the row says availability
  was missing.

## 6. Data to build

- `data/season/boxscores/{2021..2026}.json`: compact player lines.
- `data/season/reports/{2021..2026}.json`: parsed report rows at two points per game (morning
  and T-60), selected by each report's own header timestamp, never its file name.
- Live equivalents under `data/live/`, appended by the pipeline.
- Name matching between `Banchero, Paolo` and ESPN's names: normalized, team-scoped first,
  then global. Suffixes, diacritics and nicknames handled by an explicit alias list.
  An unmatched player has a value of 0 and is counted. A coverage check on players with
  real minutes must pass, or the build fails.
- PDF text comes from `pdfjs-dist`, with columns taken from x positions (owner approved a
  PDF package and the NBA reports as a source).

## 7. Test rule, to be registered before any test-season result is seen

Fit: 2021-22, 2022-23, 2023-24. Test: 2024-25, 2025-26, regular season, final-seal
snapshot. Comparator: v1 on the same games. All walk-forward.

| Check | Rule |
|---|---|
| T1 (primary) | v2 Brier below v1. 95% interval on the difference, entirely below 0, from a bootstrap of game dates |
| T2 | Log loss not worse than v1 |
| T3 | Calibration slope not lower than v1's by more than 0.02 |
| T4 | Season gates S1 and S3 on 2024-25 and 2025-26: not worse than v1 at any checkpoint |
| Reported only | Morning-snapshot Brier. Games with a large absence gap. Market spread where coverage exists. Coverage of name matching and report timing. Playoff games |

Pass means T1 to T4 all hold. **Fail means stop and go to the owner with a recommendation.**

Disclosure: base-model results on these seasons have been seen (the 2023-2026 report), so
v1's score there is known. The injury term has never been evaluated on them. Only two test
seasons exist, so this is thin, and sealed forecasts remain the real test.

Availability of a T-60 report is a data question. If a game has no report at T-60, the
latest earlier report is used and the count is reported. If more than 5% of test games lack
one within 3 hours of tip, the test is void and we go back to the owner.

## 8. Shipping if it passes

`live-2026.27-v2`, with its own record. The v1 record stays visible. UI: each card shows
the adjustment and who drives it. The season table adds current rating beside full-strength.
The caveat that injuries are not modeled is replaced with what is modeled and what is not.
`AGENTS.md`, `docs/live/registration.md`, `docs/claims-ledger.md`, the methodology page and
verifiers all change with it. New invariants: more absence lowers a team's chance, an absent
replacement-level player changes nothing, equal teams with equal absences stay even.

## 9. Open questions for review

1. Full-strength ratings or the relative alternative, and is comparing them on fit seasons
   acceptable, or does that add a fork that should be removed?
2. Is Game Score adequate for player value given box scores only, or should plus/minus be
   a second term?
3. Is the T1 interval method right with two test seasons?
4. Should `sigma` stay frozen, given the injury term changes residual variance?
5. Is T4 fair when the backtest cannot use ESPN return dates?
6. Is the two-seal scheme right, including which one is scored?
7. Anything here that leaks the future or that would let the fit see the test seasons?

## 10. Binding decision (Fable, after one round of exchange)

Recorded verbatim from the review. Decisions 4, 5, 7 and 9 are shown as amended in the
exchange.

1. **Form.** `mu = r_h - r_a + hca + b2b - beta*(A_h - A_a)`. Variance unchanged. Every v1
   parameter frozen, including sigma and uncertainty scale 1.5. Kalman update
   `y = cap(margin + beta*(actual_h - actual_a))`, adjusted from 2020-21 onward, unadjusted
   before. Alternative B is cut.
2. **Player value.** GmSc per minute, exponentially weighted by minutes with half-life
   `L_g`, shrunk to `g_rep` with `k` pseudo-minutes; `m_p` exponentially weighted minutes
   over games played, half-life `L_m`; `lost_p = max(0, (g_p - g_rep)*m_p)`. Streaming after
   each game, never from season totals. No plus/minus.
3. **Absence.** `actual_t`: sum of `lost_p` over players absent (missing from box score or 0
   minutes) who appeared for the team in one of its last 10 games or on its latest report,
   excluding anyone who has since appeared for another team. `A_t`: sum over listed players
   of `P(absent|status)*lost_p`; unlisted is 0.
4. **Fitted, on 2021-22 to 2023-24 regular seasons, walk-forward, by log loss, coordinate
   descent:** `beta` {0.1 to 0.8 by 0.1}, `g_rep` {0.10, 0.15, 0.20, 0.25, 0.30}, `k` {500,
   1000, 2000, 4000} min, `L_g` {1000, 2000, 4000} min, `L_m` {5, 10, 20} games. Widen a
   boundary hit once; record sensitivity. Empirical tables on the same seasons:
   `P(absent|status)` at the T-60 report for the five statuses, adjacent statuses pooled if
   not monotone. The survival table is `E[further games | bucket, class]`, buckets 0, 1, 2-3,
   4-7, 8-15, 16-30, 31+ games missed in a row, class in {long, short}. Class comes from the
   reason text on the latest qualifying report at the observation, matched case-insensitively
   against a fixed stem list frozen in the registration commit: surgery, repair, tear, torn,
   rupture, fracture, reconstruction, season, achilles. No row or no reason text is short.
   Each team game a player misses is one observation; an absence running to the end of the
   regular season counts the games remaining, censoring noted. A cell under 30 observations
   pools with the adjacent bucket in the same class. If on the fit seasons long at bucket 0
   does not exceed short at bucket 0, the class is dropped before any test number and this is
   recorded. Nothing else is fitted.
5. **Data.** Box scores 2020-21 to 2025-26. Reports 2021-22 to 2025-26 at two points per game
   by header timestamp: latest at or before 06:00 ET on game date, latest at or before tip
   minus 60 min. Name matching normalized, team-scoped, alias list frozen in the registration
   commit. Two per-season checks; either failing fails the build: (i) at least 98% of report
   rows, excluding rows whose reason contains G League or Two-Way, match exactly one athlete
   on that team's season box-score roster; (ii) at least 98% of box-score minutes belong to
   players whose normalized name is unique within their team-season. A season where more than
   5% of games lack a final-point report within 3 hours of tip is unusable: a fit season drops
   out, a test season voids the test.
6. **Test**, registered in `registration.md` in a commit preceding any test-season number:
   2024-25 and 2025-26 regular season, games with a qualifying report, final point, v2 against
   v1 on the identical set, both from ratings frozen at the previous ET date.
   - T1 (hard): paired Brier v2 minus v1, date-clustered 10,000-draw bootstrap, 95% interval
     entirely below 0, and negative in each season.
   - T2: pooled log loss not worse.
   - T3: slope not lower than v1's by more than 0.02.
   - T4 (bug check): both seasons pooled at Dec 1, Feb 1, Apr 1: make-playoffs Brier not worse
     by more than 0.005, win RMSE not worse by more than 0.25, at any checkpoint; simulator
     invariants hold.
   - Reported only: morning point, large-gap subset, market where present, per-season tables,
     coverage.

   Pass is T1-T4. Fail or void: stop, record in `registration.md`, recommendation to the owner.
   Nothing is refit after a test number is seen.
7. **Simulation.** Currently absent: missed the team's last game and not listed
   Probable/Available, or listed Out/Doubtful on the latest report. A currently absent player's
   class is re-read from the latest report every run and may change; the bucket is games missed
   so far. Out for `E[further | bucket, class]` team games, postseason games included, then back.
   Pending games subtract `beta*A_t(d)` in the game offset. Simulated postseason games take
   date = last regular date + 1. ESPN `returnDate` and `OFS` remain stored every run, never an
   input, no live-only override. Methodology states return estimates come from the survival
   table only.
8. **Seals.** Morning as now plus availability. Final: first run with `0 < tip - now <= 60 min`,
   same previous-ET-date ratings, latest validated report with header timestamp at or before
   now. Scored: final if present, else morning, counted as "no final seal". Each v2 row stores
   `sealKind`, report timestamp, stale and missing flags, `A_h`, `A_a`, top drivers, and v1's
   number recomputed at that instant. v1 keeps sealing its own rows. A failed report uses the
   last good one if under 24 h and flags the row; otherwise `A = 0`,
   `availabilityMissing: true`. Report fetch, parse and validation move before `sealGames`.
9. **Ship conditions.** T1-T4 pass; scheduler hit at least 90% of 10-minute slots over 3
   consecutive days; invariants added (more absence lowers probability, replacement-level
   absence changes nothing, equal teams with equal absences even, `A >= 0`, status table
   monotone, long bucket-0 `E[further]` >= short bucket-0); `AGENTS.md`, `registration.md`,
   claims ledger, methodology in the same PR; ship by PR as v1 did. Stop: any T fails or voids,
   coverage gate fails, scheduler unreliable.
10. **Build order.** Box-score ingest and coverage; report ingest with structural validation;
    name matching and alias freeze; player value and invariants; tables; adjusted replay,
    forecast term, fit; registration commit; test; only then pipeline, simulator, seals, UI, docs.

**Amendment to 5(i), ruled by Fable on 2026-11-01, before any fit or test number existed.**
"The original wording measured whether listed players played that season, not whether names
resolve; players out all season or newly traded are the term's main inputs and must count as
resolved. New 5(i): at least 98% of report rows, same exclusions, resolve to exactly one athlete
through the production resolver: team-season roster first, then a name unique across all loaded
box-score seasons, the loaded set fixed in the registration commit. Report the roster-only share
and the unresolved list per season. Leak: none. The global step fixes identity only; value comes
from games before the row date, so a match found through a later season is worth 0 until he
plays, and future data can only un-resolve a name, never add value. Seeing the numbers changes
nothing: they are data-plumbing figures, no parameter or test touched them, the threshold is
unchanged, no row is excluded by name. Record this amendment. 2023-24 onward must pass before any
fit." The literal check had read 88.35% for 2021-22 and 93.06% for 2022-23, against 99.39% and
99.78% through the resolver.

Other points from the review to honor in the build: 2025-26 were seen when v1's form was chosen,
which favors v1, so T1 is conservative and the disclosure says so. `decideSeals` and `decideMissed`
key on `gameId`, so a second seal needs `sealKind`, and a morning-sealed game with no final seal
counts as "no final seal", never missed. The report parser fails closed on structure (columns
located, every slate game has rows or NOT YET SUBMITTED). Reports are cached by header timestamp,
and only new files are downloaded. Each final seal is a commit and a deploy, roughly 15 an evening,
which is accepted.


## 2026-11-06 correction to the historical amendments

The quoted amendment above remains a historical record, not a current no-leak claim.
Future roster evidence can resolve as well as un-resolve a previously known name.
The independent review found no positive-value historical effect through this route;
that does not establish a universal no-leak property. Both injury-test seasons were
inside the 2023–2026 span used to select the shared base-model form. There is no
demonstrated conservative direction: the contrast can be affected either way.
See the dated corrections in [registration.md](registration.md#2026-11-06-corrections-after-the-independent-review)
for the policy revisions and the confirmed return-table and postseason defects.
