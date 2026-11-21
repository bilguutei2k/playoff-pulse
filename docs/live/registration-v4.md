# Registration: roster-state model `live-2026.27-v4`

Registered 2026-11-21, before any Stage A gate number was computed. The binding plan is
`/Users/bilguutei/Desktop/548-reviews/2026-11-21-v4-plan.md`; the owner's answers are in
`2026-11-21-v4-run.md` there, the design in `2026-11-21-model-proposal.md` (sections 3 and 5).
This commit contains this file alone and precedes `docs/live/evaluation-v4-stage-a.json`.
v4 is a shadow model: v2 stays the published model, and v4 becomes published only by the
owner's separate decision after Stage B (below). No sentence here or anywhere says v4 beats
v2, v1 or the market, or is more accurate.

## Disclosure (read first)

- The inquiry spike (2026-11-21, Python, outside any repository) ran a roster-state filter once
  on 2019-20 to 2023-24 with parameters chosen on 2010-11 to 2018-19, and read those seasons'
  game Brier, calibration, three checkpoint correlations and a market benchmark. Its numbers
  are in the proposal. Those seasons are development seasons that have been seen, not a holdout.
- Stage A is a registered development check under rolling origin. It can show v4 is not worse
  than v2 and better than v1 on seasons its parameters did not see. It is not an untouched test.
- S1 and M5 were chosen because of what the spike showed (mid-season checkpoints; a calibration
  slope near 1.09 under the spike's variance rule). They are mechanism choices made on
  development data.
- The rating fit's objective is regular-season log loss, so the fits computed in-sample game
  losses on their own training seasons (the frozen set's include 2021-22 to 2023-24). A8 read
  season-level numbers on the design seasons only (2015-16 to 2018-19, 2021-22). 2022-23 and
  2023-24 were not read at season level by any v4 code before this commit.
- No v4 code has computed, printed, logged or stored a forecast, error, score, calibration
  figure, rating table or comparison for any game or team of 2024-25 or 2025-26, and none will
  (`scripts/live/v4/dev-data.ts` refuses those seasons; `tests/roster-state-isolation.test.ts`).
  The step-1 builder read their raw files to write the filter's input and the audit counts them
  only (games, team-games without usable lines, hashes).
- During development the harness reproduced v1's and v2's registered development figures
  (v1 0.594511 on 12,059 games; v1 Brier 0.2192 and v2 0.2139 / 0.6168 on 3,690 games). These
  are registered numbers, not v4 numbers. The gate script was smoke-tested for crashes on one
  season with throwaway parameters; that output was written outside the repository, was not
  read, and decided nothing.

## The model

v4 replaces v2's team ratings plus Game Score absences with one filter over players. The engine
is pure TypeScript in `src/lib/season/`: `roster-state.ts` (M1, the replay, checkpoints,
`warmState`), `minutes-v4.ts` (M2), `availability-v4.ts` (M3, M4, S1 and the season input),
`forecast-v4.ts` (M5), `params-v4.ts` (version and frozen constants) and the optional `v4` input
of `simulate.ts` (M6), exclusive with v2's `absences` and v3's `absenceSchedule`.

**M1, state and filter.** Player impacts θ_p (points per 100 possessions against an average
player), team residuals c_T, one pseudo-player per team and home court h, one Gaussian.
- Daily within a season: θ += N(0, qP) (pseudo-players alike), c += N(0, qC), h += N(0, qH).
- Between seasons: θ ← ρP θ + N(0, qOff) (pseudo alike), c ← ρC c + N(0, (1 − ρC²) τC²), h
  unchanged; the linear map is applied to the whole covariance, cross terms included. Players
  (and pseudo-players) seen in neither of the last two seasons leave the state at the roll.
- Entry: a player on first appearance or on an opening roster with N(μNew, τNew²); a team
  residual with N(0, τC²); a pseudo-player with N(0, τNew²); h starts at N(1, 1) as v1's.
- Observation 1, the margin (home minus away, capped at 30 for the update): Σ_home w θ −
  Σ_away w θ + c_H − c_A + h·[not neutral] + offsets + N(0, σ²), w = 5 · minutes / team minutes,
  offsets ±1.5 for a back-to-back and +1.5 home in a non-neutral playoff game (both fixed).
- Observation 2, box deviation (minutes ≥ 5, full lines): Σ_k β_k (x_pk − x̄_Tk) = θ_p −
  Σ_q (w_q / 5) θ_q + N(0, sBox² · 30 / minutes), with x per 100 on-court possessions as in the
  548 score's Stage 1 (team possessions FGA − ORB + TOV + 0.44 FTA, the mean of the two teams
  when both have full lines, else the team's own) and β the Stage 1 coefficients, copied into
  `params-v4.ts` and pinned to `docs/score/fit.json` by a test.
- One exact joint Kalman update per game. A team-game with team minutes under 200 is the
  pseudo-player with weight 5 and has no observation 2.
- Every game of an ET date is forecast from the state after the previous ET date.

**M2, minutes.** Expected minutes are each member's running average of minutes in games played
(decay α), times presence, rescaled to 240 (weights sum to 5). Presence is 1 after a game played
and halves with each team game missed while not listed; listed players take presence
1 − P(out | status); a player listed on the previous game's rows and unlisted now takes
presence 1. A player belongs to the team of his last appearance. A player with no minutes yet
counts 12 minutes (not fitted). Opening night: the stored roster (live) or, in history, the
players with minutes in the team's first five regular-season games (membership only, disclosed:
it uses later games for who is on the team, never their results). Playoffs: weights raised to κ
before rescaling (replaces the 1.1 multiplier). A team whose members have no positive weight is
its pseudo-player.

**M3, availability.** A player is out only by a report row. Status weights by v2's rule (share
of players listed at each status on the final point of qualifying regular-season games who did
not play; adjacent statuses pooled until absence never rises as status improves), refitted on
2021-22 to 2023-24. NOT YET SUBMITTED: the team's last filed rows of the season stand for every
purpose. v2's report policy carries over unchanged (half-slate gate, reissued morning seals,
next-slate reports, scoring order final, else reissued, else morning). Names resolve by v2's
rule over the open identity seasons 2020-21 to 2023-24 only (history), so no closed-season file
is read for identity.

**M4, return times.** v3 D3's population (v2's spells, censoring never a return; 36,265 at-risk
observations), with the group replacing the class: reason kind (injury, G League, protocols,
administrative, rest; no row is "unlisted") and, for injuries, a diagnosis family matched on the
lowercased text after the first semicolon, by this frozen table in order of precedence (no
semicolon or no match is "other"):

| Family | Keywords |
|---|---|
| acl | acl |
| achilles | achilles |
| surgery | surgery, surgical, repair, reconstruction, procedure |
| fracture | fracture, broken |
| tear | tear, torn, rupture |
| stress | stress |
| strain | strain |
| sprain | sprain |
| bruise | bruise, contusion, contused |
| soreness | sore, tightness, spasm, inflammation, tendin, irritation, pain, discomfort, stiffness |
| management | management, maintenance, recovery, rehab, reconditioning |
| concussion | concussion |
| illness | illness, ilness, covid, flu, sick |

Kinds: a reason starting "Injury/Illness" is an injury; else "g league" or "two-way" is G League;
else "health and safety" is protocols; else a reason starting "rest" is rest; else
administrative. h(group, bucket) = (returns + m · h_class) / (at-risk + m), h_class v3's class
cell fitted by v3's rule on the same observations, buckets v3's. Survival, sampling and the
schedule ordinal are v3 D4 to D6: S(1) is the status weight of the listing (every v4 absence is
listed, so Probable and Available listings take theirs), S(j) = S(j − 1) (1 − h(k + j − 1)), k the
team games missed so far; one duration per listed player per iteration from his own seeded
stream (`v4-return:{season}:{date}:{athlete}`).

**M5, probability and noise scale.** P(home) = E_a[Φ(μ(a) / (c_t · sqrt(σ² + v(a))))] over the
availability a of players listed Questionable or Doubtful (exact enumeration up to six in a
game, else 256 draws seeded by game and date); v(a) = hᵀPh. c_t maximises the win/loss
likelihood of the last 3,000 regular-season games of earlier ET dates (each with its own forecast
mixture), 1 until 1,000 exist; Newton's method on 1/c from the previous value, kept in [0.25, 4].
The state carries this window, so `warmState`'s state contains those games' standardized
margins; it is never output.

**M6, simulator.** Per iteration, the 30 teams' strengths at expected full-health minutes
(regular-season weights), home court and the 30 at playoff weights (κ) are drawn jointly from
the posterior (scale 1), with each team's daily drift Σ w² qP + qC applied to both. Game noise is
c_t · σ. Each listed absence is a sampled duration charged along v3's ordinal (pending regular
games, placeholders, play-in, every series game); a player's points are the team's strength at
full health minus its strength without him (rescaled), at regular-season or playoff weights, and
can be negative.

**S1, background availability.** Each player not currently listed misses his j-th next team
game with probability 1 − A_p(j), A_p(j) = ā_p + (1 − ā_p) · 0.5^((j − 1) / halfLife); ā_p =
(played + m · r_tier) / (games + m) over his team games as a member this season and last, r_tier
the league share by running-average minutes tier (< 12, 12-20, 20-28, 28+). A listed player follows
the same curve from his sampled return. It enters as an expected charge per ordinal
(Σ (1 − A_p(j)) × his points), no extra sampling.

**S2, horizon shrink: not used.** A8 passed without it (below), so v4 has no horizon shrink and `V4_FROZEN.horizonDays` is null. The code path exists in `simulate.ts` and is off.

**Not in v4:** age curves, draft priors, stint data, travel, ESPN return dates, body-part strata,
a blend with v1's rating, pre-2021 injury history (step A4b was not taken: no builder time was
spent on it; noted for a later version).

## The frozen fit

`docs/live/v4-fit.json` (sha256 `4140c227614e6aaddbdc80cf7c56e038cf66981870da16df40de995e542416a9`), assembled by `scripts/live/v4/assemble-fit.ts`
from `docs/live/v4-fit-parts/`. The rating fit ran from commits 9ecdd40f (origin 2015-16) and 90601e69 (the rest; it only capped later origins' rounds), and the forecasts of the registered code reproduce its checkpoint scores exactly; the provenance
block holds the sha256 of every code and data file the fits read.

| Origin (scored season) | σ | sBox | qP | qC | qH | ρP | qOff | ρC | τC | μNew | τNew | α | κ | fit log loss |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2015-16 | 11 | 19.5 | 0.003607 | 0.009 | 0.008458 | 0.8 | 0.2032 | 0.7625 | 1.2 | -1 | 2.44 | 0.7594 | 1 | 0.588055 |
| 2016-17 | 12.1 | 21.45 | 0.003607 | 0.009 | 0.00699 | 0.775 | 0.2032 | 0.7875 | 1.2 | -0.875 | 2.22 | 0.6276 | 1 | 0.586252 |
| 2017-18 | 13.3 | 19.5 | 0.002981 | 0.01198 | 0.005251 | 0.775 | 0.1527 | 0.825 | 1.2 | -0.875 | 2.22 | 0.4715 | 1 | 0.593323 |
| 2018-19 | 13.3 | 19.5 | 0.002981 | 0.01449 | 0.00434 | 0.7875 | 0.1527 | 0.825 | 0.9917 | -0.875 | 2.44 | 0.4286 | 1 | 0.595676 |
| 2019-20 | 13.3 | 17.73 | 0.00271 | 0.01594 | 0.003587 | 0.8 | 0.1262 | 0.8 | 0.8196 | -0.875 | 2.44 | 0.4286 | 1 | 0.596569 |
| 2020-21 | 13.3 | 17.73 | 0.002463 | 0.01929 | 0.002695 | 0.8125 | 0.1043 | 0.8 | 0.6158 | -0.875 | 2.44 | 0.4286 | 1 | 0.599039 |
| 2021-22 | 13.3 | 17.73 | 0.002463 | 0.01929 | 0.002227 | 0.8125 | 0.1043 | 0.7875 | 0.6158 | -0.875 | 2.44 | 0.4286 | 1 | 0.602759 |
| 2022-23 | 13.3 | 16.12 | 0.00271 | 0.01929 | 0.001841 | 0.825 | 0.1147 | 0.775 | 0.5598 | -0.875 | 2.44 | 0.4286 | 1 | 0.603877 |
| 2023-24 | 13.3 | 16.12 | 0.00271 | 0.01929 | 0.001841 | 0.8125 | 0.1147 | 0.75 | 0.5598 | -0.875 | 2.44 | 0.4286 | 1 | 0.606641 |
| frozen (2010-11 to 2023-24) | 13.3 | 17.73 | 0.003279 | 0.01594 | 0.001383 | 0.8 | 0.1527 | 0.7125 | 0.4627 | -1 | 2.44 | 0.3897 | 1 | 0.605350 |

The fit log loss is in-sample on each origin's own training seasons (2012-13 to S − 1).

- **Status weights (frozen):** O 0.9990 (27,620 rows), D 0.9834 (422), Q 0.4827 (3,762), P and A pooled 0.1859 (1,148 and 3,219); v2's were 0.999, 0.9834, 0.4827, 0.1863 with slightly more rows (v2 also resolved names through 2024-25 and 2025-26 box scores).
- **Hazards:** 36,265 at-risk observations; m = 10 (leave-one-season-out log loss 0.4627, 0.4638, 0.4660 for m = 10, 30, 100). Groups with few observations lean on their class cell; Achilles has 2 (see open questions).
- **S1 (every origin):** half-life 1 game, m = 320; frozen tier rates 0.567, 0.745, 0.825, 0.869 (minutes < 12, 12-20, 20-28, 28+).
- **κ:** 1 at every origin, the lower edge of the frozen grid, so the playoff weights equal the regular-season weights (v1's 1.1 multiplier is gone and nothing replaces it).

Fit procedures, all frozen in the scripts named:
- **Ratings** (`fit-ratings.ts`): compass search on regular-season log loss (scored from
  2012-13; 2010-11 and 2011-12 warm the filter). Each round tries every coordinate one step up
  and down (multiplicative 1.5, 1.22, 1.1; ρ ±0.05, 0.025, 0.0125; μNew ±0.5, 0.25, 0.125), takes
  the best of the improving moves and their combination, and shrinks the step when none
  improves. Origin 2015-16 starts at the spike's values; each later origin starts at the previous
  origin's result at the finest step for at most three rounds (a cap added during the fit, after
  origin 2016-17's first rounds gained about 1e-5 each, before any season-level or gate number).
  Origin S is fitted on 2010-11 to S − 1; the frozen set is
  origin 2024-25's (2010-11 to 2023-24). Seasons with reports are forecast with the status table
  fitted on report seasons before the origin. Exact checkpoints let a later origin replay only
  its new season for points already evaluated (`fit-worker.ts`).
- **κ** (`fit-kappa.ts`): grid {1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.75, 2, 2.5} by playoff log loss
  (2012-13 to S − 1) with the origin's rating set.
- **Status weights** (`fit-status.ts`): frozen on 2021-22 to 2023-24; leave-one-season-out tables
  score a report season; before-origin tables serve the rating fits.
- **Hazards** (`fit-hazards.ts`): m from {10, 30, 100} by leave-one-season-out one-step log loss;
  m = 10 was chosen, at the grid's edge; the plan fixed the grid, so it was not widened.
- **S1** (`fit-background.ts`): every Monday from November 1 to April 1, each member who played
  his team's last game and is not listed, outcome whether he plays each of its next 60 games with
  usable lines; halfLife and m by mean squared error (A(1) = 1 rules out log loss) on 2011-12 to
  S − 1 per origin. The grid (halfLife 5 to 160, m 5 to 80) put both values on edges at every
  origin, so it was widened once (halfLife 1, 2, 3; m 160, 320, 640) as v2's fit did; the result, half-life 1 and m = 320 at every origin, leaves the half-life on the widened edge, where it stays (one widening only).
  Tiers use running averages with decay 0.15 (fixed).

**Data read, disclosed.** Through `dev-data.ts` only: games 2004-05 to 2023-24, player lines
2010-11 to 2023-24 (`data/season/player-games`, step 1), stored box scores and reports 2020-21 to
2023-24. Box lines are empty for CHI and NOP in 2012-13 to 2017-18 (their team-games take the
pseudo-player path); playoff lines exist only from 2020-21, minutes only, so earlier playoff
games update pseudo-players (`docs/live/v4-player-games-audit.json`).

## A8, the season-level diagnostic (design seasons only)

`corepack pnpm exec tsx scripts/live/v4/evaluate-stage-a.ts --design` wrote `docs/live/v4-a8.json`
(4,000 iterations, 2015-16 to 2018-19 and 2021-22, 150 team-seasons).

| Checkpoint | Make-playoffs Brier v1 / v4 | Limit (v1 + 0.005) | Win RMSE v1 / v4 | Limit (v1 + 0.25) | Result |
|---|---|---:|---|---:|---|
| Dec 1 | 0.1298 / 0.1302 | 0.1348 | 6.208 / 6.162 | 6.458 | within |
| Feb 1 | 0.0741 / 0.0715 | 0.0791 | 3.402 / 3.402 | 3.652 | within |

v4 is within both limits at both checkpoints, so S2 was not applied. This is a diagnostic on seen design seasons, not a gate and not a comparison claim.

## Interpretations and departures from the plan, made before any gate number

1. **Diagnosis families are matched after the semicolon, as written.** ESPN-style reasons put the
   body part before it ("Right Achilles Tendon; Repair"), so the Achilles family holds 2 of 36,265
   observations and Achilles repairs fall under surgery or repair. Open question for the lead:
   match ACL and Achilles on the whole description instead (changes only the hazard tables).
2. **Off-season dynamics keep the cross-covariances** (the linear map on the whole matrix); the
   spike reset them to the diagonal.
3. **Availability-layer tables are leave-one-season-out when scoring a report season**, and
   before-origin inside the rating fits (the proposal's "three report seasons allow only
   leave-one-season-out"); the frozen tables use all three seasons.
4. **M5's window is per ET date** (games of earlier dates) and lives in the state, including,
   live, the standardized margins of 2024-25 and 2025-26 games inside `warmState`'s state. They
   are never output. Open question: whether that reading of section 0 is acceptable.
5. **S1 is fitted by mean squared error**, not log loss, because A(1) = 1; its grid was widened
   once. **κ sits at 1**, the grid's edge; the plan fixed the grid, so it was not widened.
6. **Listed Probable and Available players** take their status weight as S(1); every v4 absence is
   listed. A player's points can be negative (his minutes go to better teammates).
7. **The simulator's noise is c_t · σ** with the posterior covariance at scale 1; regular and
   playoff strengths share each drift increment; playoff points use κ weights.
8. **Playoff box lines exist only from 2020-21** (minutes only), so earlier playoff games update
   pseudo-players; a player with no minutes yet counts 12 minutes.
9. **Names resolve over open identity seasons only** (2020-21 to 2023-24), stricter than v2's
   resolver; v1's and v2's registered figures still reproduce exactly through this path.
10. **The live season's box lines** (`data/live/players`) already hold full lines for every final
    game (235 of 235 at live-data 59a46baa), so step 1 needs no new storage; Phase C must make
    those files a v4 input.
11. **Step 4b (pre-2021 injury history) was not attempted.**

## Wiring (Phase C; not in this commit's scope)

- **W1, rows.** From `V4_FIRST_ET_DATE` each game keeps v1's and v2's rows exactly and gains v4
  morning, reissued and final rows in v2's shape, with `referenceModelVersion` v1 and its
  probability, complete drivers (points lost against expected full-health minutes) and no
  `policyRevision`. v4 and v2 pair by (game, seal kind). v3 is not wired.
- **W2, published state untouched.** `LIVE_MODEL_VERSION`, `state.json`, projections and every
  headline stay v2's, byte for byte. v4 writes `data/live/site/{season}/shadow-v4.json` and
  `data/live/v4/` (a filter checkpoint per ET date, keyed by input hash). v4 runs last in its own
  guard: a failure never stops v1 or v2 sealing and sets a health note. The live season's full
  box lines (`data/live/players/{season}`) become a v4 input, which needs the AGENTS.md rule
  "never a model input" amended for v4 only.
- **W3, checks.** `verify-ledger` rejects a v4 seal before the cutover, without the v1 reference,
  or with a `policyRevision`; the watchdog's missing-seal check covers v4 under its own shadow
  incident kind; `verify:live` checks v4's parameters against the fit file, the shadow file's
  sums, that the published record is v2's, and that no v4 key enters `state.json` or projections.
- **W4, pages.** `/record` gains "In testing: roster-state model v4. Sealing since {date}. Not the
  published forecast." with scored games, Brier and log loss, the small-sample label under 500,
  same-games lines for v2 and v1, no difference column, colour or market line under 500;
  `/how-it-works` gains a short section with this disclosure. Home, game and team pages do not
  mention v4.
- **W5, "548 impact".** Swapped to v4's player strengths only when v4 is published; the value is
  built into the shadow file and the view code behind `publishedModelVersion()`, tested both ways.

## Stage A gates (Phase B; run once, on the lead's go)

In one fresh throwaway clone of the registered head, with nothing else run first:

```
corepack pnpm install --frozen-lockfile
corepack pnpm exec vitest run tests/roster-state.test.ts tests/roster-state-season.test.ts tests/roster-state-isolation.test.ts tests/roster-state-params.test.ts tests/v4-goldens.test.ts tests/season-simulator-golden.test.ts
corepack pnpm exec tsx scripts/live/v4/evaluate-stage-a.ts
```

The script writes `docs/live/evaluation-v4-stage-a.json`, exits non-zero on failure and refuses
to run if the file exists. It first reproduces v1 (development log loss 0.594511 on 12,059
games; Brier 0.2192 on the 3,690 final-point games of 2021-22 to 2023-24) and v2's registered
fit-season figures (Brier 0.2139, log loss 0.6168); any difference is blocking. Every v4 number
for season S uses the set fitted before S; the availability layer's tables leave S out. Reports
from 2021-22 on, none before. Intervals: 10,000-draw bootstrap over game dates.

- **A1, against v1 (hard).** Regular seasons 2015-16 to 2023-24: pooled paired Brier v4 − v1 with
  the 95% interval wholly below zero, and negative in at least 7 of the 9 seasons.
- **A2, against v2, non-inferiority (hard).** The 3,690 final-point games: v4 Brier ≤ v2 + 0.002
  and ≤ 0.2159, and the upper end of the paired difference's 95% interval ≤ +0.004. Reported as
  "not worse than v2 on development seasons" whatever the sign (v2 was fitted on these games).
- **A3, calibration.** 2019-20 to 2023-24 pooled: slope within 0.93 to 1.07 and grouped
  reliability (10 equal-count bins) ≤ 0.002.
- **A4, return times.** Injury listings, leave-one-season-out, still out ten team games later:
  log loss below v3's class table pooled and in at least two of three seasons. (m was chosen by
  leave-one-season-out one-step log loss on these seasons.)
- **A5, season level (hard).** 4,000 iterations, forecast sums valid. Pooled over 2015-16 to
  2018-19 and 2021-22 to 2023-24 (210 team-seasons), at Dec 1, Feb 1 and Apr 1: make-playoffs
  Brier ≤ v1 + 0.005 and win RMSE ≤ v1 + 0.25. On 2022-23 and 2023-24 alone (60 team-seasons):
  ≤ v1 + 0.008 and ≤ v1 + 0.40 at each checkpoint. Opening night, the same seven seasons: win RMSE
  below v1's. Reported beside v2's registered 0.1429, 0.0958, 0.0410 and 6.50, 3.76, 1.07 on
  2021-22 to 2023-24 (not gating). v1 is simulated as T4 did (plain replay, uncertainty scale 1.5).
- **A6.** The property tests above green at the gate's commit.
- **A7, components (reported).** Removing the team residual (τC = qC = 0), the diagnosis families
  (v3 classes), M5's integration (Q/D at expected presence) and S1 must worsen game log loss,
  A4's log loss, game log loss, and Dec 1 and Feb 1 win RMSE respectively. A component that does
  not stays registered; its removal is a recommendation to the lead.

Pass is A1 to A6 together. Reported only: per-season tables, the information sets (report,
none, told who plays) on 2021-22 to 2023-24, games before Dec 1, and the market benchmark on
games with a stored spread. A fail stops for the lead; nothing is refit after a number is seen.
A8 missing after S2, or a failure of A1, A2 or A5, triggers the fallback `live-2026.27-v2.1`
(plan section 6), only on the lead's confirmation.

## Stage B: the prospective shadow record (registered now, read later)

Read once, when 500 games have a scored v4 seal and a scored v2 seal, each on its own scoring
order. D = mean over those games of (v4 Brier − v2 Brier), interval by 10,000-draw bootstrap
over game dates. **B1 passes if D ≤ +0.004 and the interval's lower end is below zero.** At 500
games the standard error of D is about 0.003: with equal models B1 passes about 91% of the time,
with v4 truly 0.0015 better about 97%, with v4 truly 0.008 worse about 9%. It screens out a model
that is clearly worse and cannot show v4 is better; a pass is worded "not worse than v2 over 500
games". Reported with it: calibration slope and reliability; games where the two differ by at
least 0.05; return-time calibration against v2's table; v1 on the same games. The result goes to
the owner with a recommendation; publishing v4 and the W5 swap are the owner's decision. A B1
fail leaves v2 published.

## The record

v4's record starts at its first seal, prospectively, from `V4_FIRST_ET_DATE` (null until Phase
C). Nothing is backfilled. It is labeled small-sample below 500 scored v4 games. The
500-scored-games rule is per version and is not lowered.

## File hashes at registration (sha256)

- `scripts/live/v4/evaluate-stage-a.ts`: `5e705c607ecd29f1784162d2477f44479c1e6b016f55819288e3871f0c3d3839`
- `scripts/live/v4/dev-data.ts`: `70006194c95ccba2bc9aa9710fb4ef12ee8e55267f42bd5bb7d448559b3467f3`
- `scripts/live/v4/season-files.ts`: `e7d3a625054e84c29bbf7474e104abaea3610b081140f7d68886c597ab9f2e81`
- `scripts/live/v4/engine-run.ts`: `7299ac34e135d1dd7a5a7d3f093667bc0054772431f7ebf703f4e36f703ef718`
- `scripts/live/v4/references.ts`: `1d97d5e26536c93ae5cafe21dffc0e236f558683a47453adf1d84b6105bdf006`
- `scripts/live/v4/hazard-data.ts`: `21c5310668e365ad48c637056b343d9f8bdc0c646817bcd7bed852e00525cf79`
- `scripts/live/v4/warm-state.ts`: `f2a5dc11abfd9d7ff454ab80a46b1bc32af9ff4b06473895e7d394b21e96d41f`
- `src/lib/season/roster-state.ts`: `a4464393ce5ea04205399a25e78a7081e77e3efa52c288909aae19a086194d57`
- `src/lib/season/minutes-v4.ts`: `a9949f4d926e0f050a4df9646a007ed6f3808d37606be23d30685106e817ec79`
- `src/lib/season/forecast-v4.ts`: `c038c96c0906b703994a485c4f4e7e48378c903ae04ae4d7f8ad240e392c3ac3`
- `src/lib/season/availability-v4.ts`: `8ab60f69dfab46b654481c98ba6ad5fc81bcf64b1d599dc937f9a5abba4311f7`
- `src/lib/season/params-v4.ts`: `fe3f12de6a5d421a38ee90ca935d8cca02044c8ce315942d8c3069c3ba16c748`
- `src/lib/season/simulate.ts`: `bbd8c1dd5cf383863932cc75febb748873fa52fe9b530164f6c2e60e864916a7`
- `src/lib/season/injury-v3.ts`: `c9175827e43c49b05cb6ed21ffc7b708c1745e034f438d82aa182e79e7a8b54a`
- `scripts/live/eval-metrics.ts`: `94cbce742de885e9157bba6d8a546cee596d3927f7eecb30f2ac3fec5602900e`
- `docs/live/v4-fit.json`: `4140c227614e6aaddbdc80cf7c56e038cf66981870da16df40de995e542416a9`
- `docs/live/v4-a8.json`: `1c03d688c6ba19742ffb6c835e66c6cba2f054f7cb4a0fa07fd7bc3a053495e1`
- `docs/live/v4-player-games-audit.json`: `ddbb81227cec4b04ca0feadb29f17bd790fce4100b138dd69de01bf38983e501`

The golden hashes (`tests/season-simulator-golden.test.ts`, `tests/v4-goldens.test.ts`) and v3's registered files are unchanged.
