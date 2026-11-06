# Live model registration

Model version: `live-2026.27-v1`. Registered 2026-11-01, before any validation
season was scored. The commit that adds this file precedes every validation
result in `docs/live/evaluation.json`.

## Frozen parameters

From `scripts/live/fit-params.ts`, using seasons 2005-2015 only (2005 is warm-up
and unscored). Full output: `docs/live/development-fit.json`.

| Parameter | Value | Meaning |
|---|---:|---|
| `sigma` | 10.5 | Game-margin noise SD |
| `q` | 0.05 | Daily team-rating variance |
| `qHca` | 0.0002 | Daily home-court variance (set, not fitted; see below) |
| `rho` | 0.85 | Season-to-season rating carryover |
| `tau` | 4.5 | Long-run SD of team strength |
| `hca0` | 1 | Starting home-court state; learned within weeks |
| `hcaVar0` | 1 | Starting home-court variance |
| `b2b` | 1.5 | Points against a team on a back-to-back |
| `marginCap` | 30 | Margins clipped to this before updating |
| `hcaPlayoffDelta` | 1.5 | Added home-court points in playoff games |
| `playoffSpread` | 1.1 | Multiplier on rating difference in playoff games |

`qHca` is set rather than fitted. Development seasons have too little home-court
drift to identify it, and the fit prefers about zero, which would freeze the state
for later seasons. Development log loss is 0.594511 at the chosen 0.0002 and
0.594523 at zero, so the choice has no development cost.

These exact parameters ship. There is no refit on all history. The only permitted
refits are the disclosed ones in the ship rule below. Any mid-season parameter
change requires a new version, and the public record is reported per version.

## Candidate selection

On development regular seasons (n = 12,059), by log loss: Kalman 0.594511, Elo with
margin 0.597729, season-to-date SRS 0.603238, prior home-win rate 0.674843. Kalman is
the primary.

**Disclosure:** a spike on seasons 2023-2026 informed the choice of model form before
this registration, using hand-set parameters. Those seasons are therefore reported
separately and are not part of the gates. Only 2026-27 onward is fully untouched.

## Validation design

- **Gate seasons:** 2016-2022, scored once with frozen parameters.
- **Reported separately:** 2023-2026, labeled "model form chosen with sight of these
  seasons".
- Ratings stay walk-forward: every prediction uses only earlier games.
- Bubble dates (2020-07-30 to 2020-10-12) are treated as neutral.

## Gates

**Game level, gate seasons, regular season:**

- **G1.** Brier below the prior home-win-rate baseline, with a season-clustered
  paired 95% interval wholly below zero.
- **G2.** Paired Kalman-minus-comparator Brier against Elo-margin and season-to-date
  SRS, with a season-clustered 95% interval not wholly above zero.
- **G3.** Calibration slope in [0.90, 1.10] and grouped reliability at most 0.002.
- **G4.** Property tests: changing a future game leaves every earlier forecast
  byte-identical, and a replay reproduces state exactly.

**Season level, at opening night, Dec 1, Feb 1 and Apr 1. Gate seasons exclude the
irregular 2020 and 2021, leaving 2016-2019 and 2022:**

- **S1.** Make-playoffs Brier beats a current-win-percentage logistic baseline, fitted
  on development seasons, at each checkpoint after opening night.
- **S2.** Make-playoffs reliability within 10 points in every bin with at least 10
  team-seasons.
- **S3.** Win-total RMSE beats linear extrapolation at Dec 1 and later.
- **S4.** Seeding from real results, seasons 2022-2026, 100% required. Seeds 1-6 are
  compared with ESPN final `playoffSeed`. Seeds 7-10 are compared with play-in game-1
  pairings identified by notes: the home team of "7th Place vs 8th Place" is seed 7
  and the away team is seed 8; the home team of "9th Place vs 10th Place" is seed 9
  and the away team is seed 10.

Title odds are reported descriptively, with no skill claim.

**In-game, regular seasons 2025 and 2026, at Q1, Q2 and Q3 ends:** grouped reliability
at most 0.003 and calibration slope in [0.85, 1.15] per checkpoint.

**Playoffs:** series Brier is reported against the SRS + home reference on matched
series. No improvement claim unless the interval excludes zero.

## Ship rule

- **G1 and G4** are hard blockers.
- **G2** failure allows one disclosed refit on development seasons. If it still fails,
  the model ships with the deficit recorded in `docs/claims-ledger.md`.
- **G3** failure allows one fix: re-fit `sigma` alone on 2010-2015.
- **S1-S3** failure allows one disclosed re-fit of the simulator uncertainty scale on
  development seasons. The result is recorded either way.
- **S4** is a deterministic rule check and must pass. Tiebreak criteria for record
  against playoff-eligible teams are added only if S4 requires them.
- **In-game** failure allows one refit of `sigma_g` on 2025 states only, re-validated on
  2026 only. On a second failure the in-game estimate is not shown (score and sealed
  pregame number only) and the deficit is recorded in the claims ledger.
- No retuning against validation seasons beyond these rules. Every refit is disclosed
  here.

## Amendments

**2026-11-01, G3 result.** On gate seasons the calibration slope was 0.860, outside
[0.90, 1.10], while grouped reliability was 0.000489, inside the 0.002 limit. Forecasts
are therefore mildly overconfident: a stated 80% has historically been about 77%. The
permitted fix was applied (`scripts/live/refit-sigma.ts`, `sigma` alone on 2010-2015 regular
seasons, every other parameter held) and it returned the registered value, 10.5, so nothing
changed. G3 is not a hard blocker under the ship rule. No further tuning was done, because
anything else would be fitted on validation seasons. The deficit is recorded in
`docs/claims-ledger.md` and on `/live/methodology`. Any correction must be a new version
chosen on prospective data.

**2026-11-01, in-game result.** At the registered default `sigma_g` = 10.5 the estimate
failed at every quarter end on 2025-2026 (slopes 0.557, 0.562, 0.604; reliability 0.0098,
0.0078, 0.0077). The permitted refit on 2025 states alone chose `sigma_g` = 18
(`scripts/live/evaluate-in-game.ts --refit`). On 2026 alone, unused by that fit, it passes:

| Quarter end | n | Brier | Slope | Reliability |
|---|---:|---:|---:|---:|
| Q1 | 1,230 | 0.1918 | 1.007 | 0.001332 |
| Q2 | 1,230 | 0.1567 | 1.004 | 0.000655 |
| Q3 | 1,230 | 0.1191 | 0.963 | 0.000786 |

Mid-quarter values, and the final minutes in particular, are interpolation and unvalidated.

**2026-11-01, season-level result.** With the simulator at scale 1, on gate seasons 2016-2019
and 2022:

- **S1 and S3 passed** at every checkpoint (make-playoffs Brier 0.1306, 0.0742, 0.0285 against
  baseline 0.1485, 0.0925, 0.0607; win RMSE 6.23, 3.40, 1.22 against 8.10, 3.83, 1.29).
- **S2 failed** at opening night and Dec 1.
- **S4 passed:** 100 of 100 seeds matched across 2022-2026, without the skipped criteria.

The permitted refit scanned the uncertainty scale on development seasons only and chose 1.5
(make-playoffs Brier 0.10036 against 0.10122 at scale 1). The gate seasons were then re-run once:

| Checkpoint | Make-playoffs Brier | Baseline | S1 | Win RMSE | Extrapolation | S3 | S2 |
|---|---:|---:|---|---:|---:|---|---|
| Opening night | 0.1660 | n/a | n/a | 8.98 | n/a | n/a | fail |
| Dec 1 | 0.1303 | 0.1485 | pass | 6.22 | 8.10 | pass | fail |
| Feb 1 | 0.0748 | 0.0925 | pass | 3.40 | 3.83 | pass | fail |
| Apr 1 | 0.0283 | 0.0607 | pass | 1.22 | 1.29 | pass | pass |

S2 remains failed, and also now fails at Feb 1. Its populated bins hold only 10-16 team-seasons,
where the sampling error alone is 10-16 points, so this says more about the test's power than a
clear miscalibration, but the registered result stands: **mid-season playoff odds are not claimed
to be well calibrated.** No further change was made.

On 2023-2026, reported separately, S1 fails at Dec 1 and Feb 1 (0.1292 against 0.1277 and 0.0948
against 0.0913) and S3 fails at Feb 1 (4.13 against 3.97). Early-season and midseason playoff odds
in recent seasons have not beaten simple win-percentage reads.

**Title odds, descriptive only.** Mean probability given to the eventual champion on gate seasons:
15.2% at opening night, 22.2% on Dec 1, 23.4% on Feb 1, 16.5% on Apr 1. On 2023-2026: 7.0%, 14.6%,
21.8%, 36.6%. Nine champions are far too few to measure skill, and none is claimed.

**Playoffs, reported only.** Series Brier against the rolling SRS + home reference: 0.1837 against
0.1712 on gate seasons (n = 105, interval +0.0125 [-0.0057, +0.0281], crossing zero), and 0.2245
against 0.2478 on 2023-2026 (n = 60, interval -0.0233 [-0.0325, -0.0146], in seasons that informed
model form). No improvement is claimed.


## Candidate `live-2026.27-v2`: injury adjustment

Registered 2026-11-02, before any test-season number was computed. The plan and the
binding decisions are in `docs/live/injury-plan.md` section 10; the fit output is in
`docs/live/injury-fit.json`. This commit precedes `docs/live/evaluation-injury.json`.

### Frozen inputs

- Every v1 parameter is unchanged, including `sigma` 10.5 and the simulator's
  uncertainty scale 1.5. The game forecast becomes
  `mu = r_h - r_a + hca + b2b - beta * (A_h - A_a)`, and ratings are updated on margins
  adjusted for who actually missed each game, from 2020-21 on.
- Injury parameters, fitted on 2021-22 to 2023-24 regular seasons by log loss with
  coordinate descent (2020-21 box scores as warm-up only): `beta` 0.4 points per unit of
  Game Score, `g_rep` 0.20 Game Score per minute, `k` 1,000 pseudo-minutes, `L_g` 1,000
  minutes, `L_m` 3 games. `L_g` and `L_m` hit grid edges and the grids were widened once,
  as permitted. `L_m` sits at the edge of the widened grid; its log loss differs from the
  next value (5) by 0.00008, so no further widening was done. Full sensitivity is in the
  fit file.
- Status table, the share of listed players who did not play, from the report one hour
  before tip on the fit seasons: Out 0.999 (27,765 rows), Doubtful 0.983 (422),
  Questionable 0.483 (3,762), Probable and Available pooled at 0.186 (1,148 and 3,221
  rows; Available alone was higher than Probable, so the monotone rule pooled them).
- Survival table, expected further team games missed by games missed so far, with the
  class read from the report's reason text:

  | Missed so far | 0 | 1 | 2-3 | 4-7 | 8-15 | 16-30 | 31+ |
  |---|---:|---:|---:|---:|---:|---:|---:|
  | Long | 13.9 | 19.9 | 21.3 | 22.2 | 20.8 | 23.8 | 18.5 |
  | Short | 3.7 | 4.7 | 5.8 | 7.1 | 9.5 | 13.4 | 13.7 |

  38,505 observations; 548 spells ran to the end of a regular season and count the games
  remaining. The long class is used because its bucket-0 value exceeds short's.
- Class stems, frozen: surgery, repair, tear, torn, rupture, fracture, reconstruction,
  season, achilles. No row or no reason text is short.
- Name resolution, frozen: lowercase, accents and punctuation removed, hyphen to space,
  generational suffix removed; the team-season box-score roster first, then a name unique
  across the loaded box-score seasons 2020-21 to 2025-26. Aliases: "Martin Jr., Kenyon"
  is ESPN's KJ Martin; "McGriff, Cameron" is Cam McGriff. Coverage per season, resolved
  report rows and box-score minutes under unique names: 2021-22 99.41% and 100%; 2022-23
  99.79% and 100%; 2023-24 99.87% and 100%; 2024-25 99.82% and 100%; 2025-26 98.44% and
  100%. Games without a qualifying final-point report: 0.00%, 0.08%, 0.00%, 0.00% and
  0.15%, against a 5% limit. The 5(i) wording was amended before any fit, as recorded in
  the plan.
- Fit-season comparison, in-sample and for context only: 3,690 qualifying games, log loss
  0.6168 against 0.6291 without the term, Brier 0.2139 against 0.2192, accuracy 66.4%
  against 65.1%, calibration slope 0.838 against 0.833.

### Test rule

From decision 6 of the plan, verbatim in substance. Seasons 2024-25 and 2025-26, regular
season, games with a qualifying report at the final point, v2 against v1 on the identical
set, both from ratings frozen at the previous ET date.

- **T1 (hard):** paired Brier, v2 minus v1, with a 10,000-draw bootstrap over game dates;
  the 95% interval entirely below zero, and the difference negative in each season.
- **T2:** pooled log loss not worse than v1.
- **T3:** calibration slope not lower than v1's by more than 0.02.
- **T4 (bug check):** both seasons pooled at Dec 1, Feb 1 and Apr 1, with the simulator
  carrying current absences: make-playoffs Brier not worse than v1 by more than 0.005 and
  win-total RMSE not worse by more than 0.25 at any checkpoint; forecast sums hold.
- **Reported only:** the morning point, games where the absence gap is at least 2 points,
  ESPN's stored spread where present (its timing is unknown), per-season tables, coverage.

Pass is T1 to T4 together. A fail, or a void (more than 5% of a test season's games
without a qualifying report), stops the work: the result is recorded here and the owner
gets a recommendation. Nothing is refit after a test number is seen.

Disclosure: 2025-26 was among the seasons seen when v1's model form was chosen, which
favors v1, so T1 is conservative. Two test seasons is thin; the sealed ledger remains the
real test. The harness was smoke-tested on fit seasons 2022-23 and 2023-24 only, to check
that it completes; that output is not a result and was not kept.

**2026-11-02, injury test result.** Run once, after the registration commit, on 2024-25
and 2025-26: 2,460 qualifying games of 2,469 (`docs/live/evaluation-injury.json`).

- **T1 passed:** Brier −0.0051 against v1, 95% interval −0.0081 to −0.0022 over 327 game
  dates, negative in each season (−0.0057 and −0.0046).
- **T2 passed:** log loss 0.5856 against 0.5991.
- **T3 passed:** calibration slope 0.875 against 0.886.
- **T4 passed:** make-playoffs Brier 0.1162 against 0.1125 at Dec 1, 0.0869 against 0.0917
  at Feb 1, 0.0587 against 0.0544 at Apr 1; win-total RMSE 7.28 against 7.14, 4.53 against
  4.38, 1.13 against 1.18. All within the registered tolerances.
- Reported only: accuracy 68.9% against 68.1%; Brier at the morning point 0.2045 against
  0.2009 at the final point; the 1,312 games with an absence gap of at least 2 points,
  0.1872 against 0.1973; on the 978 games with a stored ESPN spread, market 0.1965, v2
  0.2008, v1 0.2070, so the market remains ahead and no claim is made against it.

The candidate passes. Shipping still requires the rest of decision 9: a scheduler that has
hit at least 90% of ten-minute slots over three consecutive days, the listed invariants,
and the documentation, all by pull request.

**2026-11-02, shipped as v2 (pull request; not yet merged).** `live-2026.27-v2` is wired into the
scheduled job with the frozen inputs above, copied into `src/lib/season/params.ts` and checked
against `docs/live/injury-fit.json` by `verify:live`. Nothing was refit. What the job now does on
every run, in order:

1. Stores box scores for newly final 2026-27 games in `data/live/boxscores/2027.json`, up to 12
   per run, newest first; a failed fetch is retried on later runs with a health note, and until
   then that game's margin updates ratings unadjusted.
2. Fetches the newest NBA injury report while the slate has an unfinished game: quarter-hour file
   names from now backward (8 names, at most 4 downloads, one request at a time with a retry),
   stopping at the first report whose header timestamp is at or before now and which has rows or
   NOT YET SUBMITTED for both teams of every slate game not postponed or canceled. Every file it
   downloads is recorded in `data/live/reports/2026-27/{slate}.json`, so none is downloaded twice;
   usable reports are stored as parsed rows keyed by header timestamp. If none is confirmed, the
   last good report under 24 hours old is used and flagged stale; otherwise availability is
   missing and absences are zero. ESPN's injury list, with its return dates, is also stored, and
   never used.
3. Seals. v1 writes its morning seal exactly as before. v2 writes a morning seal and, on the first
   run with `0 < tip - now <= 60 minutes`, a final seal, both from full-strength ratings frozen at
   the previous ET date, with the report's expected absences, the top three drivers per side, the
   flags, and v1's number recomputed from v1's own replay at the same instant.
4. Misses are per version; a v2 game with a morning seal and no final seal is scored on the
   morning seal and counted as "no final seal". Records are published per version.
5. Re-simulates the season with current absences (latest report, survival table) and publishes
   state schema 2, including who is counted as out and a display-only current rating.

Implementation choices that the plan did not spell out, made without sight of any result:

- In the live replay, a finished 2026-27 game's final point is the latest stored report at or
  before tip, the closest to what its final seal used. Games before this change have no stored
  report, so their adjustment uses the rotation only, as the engine does for any game without one.
- The replay keeps each team's latest report rows across the off-season. The live job ignores rows
  from an earlier season, so a team's April list is never read as current; its absences come from
  box scores until a 2026-27 report covers it.
- Pending regular-season games per team count scheduled and in-progress games, matching the order
  in which the simulator charges absences.
- The name index adds the live season's own box scores to the registered 2020-21 to 2025-26 seasons,
  as decided when shipping; per the 5(i) amendment this can only un-resolve a name.

Before merging: the scheduler condition in decision 9 (at least 90% of ten-minute slots over three
consecutive days) is to be checked and recorded here by the person who merges.

2026-11-02, scheduler condition waived by the owner. At 06:56 UTC, when the owner decided to ship,
the self-chaining job had hit 23 of 23 ten-minute slots since 03:00 UTC: 3.9 of the required 72
hours, with no evening game window yet. So decision 9's scheduler condition was not met when v2
shipped. The owner chose to ship rather than leave tonight's 15 games and Wednesday's 14 without v2
seals. The other conditions were met: T1-T4 passed, the invariants and docs are in, and it shipped
by pull request. The measurement continues to about 03:00 UTC on 2026-11-05 and its result will be
recorded here. Any missed or "no final seal" game that results stays on the public record.

2026-11-02, amendment: which reports are usable, and reissued morning seals. Written before any v2
game was scored. The engine, frozen tables and registered test are unchanged.

The live job required rows or NOT YET SUBMITTED for both teams of every slate game. A team with
nobody listed has no section in the PDF, so that rule rejected every report on 2026-11-02 because
the Bucks were absent, and all 15 morning seals were written with availability missing. The plan
says "every slate game", not both teams, and the registered test used these games: its `qualifying`
rule only excludes a final report with a team that has not filed. So the live job was stricter than
what passed.

1. A report is usable when at least half of the slate's games appear on it. A team or game not on it
   has nobody listed. Over the five stored seasons, using each game's morning and final report, the
   old rule voids 11% to 25% of slates a season, requiring every game voids at most 2 slates a season,
   and this rule voids none. An unknown team name still fails closed.
2. A morning seal with availability missing is reissued once, with `sealKind: "reissued"`, by the
   first run that has a usable report and is more than an hour before tip. It is priced like any seal
   from the same frozen ratings, carries its true issue time, and leaves the original row in place.
   The issue is decided by a report arriving, never by anything about the game.
3. A game is scored on its final seal, else its reissued seal, else its morning seal, and without a
   final seal it still counts as "no final seal". "Morning seals' Brier" uses the reissued number
   where one exists. Anyone can recompute it from the original rows, which remain in the ledger.
4. Report problems set `reportProblem` in `health.json` and open one issue per slate.

2026-11-03, amendment: teams that have not filed, and complete driver lists. Written before any
2026-11-04 seal. The engine (`src/lib/season/injury-model.ts`), the frozen tables in `params.ts`,
`docs/live/injury-fit.json`, `docs/live/evaluation-injury.json` and the model version are unchanged.

A team the NBA report marks NOT YET SUBMITTED has no rows, so every seal counted nobody for it until
it filed, usually in the evening. On 2026-11-02 the 11:30 report had eight slate teams unfiled. The
Pacers sat at 43% all day and fell to 12% at the final seal; the Warriors went from 72% to 44% and the
Magic from 76% to 63%. The season simulation was already counting those teams' current absences, so
the odds page knew what the seals ignored.

1. When the report in use marks a team NOT YET SUBMITTED, that side's expected absence is the team's
   expected absence for this game from current absences, the same quantity the season simulation
   charges the team for its next game. It is computed with the engine's exported functions on a copy
   of the seal's frozen tracker: the report in use becomes the team's latest word, as it does for the
   published state, `currentAbsences` gives the players, and `simulationAbsences` with one pending game
   gives each player's charge. In practice this counts the players who missed the team's last game. It
   applies to morning, reissued and final seals alike. Rows record it as
   `unfiled: { home, away }`, and that side's drivers are those players, with no status. A side the
   report covers keeps the existing rule exactly. A team that is simply not on the report still has
   nobody listed, and a seal with availability missing still has no absences.
2. New v2 seal rows store every listed or counted player with positive points per side, largest
   first, and carry `driversComplete: true`. For flagged rows `verify:ledger` drops the three-driver
   cap and requires each side's drivers to add up to that side's `absencePoints` within 0.01, sorted
   largest first, with a status on every driver of a side the report covers. Unflagged rows keep the
   old rule. Drivers are stored beside the number and never feed it; a test checks that the number is
   the engine's from the absence terms alone.

The registered test is unaffected. Its `qualifying` rule excluded every game whose final-point report
had a team that had not filed, and in the stored 2024-25 and 2025-26 reports no final point did. So
no tested behaviour changes. Unfiled teams appear only at the morning point, which the test reported
but did not gate on.

Evidence, report only (`scripts/live/evaluate-unfiled.ts`, the registered replay harness, nothing
refit). On the 745 games of 2024-25 and 2025-26 with a team unfiled at the morning point, all regular
season, the morning number's Brier is 0.2199 under the old rule and 0.2093 under this one, a paired
difference of -0.0105 with a 95% interval of -0.0195 to -0.0014 (bootstrap over 246 game dates). By
season the difference is -0.0125 (interval -0.0241 to -0.0007) and -0.0085 (interval -0.0222 to
0.0051). The same games' final-point Brier is 0.2094. Against the final-point number, the mean
absolute gap falls from 0.116 to 0.051, and 600 games move closer to it while 142 move farther. The
unfiled sides now count 4.6 points on average, against 5.2 at the final point.

Rows written before this change keep their rule and stay in the record as written; nothing is
backfilled. Their game pages rebuild the rest of the list from the report the seal used, giving those
players only their combined points.

2026-11-04, data note: next-slate reports and projections with the injury term. No change to
sealing, scoring, the frozen inputs or anything the model reads. Each run now also fetches the newest
NBA report when the next ET date with games has scheduled games (the NBA lists the next day's games
on its evening report), and one download is cut and validated per slate with the existing
`reportForSlate` rule and recorded in each slate's day file under the same politeness limits (one
file at a time with pauses, at most four downloads a run, never a file twice for a slate). The
current slate leads exactly as before, so a seal's report is chosen by the same rule from the same
downloads: the latest validated report for its slate at or before now. A next-slate report is only
another stored report for its slate, at or before now, like any other; in particular, when a run's
own fetch fails, the last good one under 24 hours old may now be one stored the evening before,
used and flagged stale as the rule already says.

Projections for every scheduled game in the next seven days now carry an injury term
(`data/live/site/{season}/projections.json`): published full-strength ratings, home court and rest
as a seal sets them, and, for a slate with a usable report (the current slate's report in use, or
the next ET date's latest), exactly the seal rules, unfiled sides included; for other games the
team's expected absence from current absences, the season simulation's charge for that pending game.
Each records its basis (`report` with `reportAt`, or `current-absences`), `absencePoints` and
complete drivers. Projections never enter the ledger or the record, are never scored and are never
compared to the market; `verify:live` checks them, including that no projection key appears in the
ledger. Safety check before merge: on a copy of `live-data` at 7d61656 with every network input
pinned, `main` and this change wrote byte-identical ledger rows at 2026-11-04 11:00 UTC (28 morning
seals) and 23:10 UTC (2 final seals).

2026-11-05, scheduler measurement. From 2026-11-02 03:00 to 2026-11-05 03:00 UTC, 303 of 432 ten-minute
slots had a successful run (70.1%), so decision 9's 90% condition was not met. The owner had waived
it before shipping v2 on 2026-11-02. There were 321 runs in the window: 313 succeeded and 8 failed.
The missed slots:
- 2026-11-03 10:00 to 2026-11-04 04:40 UTC, 112 slots. After the cutover to the live-data branch the
  commit step's `git rm --cached` failed on every run with data to publish. Three failures then stopped
  the chain, and the cron fallback ran only rarely. Fixed by PR #12 (staging) and PR #14 (tests, and
  backoff instead of stopping). No games were scheduled in this window.
- 2026-11-04 09:40 to 09:50 UTC, 1 slot. GitHub returned a server error on both push attempts. The
  next run published normally.
- 2026-11-04 16:00 to 18:40 UTC, 16 slots. The 15:50 run found another run listed as queued, so it
  did not start the next one. No such run exists in the run history. The cron fallback restarted
  the chain at 18:47.
No seal was missed. The measurement was due from a scheduled task that did not run, so it was taken
by hand on 2026-11-05 at 23:20 UTC.

## 2026-11-06, corrections after the independent review

An independent methodology review of 2026-11-05 checked this registration, the frozen evidence and
the live record. Its findings M1, M2, M9, H4 and H5 and its claims audit lead to the corrections
below. Nothing here changes a forecast number, a parameter, a sealing rule or the scoring order.
Earlier entries stay as they were written, and the frozen `evaluation-injury.json` and
`injury-fit.json` are not edited; where they say something the review found unsupported or
overstated, this entry is the correction.

**Policy revisions.** `live-2026.27-v2` keeps its version string and its one record. The behaviour
changes made after its registered test are labeled as policy revisions within that record, each in
force from its pull request's merge on GitHub (`mergedAt`):

| Revision | In force from (UTC) | Pull request | What changed |
| --- | --- | --- | --- |
| 0 | 2026-11-02T06:57:24Z | #6 | Registered policy as shipped |
| 1 | 2026-11-02T16:27:31Z | #8 | Half-slate report gate, reissued morning seals, report-problem alerts |
| 2 | 2026-11-03T05:35:03Z | #9 | Unfiled teams counted from current absences; complete driver lists |
| 3 | 2026-11-04T06:13:03Z | #15 | Next-slate evening reports stored; projections with the injury term |

The table is frozen in `src/lib/season/policy-revisions.ts`; rows are only ever appended. From this
change every v2 seal stores `policyRevision`, the revision in force at its `issuedAt`. Older rows are
never rewritten: their revision is derived from `issuedAt` through the table. `verify:ledger` rejects
a stored value that differs from the derived one, a stored value on another version, and a v2 seal
appended after the base without one. On `live-data` at 71fad7a (147 rows), the 77 v2 seal rows derive
revision 0 for 15 (the Nov 2 morning seals), 1 for 30, 2 for none (there were no games on Nov 3) and
3 for 32. The only v2 rows within 30 minutes of a boundary are the 15 reissued seals of
2026-11-02T16:30:14.894Z, 2 min 43 s after #8 merged; reissued seals exist only in #8's code, so
revision 1 is right for them.

The record stays one v2 record. `/record` adds a breakdown by revision: seal rows of every kind issued
under it, the games filed under it, how many are scored, and their Brier score. Each game is filed
once, under the seal it is scored on (final, else reissued, else original morning; a pending game
under the seal it would be scored on now), so the Nov 2 games, sealed in the morning under revision 0
and reissued and finally sealed under revision 1, count under revision 1. The breakdown is
descriptive and never a comparison of policies: the revisions cover different games, dates and seal
kinds. Wherever the site shows the published model version it now shows the revision too.

**What the registered test covers.** T1 to T4 cover revision 0's final-point endpoint only. The
2026-11-03 entry's "The registered test is unaffected" holds for those original final-point gates and
nothing more: no test covers the reissue rule, the half-slate gate, the unfiled rule at the morning
point, the evening-report fallback, or a live final seal with an unfiled team. The 745-game
unfiled comparison in that entry was run on the test seasons after their outcomes were known; it is
exploratory, not a second confirmatory result. The 2026-11-04 data note's "no change to ... anything
the model reads" is too broad: storing evening reports changes which report a seal falls back to when
a run's own fetch fails. The comment in `params.ts` that each version is one fixed policy is
overstated for v2 for the same reason; that file is frozen, so the revision table is the correction.

**The pre-final scores.** `/record`'s "Morning seals' Brier" scored the reissued seal wherever there
was one, so it was not the morning seal alone. It is replaced by three metrics, each with its number
of games: original morning seals (`sealKind: "morning"` only), reissued seals (only the games that
were reissued), and the latest pre-final seal (reissued, else original morning). `RecordSummary`
keeps `morningBrier` with the meaning it was published with, the latest pre-final seal, so stored
states keep their meaning; the new fields are `originalMorningBrier`, `reissuedBrier` and
`latestPreFinalBrier` with their counts, and `policyRevisions`. The operational order that decides
the score stays as frozen: final, else reissued, else original morning. On `live-data` at 71fad7a:
v2 Brier 0.2120 on 31 scored games; original morning 0.1965 (31), reissued 0.2237 (15), latest
pre-final 0.2137 (31); by revision, 1: 0.2165 (15 games), 3: 0.2077 (16), none filed under 0 or 2.

**Statements corrected.**

- "T1 is conservative" (the disclosure in the injury registration above, the `evaluation-injury.json`
  note, `injury-plan.md`): withdrawn. Both test seasons, 2024-25 and 2025-26, are inside the
  2023-2026 span whose spike informed v1's form (Candidate selection, above), and v2 keeps that form.
  Selection can move the paired contrast either way; there is no demonstrated conservative direction,
  and the test is not an untouched holdout.
- "Registered before any number from the test seasons existed" (`/how-it-works`, the claims ledger,
  the commit message of b8ed95f): the chronology is that v1's form was chosen with sight of
  2023-2026, v1's numbers on those seasons existed before the injury work, and the injury candidate's
  registration (b8ed95f, 2026-11-02T02:53:13Z) was committed before its test result (a599d2d,
  02:55:27Z). It was registered before its own test run, not before any test-season number, and git
  order cannot show that no uncommitted run happened.
- Injuries do not enter only through the report: box-score inference counts in the season odds and,
  since revision 2, on seals for a team that has not filed. Status weights, Probable and Available
  included, measure nonparticipation for any reason, not medical unavailability.
- The model does learn before a game's box score is stored: the final margin updates the ratings
  without the absence adjustment until then. The injury-adjusted ratings are intended to approximate
  full strength and to reduce double counting; they do not guarantee either. Seals use results
  through the previous ET date, and a box score that arrives late can change the replay between a
  game's morning and final seals.
- "Unknown future injuries mostly cancel out": withdrawn; it was never evaluated, and equal means do
  not remove their effect on spread or title odds. "Players return after their expected games,
  playoffs included" is false today (the first defect below).
- "The market is never scored": the market is never a model input, and once a version has 500 scored
  games `/record` shows the market's Brier beside the model's on the scored games with a stored line.
- "Every seal stores every player": only since revision 2; earlier v2 rows keep at most three a side.
- "Future identity data can only un-resolve a name" (`injury-plan.md`, amendment 5(i), and its use
  in the v2 candidate's shipping notes above): not a general property; a later appearance can make an ambiguous name
  unique. The review's audit of stored rows found 5,666 identity differences and none that resolved
  a player with positive prior value: a measured absence of effect, not a guarantee. T4 is likewise
  a reconstruction on realized schedules, not schedules archived at each checkpoint.

**Known defects, until the next model version.** Shown as "Known issues" on `/how-it-works`:

1. In the season simulation an absence still running when the regular season ends costs its team in
   every simulated postseason game; it never expires within a simulation.
2. A box-score-inferred absence for a player not on any report can persist after he has left the team
   or the ten-game rotation window.
3. The return table conditions on another missed game: an inferred absence after k missed games
   always costs the next game in full, and spells cut by a season's end were treated as complete.

**Ledger checks.** `verify:ledger`, and the pipeline's own check before it writes, now also reject:
`issuedAt`, `tipUtc` or `recordedAt` that is not a real UTC instant in the forms the job writes; a
`reportAt` that is not a real ET wall clock, or is later than the seal's issue time on the ET wall
clock (the rule the pipeline uses to choose the report); a reissued seal within an hour of tip
(`decideReissues` leaves those games to the final seal); and the `policyRevision` cases above. The
review's counterexample, a valid final row with `issuedAt: "garbage"` and
`reportAt: "2099-01-01T12:00"`, now fails. A base ref that does not resolve, or whose ledger cannot be
read, fails the check instead of standing for an empty ledger; only `--bootstrap-empty-ledger` lets
a valid commit with no ledger file stand for an empty one. The live job passes `live-data`'s previous
head (or `main`'s HEAD when it bootstraps `live-data`, which carries the frozen ledger) and never
needs the flag. Every row on `live-data` at 71fad7a passes. The times are still the job's own clock
and the git history, with no independent receipt that a seal existed before tip; the review's audit
of 43 ledger-changing commits found no backfill or rewritten row.
