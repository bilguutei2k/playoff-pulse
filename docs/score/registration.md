# 548 score, Stage 1: registration

**Status: final.** `scripts/score/freeze-score.ts` records the SHA-256 of this file and of
`docs/score/fit.json` in `docs/score/freeze.json`. `evaluate-score.ts --era test` refuses to
run unless both hashes still match. This file, `fit.json` and `freeze.json` are committed and
pushed before the test seasons are read.

Nothing in this test is chosen after the test seasons are read. Every coefficient, penalty,
decay, shrinkage, replacement value and straight-line map comes from the training era. The
test seasons are read once, by one run of `evaluate-score.ts --era test`, after the freeze.
If something turns out to be wrong after that, the fix is a new registration with its own
test on later data. These seasons are not scored again.

## What is tested

Whether the Stage 1 box-score rating (the "548 score", box-score part only) predicts
next-season team results better than the rating part of today's "548 impact", and whether
its box-score weights add anything beyond team quality. The site shows Stage 1, labelled
experimental and box-score only, only if it passes. If it misses, it stays off the site and
work moves on to Stage 2.

## Data and split

- Built games: `scripts/score/build-games.ts` output, one `ScoreGame` per finished
  regular-season game (ESPN summaries, 2010-11 to 2025-26). Box lines are used for every
  built game. Stints are used only where the lineup audit accepted the game
  (`stints !== null`). Play-in, playoff and NBA Cup final games are not in the data.
- ESPN's box scores are empty for every Chicago and New Orleans game from 2012-13 to
  2017-18. Those games are not built, so those two teams are absent from six training
  seasons (28 teams). A team with fewer than 10 built games in a season has its games
  dropped for that season (`withoutStrayTeams`; this removes one stray 2015-16 game). The
  test seasons have all 30 teams.
- **Training era:** seasons 2010-11 to 2019-20 (2011 to 2020 by ending year).
  `fit-score.ts` refuses in code to load a later season.
- **Test:** seasons N + 1 = 2020-21 to 2025-26 (2021 to 2026), with ratings from the end of
  season N (2019-20 to 2024-25). 30 teams × 6 seasons = 180 team-seasons.
- A team-season is a pair only when the team has built games in both N and N + 1.
- Identity: ESPN athlete IDs and ESPN team IDs.

## Definitions

**Possessions.** A team's possessions in a game are the mean of the two teams'
`FGA − ORB + TOV + 0.44 × FTA`, each summed over that team's player lines. A player's
on-court possessions in a game are `team possessions × his minutes / (team minutes / 5)`.
Lines with zero minutes are dropped, as in production.

**Pieces and team-seasons.** A piece is one (player, team, season): sums of his counting
stats and on-court possessions. A team-season has the same sums over all its players. Its
net rating is `100 × (points − opponent points) / possessions`, from final scores and the
summed game possessions.

**Opponent-adjusted net rating.** A possession-weighted simple rating system:
`adj_t = net_t + Σ_o w_to adj_o / Σ_o w_to`, where `w_to` is the possessions team t played
against team o. It is solved by damped fixed-point iteration (half old value, half new),
to a tolerance of 1e-10. Home court is ignored.

**Stats** (k): points, field-goal attempts, free-throw attempts, three-pointers made,
assists, turnovers, offensive rebounds, defensive rebounds, steals, blocks, fouls.
Player rate `x_ik = 100 × stat / on-court possessions`. Team rate
`x̄_tk = 100 × team stat / (5 × team possessions)`.

**Rating of a piece:** `adj_t / 5 + Σ_k β_k (x_ik − x̄_tk)`. A team's possession-weighted
ratings times five equal its adjusted net rating exactly, for any β.

## Estimators

**Primary (published): lineup regression.** One row per stint with possessions. The
response is the home-minus-away margin per 100 possessions, and the weight is the mean of
the two sides' possessions:

`margin = h + (adj_H − adj_A) + β · [Σ_home five (x_i − x̄_H) − Σ_away five (x_j − x̄_A)]`

The offset `adj_H − adj_A` has coefficient one, and `h` is fitted. Every rate, team rate
and adjusted net in a stint's row is computed from the season's sums with that stint's
game removed: its box lines, its result and its schedule entry. The adjusted nets are
re-solved without the game. Ridge on β is relative: the penalty on β_k is
`α × (ZᵀWZ)_kk`. α is chosen from {0, 1e-4, 1e-3, 1e-2, 1e-1} by 5-fold cross-validation
over games (seeded), scored by possession-weighted squared error on held-out stints.
All training seasons are pooled. `h` is not penalised. The coefficients are the same for
every position. This estimator was named as the published one before any real data was
fitted, because it fits the weights directly to lineup results on their own scale.

**Cross-check (reported, not published).** A possession-weighted ridge of
`RAPM total − adj_t / 5` on the full-season deviations `x_ik − x̄_tk`, plus an
unpenalised intercept. There is one row per piece in each training RAPM window whose
player has at least 5,000 RAPM possessions (offence plus defence) in that window. The
same relative ridge applies, with α from {0, 1e-3, 1e-2, 1e-1, 1}, chosen by 5-fold
cross-validation over players. Its rating uses its β in the same formula as the primary.
The intercept is not used.

**Role-aware variant (comparison only).** The primary model plus interactions of assists,
offensive rebounds, defensive rebounds, steals and blocks with `(position − 3)`. Each
interaction is centred within the team-season, possession-weighted, so team ratings still
add up to the adjusted net. Position comes from ESPN's abbreviation: G, PG and SG = 1;
G-F hybrids = 2; F, SF and PF = 3; F-C hybrids = 4; C = 5; anything else or missing
(including "NA") = 3. The piece's position is its most frequent label. The main penalty is
the primary's α. The interaction penalty is chosen by the same cross-validation from
{0.01, 0.1, 1, 10}, restricted to values of at least 10 × α and at least 0.01.

**Game Score in the team frame (comparison only).** The same frame with one regressor:
`adj_t / 5 + s × (g_i − ḡ_t)`, where `g` is Hollinger Game Score per 100 on-court
possessions and `s` comes from a lineup regression fitted exactly as the primary is. It
shows whether the fitted common weights beat Hollinger's hand-set weights inside the same
frame.

**RAPM** (the cross-check target and the owner checks). There is one row per stint and
side with possessions on offence: `y = 100 × points / possessions`, weighted by
possessions. The model is
`y = intercept[season] + h × [home on offence] + Σ offence five o_p − Σ defence five d_q`,
with ridge `λO Σ o_p² + λD Σ d_q²`. Intercepts and `h` are not penalised. The windows are
three seasons: 2012-14, 2015-17 and 2018-20 for training, and 2021-23 and 2024-26 for the
test. In each training window the penalties come from 5-fold cross-validation over games:
first λO = λD over {250, 500, 1000, 2000, 4000, 8000, 16000}, then the 3 × 3 grid of
(best ÷ 2, best, best × 2) for each penalty. The test windows use the 2018-20 window's
choice.

## The score on a date (the book)

A player's value from his pieces up to a date, with the current season's piece
season-to-date (team rates and adjusted net to date):

`value = (Σ_p w_p rating_p + k r) / (Σ_p w_p + k)`, with `w_p = possessions_p × φ^(seasons ago)`.

φ, k and r are chosen from φ ∈ {0, 0.25, 0.5, 0.75, 1}, k ∈ {0, 250, 500, 1000, 2000,
4000, 8000} possessions and r ∈ {−10, −8, −7, −6, −5, −4, −3, −2, −1, 0, 1}. The criterion
is in-season: the leave-one-season-out RMSE of game margins predicted as
`home + g × Δ(Σ share × v) + c × Δu` from the values each team's players held before the
game, over every training game with N + 1 = 2012 to 2020. Ties keep the earlier grid point.
The site shows the rating on a date, and a criterion that only looked at the end of a
season chose φ = 0, which leaves every player without a rating when a season starts; that
was seen on training data and changed before the freeze. The season-to-season team RMSE of
every grid point is kept beside the criterion in `fit.json`. The cross-check, role-aware,
team-net-only and Game Score frame metrics use the same φ, k and r.

## The comparator

The rating part of today's number. Production's `recordPlayerGame` runs over every game
in order with the frozen v2 injury parameters (`INJURY_PARAMS`: gRep 0.2, k 1000,
lG 1000, lM 3). Lines are stored as production stores them: minutes rounded to whole
numbers and Game Score to one decimal. A player's value is
`(score + k·gRep) / (minutes + k) − gRep`, Game Score per minute above replacement.

- **Unfloored** (the gating comparator).
- **Floored at zero**, as production's `lostValue` does (reported).

Two departures from production follow from the data: the book starts with 2010-11 rather
than 2020-21, and it sees regular-season games only, because the built games have no
playoffs.

## The test

**Team prediction** for each metric:
`prediction = a + b × Σ_i share_i × v_i + c × u`, where:

- `share_i` is the player's share of the team's minutes in N + 1 (shares sum to one);
- `v_i` is his value at the end of season N;
- a player with no value, or under 250 minutes in season N (all teams), gets `v_i = 0`,
  and `u` is the summed share of those players;
- `a`, `b` and `c` are fitted per metric by least squares on training pairs
  (N + 1 = 2012 to 2020) and frozen.

**Actual:** the team's net rating per 100 possessions in season N + 1, with box-estimated
possessions, regular season.

**Endpoint:** RMSE over the 180 team-seasons.

**Pass: three conditions, all required.**

1. `RMSE(548 score) ≤ 0.90 × RMSE(comparator, unfloored)`. This is the owner's bar: the
   new score's error must be at least 10% lower than the current number's.
2. `RMSE(548 score) < RMSE(team-net-only ablation)`. The ablation is the score with every
   β = 0, so each player carries only his team's adjusted net / 5.
3. `RMSE(548 score) < RMSE(last season's team net baseline)`. The baseline predicts a
   team's net rating from its own net rating the season before, through a straight line
   fitted on training pairs.

Conditions 2 and 3 exist because the score carries a share of last season's team net
rating and the comparator does not, so condition 1 could be met by team quality alone.
They require the box-score weights to add something beyond it.

## Reported, not gating

- Bootstrap 95% intervals (2.5th and 97.5th percentiles, 2,000 seeded draws) for
  `RMSE(score) / RMSE(comparator, unfloored)`. One resamples team-seasons. The other
  resamples whole seasons, taking every team-season of each drawn season. Each also gives
  the share of draws at or below 0.90.
- The floored comparator.
- The all-zero baseline (prediction 0).
- The role-aware variant, and its RMSE minus the published score's. The published score
  stays position-neutral whatever this shows; the gap is published.
- The cross-check estimator.
- Game Score in the team frame.
- **Game Score plus team net:** the unfloored comparator's team prediction with one more
  term, `a + b × Σ share × v + c × u + d × (the team's own adjusted net rating in season N)`,
  the four constants fitted on training pairs and frozen. Together with the frame variant
  it shows how much of any gain is the team term and how much is the weights.
- **Game-level check** on the test seasons. Each game's point margin is predicted as
  `home + g × (Σ share × v)_home−away + c × u_home−away`. Here v is the value each player
  held before the game's date, share is his share of his team's minutes in that game, and
  players with no value yet count in u. `home`, `g` and `c` are fitted per metric on
  training games (2012 to 2020) and frozen. Reported: mean absolute error for the score
  and for both comparator forms.
- **The six owner checks.** Each uses player-seasons with at least 1,000 minutes in the
  test era. Cut-offs are percentiles (linear interpolation) among those player-seasons
  within each season. "Shot attempts" means FGA + 0.44 × FTA per 100 on-court possessions,
  true shooting is points / (2 × shot attempts), and position class is G, F or C from the
  map above (≤ 1.5 is G, ≥ 4.5 is C).
  1. High-assist centres: C, assists per 100 in the top fifth of centres.
  2. High-rebound guards: G, total rebounds per 100 in the top fifth of guards.
  3. Inefficient volume scorers: shot attempts per 100 in the top fifth and true shooting
     in the bottom third.
  4. Defence-first players: three-season defensive RAPM in the top fifth and shot attempts
     per 100 below the median.
  5. Stat accumulators: Game Score per minute in the top tenth.
  6. Low-usage role players: shot attempts per 100 in the bottom third and at least 24
     minutes a game.

  For each group the report gives its size and the mean of (rating − three-season RAPM
  total), using the RAPM window that contains the season. Three versions are reported: the
  score in its own units; the score mapped through its own team line as `(a + b × v) / 5`;
  and the unfloored comparator mapped through its team line the same way. A positive mean
  says the metric rates the group above what the lineup data shows. RAPM is shrunk toward
  zero, and group 4 is selected on RAPM itself, so compare the metrics with each other,
  not with zero.

## What a result means

- Pass: Stage 1 may go on the site as experimental and box-score only, after the claims
  ledger gains an entry for it. The pass is a statement about team-level prediction over
  these 180 team-seasons. It says nothing about any one player.
- Miss: Stage 1 stays off the site. The comparator remains what the injury model uses
  either way: nothing in this test changes a forecast.

## Frozen values

From `docs/score/fit.json` (version 2), whose SHA-256 is recorded in `docs/score/freeze.json`.

| Item | Value |
|---|---|
| Input hash (`inputs.combined`) | `4aec8aab861a476f829b6d0b4c9f1fdb1f96b8da3ae475f3def0787041a91ef3` |
| Primary | α 0.001; h 2.6383; 265,457 stints |
| Role-aware | α 0.001; interaction α 0.1; interactions per position step: assists 0.0965, offensive rebounds −0.0472, defensive rebounds 0.0245, steals −0.1313, blocks −0.1199; main coefficients in `roleAware.beta` |
| Cross-check | α 0; 3,190 rows; coefficients in `crossCheck.beta` |
| Game Score frame | s 0.5083; α 0.001 |
| RAPM penalties (λO, λD) | 2012-14: 2000, 2000; 2015-17: 2000, 4000; 2018-20: 2000, 4000; test windows: 2000, 4000; no search ended on the edge of its ladder |
| Book | φ 0.25; k 250 possessions; r −7; criterion 12.3001; none on the edge of its grid |
| Team lines (a, b, c) | score 3.2959, 3.6112, −16.0079; comparator unfloored −6.4093, 129.4551, −12.4951; comparator floored −6.6345, 131.3002, −12.1886; team-net-only 5.0314, 5.0912, −20.1273; role-aware 3.2682, 3.6197, −15.7647; cross-check 3.9202, 4.7288, −16.4231; Game Score frame 3.5170, 3.8661, −17.3266; Game Score plus team net −3.9647, 86.4532, −10.3570 and d 0.3660; last season's net 0.0282, 0.6490 |
| Game-level lines (home, g, c) | score 2.5199, 3.9869, −26.3543; comparator unfloored 2.5130, 198.0349, −13.8717; comparator floored 2.5130, 200.6010, −13.4588 |
| Training pairs | 256 team-seasons; 9,679 games at game level |

Primary coefficients, per 100 on-court possessions, the same for every position:

| Stat | β |
|---|---|
| Points | 0.4803 |
| Field-goal attempts | −0.4154 |
| Free-throw attempts | 0.0697 |
| Three-pointers made | 0.7755 |
| Assists | 0.7386 |
| Turnovers | −0.8712 |
| Offensive rebounds | 0.2530 |
| Defensive rebounds | 0.2172 |
| Steals | 1.1669 |
| Blocks | 0.4049 |
| Fouls | −0.3538 |

Training coverage (built games, games with stints, stints, teams):

| Season | Games | With stints | Stints | Teams |
|---|---|---|---|---|
| 2010-11 | 1,230 | 1,141 | 33,183 | 30 |
| 2011-12 | 990 | 941 | 27,135 | 30 |
| 2012-13 | 1,063 | 613 | 17,755 | 28 |
| 2013-14 | 1,067 | 1,009 | 29,658 | 28 |
| 2014-15 | 1,068 | 987 | 30,130 | 28 |
| 2015-16 | 1,068 | 460 | 13,887 | 28 |
| 2016-17 | 1,067 | 984 | 29,912 | 28 |
| 2017-18 | 1,067 | 916 | 27,540 | 28 |
| 2018-19 | 1,230 | 1,094 | 33,465 | 30 |
| 2019-20 | 1,059 | 987 | 31,267 | 30 |

Training-era results, for the record (`docs/score/evaluation-training.json`). They are
optimistic, because the coefficients, the book and the lines were fitted on these seasons:
RMSE score 2.806, comparator unfloored 3.354 (ratio 0.837), comparator floored 3.351,
team-net-only 3.022, last season's net 3.653, Game Score frame 2.882, Game Score plus team
net 3.042, role-aware 2.780, cross-check 2.724, all zero 4.817. All three conditions hold
on the training era. The cross-check and the role-aware variant are slightly ahead of the
published model there; the published model stays the one named beforehand.

## Known limitations, stated before the test

- The score contains `adj_t / 5`, last season's team quality, and the comparator does not.
  Conditions 2 and 3 guard against a pass on team quality alone, and the two Game Score
  variants show how the gain divides. On the training era most of the gain over the
  current number comes from the team frame and a smaller part from the weights.
- A box-score model cannot see defence beyond steals, blocks, rebounds and fouls. On the
  training era it rates defence-first players about two points per 100 below their
  three-season RAPM, as the comparator does.
- With common coefficients the score rates high-assist centres about one point per 100
  below their three-season RAPM on the training era, where the comparator is about level.
  The role-aware variant's assist interaction points the same way. The owner chose common
  coefficients knowing a role-aware version might predict slightly better; the gap is
  published.
- Rates from a season are noisy, so the lineup regression's β is somewhat attenuated, most
  for rare stats such as steals and blocks.
- Lineup coverage is uneven in the training era: 43% of built 2015-16 games and 58% of
  2012-13 games have stints (ESPN's play feed is missing made baskets in the rest), and two
  teams are missing from six seasons.
- The β used to tune φ, k, r and the training lines was fitted on the same training
  seasons, so training-era RMSEs are optimistic. The test seasons are untouched.
- 180 team-seasons give a wide interval on the RMSE ratio. A pass or miss near the bar may
  not be distinguishable from noise; the bootstrap intervals say how much.
- Team and game predictions use the minutes actually played. They measure the ratings,
  and are not forecasts.
