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
