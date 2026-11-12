# 548 score, Stage 1: registration (DRAFT)

**Status: draft, not frozen.** The lead finalises the wording and fills the "Frozen values"
section from `docs/score/fit.json`. Then `scripts/score/freeze-score.ts` records the SHA-256
of this file and of `fit.json` in `docs/score/freeze.json`. `evaluate-score.ts --era test`
refuses to run unless both hashes still match, and `freeze-score.ts` refuses to run while
any value below reads TO BE FILLED or after a test-era evaluation exists.

Nothing in this test is chosen after the test seasons are read. Every coefficient, penalty,
decay, shrinkage, replacement value and straight-line map comes from the training era. The
test seasons are read once, by one run of `evaluate-score.ts --era test`, after the freeze.
If something turns out to be wrong after that, the fix is a new registration with its own
test on later data. These seasons are not scored again.

## What is tested

Whether the Stage 1 box-score rating (the "548 score", box-score part only) predicts
next-season team results better than the rating part of today's "548 impact". The site
shows Stage 1, labelled experimental and box-score only, only if it passes. If it misses,
it stays off the site and work moves on to Stage 2.

## Data and split

- Built games: `scripts/score/build-games.ts` output, one `ScoreGame` per finished
  regular-season game (ESPN summaries, 2010-11 to 2025-26). Box lines are used for every
  game. Stints are used only where the lineup audit accepted the game (`stints !== null`).
  Play-in, playoff and NBA Cup final games are not in the data.
- **Training era:** seasons 2010-11 to 2019-20 (2011 to 2020 by ending year).
  `fit-score.ts` refuses in code to load a later season.
- **Test:** seasons N + 1 = 2020-21 to 2025-26 (2021 to 2026), with ratings from the end of
  season N (2019-20 to 2024-25). 30 teams × 6 seasons = 180 team-seasons.
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
All training seasons are pooled. `h` is not penalised.

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
4000, 8000} possessions and r ∈ {−4, −3, −2, −1, 0, 1}. The criterion is the
leave-one-season-out RMSE of the team prediction below, on training pairs
(N + 1 = 2012 to 2020); ties keep the earlier grid point. The cross-check, role-aware and
team-net-only metrics use the same φ, k and r.

## The comparator

The rating part of today's number. Production's `recordPlayerGame` runs over every game
in order with the frozen v2 injury parameters (`INJURY_PARAMS`: gRep 0.2, k 1000,
lG 1000, lM 3). Lines are stored as production stores them: minutes rounded to whole
numbers and Game Score to one decimal. A player's value is
`(score + k·gRep) / (minutes + k) − gRep`, Game Score per minute above replacement.

- **Unfloored** (the primary comparator, the stronger form).
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

**Pass:** `RMSE(548 score) ≤ 0.90 × RMSE(comparator, unfloored)`. This is the only gate.

## Reported, not gating

- Bootstrap 95% intervals (2.5th and 97.5th percentiles, 2,000 seeded draws) for
  `RMSE(score) / RMSE(comparator, unfloored)`. One resamples team-seasons. The other
  resamples whole seasons, taking every team-season of each drawn season. Each also gives
  the share of draws at or below 0.90.
- The floored comparator.
- Baselines: last season's team net rating (through its own straight line, fitted on
  training pairs) and all zero (prediction 0).
- The role-aware variant, and its RMSE minus the published score's.
- The cross-check estimator.
- **Team-net-only ablation:** the score with every β = 0, so each player carries only his
  team's adjusted net / 5. It shows how much of any gain comes from the box-score
  coefficients rather than from team quality.
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
  zero, so compare the metrics with each other, not with zero.

## What a result means

- Pass: Stage 1 may go on the site as experimental and box-score only, after the claims
  ledger gains an entry for it. The pass is a statement about team-level prediction over
  these 180 team-seasons. It says nothing about any one player.
- Miss: Stage 1 stays off the site. The comparator remains what the injury model uses
  either way: nothing in this test changes a forecast.

## Frozen values

Filled by the lead from `docs/score/fit.json` before the freeze.

| Item | Value |
|---|---|
| `fit.json` SHA-256 | recorded in `docs/score/freeze.json` by the freeze |
| Input hashes (`fit.json → inputs.combined`) | TO BE FILLED |
| Primary α; h | TO BE FILLED |
| Primary β (11 stats, `fit.json → primary.beta`) | TO BE FILLED |
| Role-aware α, role α, β, interactions | TO BE FILLED |
| Cross-check α, β | TO BE FILLED |
| RAPM penalties per training window; test-window penalties | TO BE FILLED |
| Book φ, k, r | TO BE FILLED |
| Team lines (a, b, c) per metric and last-season-net line | TO BE FILLED |
| Game-level lines (home, g, c) per metric | TO BE FILLED |
| Training coverage (games, games with stints, stints per season) | TO BE FILLED |

## Known limitations, stated before the test

- The score contains `adj_t / 5`, last season's team quality, and the comparator does not.
  Part of any gain may be team quality rather than box-score weights. The team-net-only
  ablation and the last-season baseline are reported so this can be seen.
- Rates from a season are noisy, so the lineup regression's β is attenuated, most for rare
  stats such as steals and blocks.
- The β used to tune φ, k, r and the training lines was fitted on the same training
  seasons, so training-era RMSEs are optimistic. The test seasons are untouched.
- 180 team-seasons give a wide interval on the RMSE ratio. A pass or miss near the bar may
  not be distinguishable from noise; the bootstrap intervals say how much.
- Team and game predictions use the minutes actually played. They measure the ratings,
  and are not forecasts.
