# 548 score, Stage 2: registration

**Status: final.** Reviewed before the freeze by a second model (gpt-6-astra), whose points
on the pass rule, the chronology and the claims are folded in below. The freeze records the
SHA-256 of this file and of `docs/score/fit-stage2.json` in `docs/score/freeze-stage2.json`.
`evaluate-stage2.ts --era test` refuses to run unless those two hashes match and Stage 1's own
freeze (`docs/score/freeze.json`) still holds. This file, `fit-stage2.json` and
`freeze-stage2.json` are committed and pushed before the test seasons are read for Stage 2.

Every choice in this test comes from the training era: λ, ρ, the checkpoint cadence and
Stage 2's team line (and its game line, which is reported only). Stage 1's coefficients,
book parameters, home term and lines are read from `docs/score/fit.json` as frozen and are
never refitted. The test seasons are read once for Stage 2, by one run of
`evaluate-stage2.ts --era test`, after the freeze. If something turns out to be wrong after
that, the fix is a new registration with its own test on later data.

## This is a second use of the test seasons

The test seasons 2020-21 to 2025-26 were already scored once, for Stage 1
(`docs/score/evaluation.json`), and the aggregate results of that run are known to the
people building Stage 2. Stage 2's choices were made on the training era only, and no test
season was loaded, printed or summarised while building it. Even so, this test reuses
seasons whose aggregate behaviour was already seen, and its result is labelled as a second
use of those seasons wherever it is reported. The clean prospective check is the live
2026-27 season.

## What is tested

Whether the on-court layer improves on Stage 1. Stage 2's rating is a player's Stage 1
box-score value plus δ, the correction the lineup data supports. The test asks two things.
Does that rating predict next-season team results better than Stage 1's value alone, on
Stage 1's own scale and rules? And does it predict the margins of five-man units in games
it has not seen better than Stage 1's value?

## Data and split

The same as Stage 1's registration: the built games of `scripts/score/build-games.ts`
(regular season, 2010-11 to 2025-26); box lines for every built game; stints only where the
lineup audit accepted the game (`stints !== null`); the same stray-team rule; ESPN athlete
and team IDs.

- **Training era:** seasons 2010-11 to 2019-20 (2011 to 2020 by ending year).
  `fit-stage2.ts` refuses in code to load a later season.
- **Test:** seasons N + 1 = 2020-21 to 2025-26, with ratings from the end of season N.
  The same 180 team-seasons as Stage 1.
- Lineup coverage is uneven in the training era. 43% of built 2015-16 games and 58% of
  2012-13 games have stints, and Chicago and New Orleans have no built games from 2012-13 to
  2017-18, so their players have no stints in those seasons.

## The on-court layer

**Stage 1 value.** `b_i` is player i's Stage 1 value on a date, from the frozen book
(`playerValuesOnDate`: φ 0.25, k 250, r −7, the frozen primary coefficients).

**Rows.** For a season and a date D, one row per stint with possessions in that season's
games before D whose lineup audit passed. The response is
`y = 100 × (home points − away points) / w`, where the weight `w` is the mean of the two
sides' possessions. The design `X` has +1 for each home player on the floor and −1 for each
away player.

**Solve.**

`minimise Σ w (y − h − X(b + δ))² + λ Σ_i (δ_i − ρ δ_i,prev)²`

Here `b` is the vector of Stage 1 values on D. A player on the floor with no Stage 1 value
takes the book's replacement value, −7. `δ_prev` is each player's final δ of the previous
season, or 0 if he has none, and `h` is an unpenalised home term. The rating `r = b + δ`
solves `(XᵀWX + λI) r + XᵀW1 h = XᵀWy + λ (b + ρ δ_prev)` together with
`1ᵀWX r + 1ᵀW1 h = 1ᵀWy`, from running sums kept as the season advances
(`src/lib/score/on-court.ts`).

**Players without stints.** A player with no stints in the season keeps `δ = ρ δ_prev`. A
player who misses whole seasons keeps decaying by ρ each season.

**Seasons.** Seasons are walked in order from 2010-11 (δ_prev = 0 for everyone), each
season's final δ feeding the next. The walk does not stop at the end of the training era. On
the test it continues through the test seasons with λ, ρ and every line frozen: a test
season's stints shape δ at that season's later checkpoints and in the seasons after it. No
stint is ever predicted from a solve that saw its own game, and a team-season is predicted
only from ratings that end with the season before it.

**Checkpoints.** δ is re-solved every 21 days from a season's first game date (the
checkpoint on date D uses games before D), and at the season's end (every game).

**Rating on a date.** A player's Stage 2 rating on a date is his Stage 1 value on that date
plus his δ from the latest checkpoint on or before it. Before a season's first checkpoint,
δ is ρ δ_prev.

**The rating at the end of a season** is the Stage 1 value at the end of the season plus the
end-of-season δ.

**Shown and tested ratings differ in one respect.** The rating shown on a date updates the
box value every day and takes δ from the latest checkpoint. The forward stint prediction
below holds both the box value and δ at the checkpoint until the next one, so that nothing
in a prediction comes from the game being predicted. The team prediction uses end-of-season
ratings, where the two coincide.

## The forward stint prediction

This is both the tuning criterion and the second pass condition.

**Why stints.** The on-court layer exists to split credit correctly among teammates. A
whole-game margin only sees the sum over everyone who played, so it barely notices how that
sum is divided, and a criterion built on it is nearly flat in λ. Different five-man units
are on the floor in different stints, so stint margins are where a better split shows up.

**Ratings held at a checkpoint.** At each checkpoint c of a season (date D_c), every player
has the rating `r_i = b_i(D_c) + δ_i(D_c)`: his Stage 1 value on D_c plus his δ from that
checkpoint's solve. Before a season's first checkpoint, `r_i` is his Stage 1 value at the
season's start (from earlier seasons' pieces) plus `ρ δ_prev`. A player on the floor with no
Stage 1 value takes the book's replacement value (−7) as `b`.

**Prediction.** Each stint with possessions, in an audit-accepted game dated from D_c up to
but not including the next checkpoint, is predicted from the ratings held at c:

`ŷ = h + Σ_home five r_i − Σ_away five r_j`

`y` is the home-minus-away margin per 100 possessions, and `h` is fixed at Stage 1's frozen
home term (`fit.json → primary.home`, 2.6383). Nothing is fitted inside the criterion. A
checkpoint on D_c used only games before D_c, so no stint is ever predicted from a solve
that saw its own game. Stints after a season's last in-season checkpoint are predicted from
that checkpoint; the end-of-season solve predicts nothing in its own season.

**Loss.** The possession-weighted mean squared error over all such stints,
`Σ w (y − ŷ)² / Σ w`, with `w` the mean of the two sides' possessions, as in the solve.
Stage 1's loss is the same with δ = 0 everywhere.

## Tuning (training era only)

λ ∈ {500, 1000, 2000, 4000, 8000, 16000, 32000} and ρ ∈ {0, 0.25, 0.5, 0.75, 1}. λ is
extended by doubling or halving, up to four times on each side, while the best cell sits on
the edge of the values tried. ρ is not extended: ρ above 1 would make a player's δ grow in
seasons where he has no data.

The criterion is the forward stint loss, pooled over every stint of audit-accepted games in
seasons 2012 to 2020 (2011 is walked first so that every criterion season starts with a
δ_prev). Ties keep the earlier cell in the order λ, then ρ, ascending.

The whole table is kept in `fit-stage2.json`. For each cell it also holds two criteria that
are recorded and do not choose:

- the leave-one-season-out RMSE of game margins predicted as
  `home + g × Δ(Σ share × v) + c × Δu` from the ratings held before each game (the criterion
  Stage 1's book was tuned on, and this draft's earlier criterion);
- the leave-one-season-out RMSE of the season-to-season team prediction.

The walk with δ = 0 must reproduce Stage 1's frozen game-level criterion
(`fit.json → book.chosen.rmse`) exactly, and it does.

For the record only, the fit also reports the unpenalised slope γ that would best scale the
rating sum in the forward prediction, `h + γ × (Σ_home b − Σ_away b)` for Stage 1 and the
same with r for Stage 2. γ is not used in the rating.

## The test

**Team prediction (condition 1).** This is the same as Stage 1's, metric by metric:
`prediction = a + b × Σ_i share_i × v_i + c × u`.

- `share_i` is the player's share of the team's minutes in N + 1.
- `v_i` is his rating at the end of N.
- A player with no rating, or under 250 minutes in N (all teams), gets `v_i = 0`, and `u`
  is the summed share of those players.

For Stage 2, `v` is the Stage 2 rating, and its (a, b, c) are fitted by least squares on the
256 training pairs (N + 1 = 2012 to 2020) and frozen. For Stage 1, `v` is the Stage 1 value,
with the line frozen in `fit.json` (`teamLines.score`). The actual is the team's net rating
per 100 possessions in N + 1. The measure is the RMSE over the 180 test team-seasons.

**Forward stint prediction (condition 2).** The forward stint loss defined above, over every
stint of audit-accepted games in the six test seasons, for Stage 2 at the frozen (λ, ρ) and
for Stage 1. The walk runs from 2010-11 through the test seasons without a break.

**Acceptance: two conditions, both required.**

1. `RMSE_team(Stage 2) < RMSE_team(Stage 1)` over the 180 test team-seasons.
2. `forward loss(Stage 2) < forward loss(Stage 1)` over the test seasons' stints.

Both comparisons are strict, and neither has a margin, so a very small gain is accepted.
Acceptance is therefore only a rule for what the site may show as an experimental rating.
It is not a finding that Stage 2 is better.

**The stronger statement.** Stage 2 may be described as an improvement on Stage 1 only if,
in addition, the paired bootstrap interval that resamples whole seasons lies entirely below
one for both ratios: the team RMSE ratio and the forward stint loss ratio (the `high` value
of each season-resampled interval in `docs/score/evaluation-stage2.json`). If either
interval reaches one, the two stages are reported as not distinguishable on that measure.
Even then the seasons are reused and six in number, so this is supporting evidence, not
confirmation.

## Reported, not gating

- **Paired bootstrap intervals** (Stage 2 / Stage 1): 2,000 seeded draws, with 2.5th, 50th
  and 97.5th percentiles and the share of draws below one.
  - Forward stint loss: one interval resamples games (all stints of a drawn game), and one
    resamples whole seasons.
  - Team-seasons: one interval resamples whole seasons (every team-season of a drawn
    season), and one resamples team-seasons.
  - Game-level RMSE: one interval resamples whole seasons.
- **The forward stint loss per test season**, for both, and γ for both.
- **Game-level check.** Each test-season game's point margin is predicted as
  `home + g × (Σ share × v)_home−away + c × u_home−away`, with v the rating each player held
  before the game's date: for Stage 2, the Stage 1 value on the date plus δ from the latest
  checkpoint; for Stage 1, the Stage 1 value on the date. Players with no Stage 1 value yet
  count in u. Stage 2's (home, g, c) are fitted on training games (seasons 2012 to 2020) and
  frozen; Stage 1's are frozen in `fit.json` (`gameLines.score`). RMSE and mean absolute
  error over every game of the six test seasons.
- **The size of δ**, at the end of each test season, among player-seasons with at least
  1,000 minutes, pooled over the six test seasons. It is reported as the standard deviation
  of δ beside the standard deviations of the Stage 1 value and of the rating. δ's share of
  the rating's variance is `Cov(δ, r) / Var(r)` (the shares of b and δ add to one), and
  `Var(δ) / Var(r)` is given beside it.
- **δ against the lineup data:** the correlation of δ with (three-season RAPM total −
  Stage 1 value), over player-seasons with at least 1,000 minutes, using the RAPM window
  that contains the season.
- **The six owner checks for Stage 2 beside Stage 1.** These are the definitions,
  1,000-minute rule, RAPM windows and frozen RAPM penalties of Stage 1's registration. Each
  metric is given in its own units, and mapped through its own team line as
  `(a + b × v) / 5`. Stage 2 is fitted on the same stints the RAPM reference is built from,
  so its gaps to RAPM shrink partly by construction. A smaller gap is not by itself
  evidence that Stage 2 is right about those groups.
- **For the record:** the 15 largest positive and the 15 largest negative δ at the end of
  each test season, among players with at least 1,000 minutes that season, with each
  player's Stage 1 value and Stage 2 rating.
- **A reproduction check:** the walk's Stage 1 team RMSE and game mean absolute error,
  beside the numbers in `docs/score/evaluation.json`. They must be equal.

## What a result means

- **Accepted:** the on-court layer may replace Stage 1 as the score shown on the site,
  labelled experimental, after the claims ledger gains an entry for it. It is to be described
  as a small, strongly regularised on-court adjustment to the box-score rating, with the
  measured errors and their intervals. It may be called an improvement only under the
  stronger statement above.
- **Not accepted:** Stage 1 stays as the shown score. δ may still be described, but not as
  an improvement.
- **Whatever the result, it does not show** that any one player's rating or rank is right,
  that δ isolates defence or any single skill, that teammate and opponent effects are
  removed, that δ follows a real change quickly (it is slow by construction), or that any
  forecast improves. The result is a statement about aggregate team-level and stint-level
  errors.
- Either way, the result is reported as a second use of the test seasons. The live 2026-27
  season is the clean check.
- Nothing in this test changes a forecast.

## Frozen values

From `docs/score/fit-stage2.json` (version 2), whose SHA-256 the freeze will record.

| Item | Value |
|---|---|
| Input hash (`inputs.combined`, same as Stage 1's) | `4aec8aab861a476f829b6d0b4c9f1fdb1f96b8da3ae475f3def0787041a91ef3` |
| Stage 1 fit (`fit.json`) SHA-256 | `5213d2cdf96f2fd6465829b1e1d1eb2b4e86c534ebc6f4f12943166de082ee1d` |
| λ, ρ | 16000, 1 |
| Criterion at the chosen cell | forward stint loss 10197.000 (Stage 1 alone: 10200.542), ratio 0.99965 |
| Fixed home term h | 2.6383 (`fit.json → primary.home`) |
| Criterion data | 233,347 stints of 7,991 audit-accepted games, 767,090 possessions, seasons 2012 to 2020 |
| λ edge | none: the best λ, 16000, is inside the grid, so no extension was needed |
| ρ edge | ρ 1 is the top of the grid, which is not extended |
| Checkpoints | every 21 days from the season's first game, and the season's end |
| Stage 2 team line (a, b, c) | 2.7032, 3.3264, −15.1394 |
| Stage 2 game line (home, g, c), reported only | 2.5184, 3.5881, −25.4064 |
| Stage 1 lines (from `fit.json`) | team 3.2959, 3.6112, −16.0079; game 2.5199, 3.9869, −26.3543 |
| Training pairs | 256 team-seasons; 9,679 games at game level |
| γ, for the record | Stage 1 0.925 (loss 10200.050); Stage 2 at the chosen cell 0.863 (loss 10195.019) |

The tuning table: the best forward loss at each λ, over ρ, and its gain on Stage 1.

| λ | Best forward loss | At ρ | Below Stage 1 |
|---|---|---|---|
| 500 | 10245.062 | 0.25 | −0.436% |
| 1000 | 10219.481 | 0.25 | −0.186% |
| 2000 | 10205.542 | 0.5 | −0.049% |
| 4000 | 10199.336 | 0.75 | 0.012% |
| 8000 | 10197.033 | 0.75 | 0.034% |
| 16000 | **10197.000** | 1 | **0.035%** |
| 32000 | 10197.698 | 1 | 0.028% |

The surface is steep below λ 4000 and flat from 8000 to 32000: λ 8000 at ρ 0.75 is within
0.03 of the chosen cell. On the same table, the game-level criterion would have chosen
λ 32000, ρ 1 (12.2770, on the table's top edge; an earlier run found λ 64000 worse at
12.2822). The season-to-season team criterion would have chosen λ 8000, ρ 0.75 (2.7369).
At the chosen cell they are 12.2801 and 2.7481.

The forward loss is mostly possession noise. With h alone (every rating zero) it is
10274.05. Stage 1 takes 73.51 off that, and Stage 2 takes a further 3.54, about 4.8% of
Stage 1's own gain.

Training-era results, for the record (`docs/score/evaluation-stage2-training.json`). They
are optimistic: Stage 1's coefficients were fitted on these same stints, and λ, ρ and the
lines were chosen on these seasons.

| | Stage 2 | Stage 1 | Ratio |
|---|---|---|---|
| Forward stint loss (233,347 stints) | 10197.000 | 10200.542 | 0.99965 |
| Team RMSE, frozen lines (256 pairs) | 2.7144 | 2.8065 | 0.967 |
| Team RMSE, leave-one-season-out | 2.7481 | 2.8449 | 0.966 |
| Game RMSE, frozen lines (9,679 games) | 12.2763 | 12.2965 | 0.998 |
| Game RMSE, leave-one-season-out | 12.2801 | 12.3001 | 0.998 |
| Game mean absolute error, frozen lines | 9.6325 | 9.6533 | |

Both acceptance conditions hold on the training era: the team RMSE with frozen lines and
with lines refitted leaving each season out, and the forward loss, which is chronological
and has nothing to leave out. The forward loss ratio's bootstrap interval is 0.99950 to
0.99980 resampling games and 0.99947 to 0.99984 resampling seasons, with every draw below
one in both. These intervals describe the training era after λ and ρ were chosen on it:
they leave out the uncertainty of that choice, and resampling seasons does not fully
capture the dependence that carried corrections create between seasons. Two of the nine seasons,
2017-18 and 2019-20, are slightly worse for Stage 2. The team ratio's interval by whole
seasons is 0.935 to 0.995 (median 0.967). Among 1,000-minute player-seasons, δ has a
standard deviation of 0.75 against 2.56 for the Stage 1 value, and its covariance share of
the rating's variance is 11.6% (an accounting split between the two parts, not variance
that δ explains on its own). Its correlation with (three-season RAPM − Stage 1 value) is 0.44.

## Known limitations, stated before the test

- **The box value is trusted more than it will deserve.** Stage 1's coefficients were
  fitted on the training stints, so on the training era the box value looks better than it
  will out of sample. The tuning therefore leans toward trusting it, with a large λ and a
  small δ. On the test the box value is out of sample and δ may be under-used. Stage 1 is
  not refitted to correct this.
- **The stint-level criterion still wants heavy shrinkage.** Moving from whole games to
  stints moved λ from 32000 to 16000, not further. δ's standard deviation among regular
  players is about 0.75, under a third of the Stage 1 value's.
- **The forward gain is small against noise.** A stint's margin is mostly possession luck,
  so the gain in the training era is 0.035% of the loss. It is clear of zero in both
  bootstrap intervals, but it is uneven across seasons.
- **A fitted scale below one lowers the training stint loss.** The best scale on the rating
  sum is 0.925 for Stage 1 and 0.863 for Stage 2. It is recorded and not used.
- **The team comparison is between two calibrated pipelines.** Stage 2 has its own team line,
  fitted on training pairs, and Stage 1 keeps its frozen line. The comparison therefore
  tests the calibrated Stage 2 rating against the calibrated Stage 1 rating, not δ alone
  under one shared line.
- **The tuning sits on the top of the ρ grid.** At ρ = 1 nothing fades between seasons by
  itself. A player who is absent keeps his δ unchanged, and an active player's δ moves only
  as far as the new season's stints pull it against λ, roughly a quarter of the way in a
  full season, so δ behaves like a slow average over several seasons of lineup results and
  is late to follow a real change. δ's spread grows from 0.41 in 2010-11 to about 0.8 from
  2014-15 on as evidence accumulates.
- **The three criteria prefer slightly different cells.** The game criterion prefers a
  larger λ, and the team criterion a slightly smaller λ and ρ, than the forward loss.
- **Lineup coverage is uneven,** 43% to 95% of a training season's games. Chicago and New
  Orleans players have no stints from 2012-13 to 2017-18 and carry ρ δ_prev through those
  seasons. Only audit-accepted games enter the forward loss.
- **The owner checks and the RAPM correlation are partly circular.** Stage 2 uses the stints
  RAPM is built from, so the owner checks and the RAPM correlation flatter it by
  construction.
- **These are reused test seasons.** See the section on the second use of the test seasons
  above.
- **Team and game predictions use the minutes actually played,** and stint predictions use
  the players actually on the floor. They measure the ratings and are not forecasts.
