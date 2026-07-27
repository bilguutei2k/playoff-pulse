# Claims Ledger

Generated: 2026-07-26. This ledger gates all public copy. A claim may appear
on the site only in the category listed here, with the required qualification
attached at the point of use. Sources: `docs/backtest/summary.json`,
`docs/backtest/significance.json`, `docs/backtest/research.json`,
`docs/backtest/availability.json`, `docs/backtest/input-audit.json`,
`docs/parameter-provenance.md`, and
`docs/point-in-time-implementation.md`.

## Data regimes (must be labeled at point of use)

| Regime | What it is | What it is not |
|---|---|---|
| 2026 final production state | Completed factual bracket (Knicks beat Spurs 4–1); terminal probabilities are accounting, not skill | Not a forecast track record |
| 2026 preserved scenario | Counterfactual reset using July roster assumptions | Not an issued Finals forecast |
| 2003–2025 reconstruction | Point-in-time forecasts built after the fact under leakage controls | Not contemporaneously issued predictions |
| 2006–2025 rolling origin | Models fitted only on prior seasons after a three-season initialization window | Temporally held out, but not a preregistered prospective track record |
| 2027+ prospective issuance | Immutable forecasts issued before a declared game start | No observations exist yet |

## Supported (may be stated plainly)

1. A fixed model configuration, specified before the original evaluation
   harness existed and never adjusted afterward, scored **Brier 0.1825** on
   345 reconstructed 2003–2025 playoff series.
2. That configuration conclusively outperforms the naive baselines—coin flip
   (difference −0.0675), directional home-team (−0.0264), and directional
   higher-seed (−0.0252)—with paired 95% bootstrap intervals excluding zero
   under both series and season resampling.
3. The fixed configuration does **not** outperform the simple rating
   baselines. Its point estimate trails SRS-only by +0.0024 Brier and
   net-rating-only by +0.0005; both intervals include zero.
4. In rolling-origin evaluation (2006–2025, 1,675 games, 300 series), no
   richer feature set conclusively beat SRS + home court.
5. Rolling-origin forecasts remain overconfident, especially for series:
   calibration slopes are approximately 0.76 (series) and 0.89 (games).
6. Nested game-level calibration improved Brier (0.2201 → 0.2196) and log loss
   on 1,507 eligible predictions. It is retained inside research only.
   Series-level calibration worsened Brier (0.1853 → 0.1862) and was rejected.
7. A rolling prior-only climatology scores series Brier 0.2039 versus 0.1847
   for SRS + home. The difference is conclusive under season resampling.
8. Grouped Murphy decomposition attributes the reference model's advantage
   over climatology mainly to greater resolution. Components are equal-count
   grouped diagnostics with season-clustered intervals, not an exact
   observation-level identity.
9. The dynamic margin-update candidate and smooth rating-gap player-shrinkage
   candidate both have historical comparison intervals that include zero.
   Neither is promoted; both are frozen for first eligible evaluation in 2027.
10. All reconstructed inputs pass leakage assertions
    (`snapshot_as_of < forecastAsOf` and only prior games in each pregame
    state); raw predictions are committed as JSON.
11. Propagating nested game calibration through the exact series solver
    improves the eligible point estimate from Brier 0.1853 to 0.1845, but the
    season-clustered interval for the −0.0007 difference includes zero.
12. The registered `exact_srs_logit_plus_seed_v1` primary challenger improves
    the matched historical point estimate from 0.1853 to 0.1800 (difference
    −0.0054), but its 95% interval [−0.0127, +0.0020] includes zero. It is not
    promoted.
13. The frozen ten-season training-window candidate improves historical game
    Brier by −0.0009 with a season-clustered 95% interval
    [−0.0017, −0.0002]. This is retrospective research, not prospective
    validation, and it is first promotion-eligible in 2027.

## Supported with qualification

| Claim | Required qualification |
|---|---|
| "Brier 0.1825 vs 0.1801 SRS-only" | The full blend is worse by +0.0024, with a 95% interval including zero |
| "Traceable" | Define on first use: every probability links to the code, data snapshot, and evaluation artifact that produced it |
| Series accuracy 72.5% | Higher-seed baseline is 71.6%; Brier/log loss remain the primary proper scoring rules |
| Game calibration helps | Nested historical research only; not transferred to production because input scales differ |
| 2026 scenario lab results | Counterfactual under preserved July roster assumptions; not an issued forecast |
| Sensitivity reliability | Seven of ten grouped observed rates lie inside mean bands; this is not individual probability-interval coverage |
| Historical injury effects | Not estimable: zero eligible point-in-time availability observations across 6,900 player-series opportunities |
| Coherent game-to-series calibration helps | Historical point estimate only; the paired interval includes zero and the mapping is not transferred to manual production inputs |
| Exact-SRS-plus-seed challenger helps | Historical point estimate exceeds the declared future promotion threshold, but its interval includes zero and no future season is available |
| Ten-season training window helps | Historical game interval excludes zero; the candidate is frozen for a future 2027 check and is not promoted on retrospective evidence |

## Research-only (never in production claims)

- Rolling-origin fitted models and calibration mapping.
- Rolling climatology and fitted seed baselines.
- Murphy Brier decomposition.
- Grouped sensitivity reliability diagnostic.
- Dynamic margin-update candidate.
- Rating-gap player-shrinkage candidate.
- Exact-SRS-logit-plus-seed primary challenger.
- Ten-season training-window challenger.
- Game calibration propagated through the exact series solver.

## Rejected or not promoted

- Series-level nested calibration (worsened Brier and log loss).
- Automatic transfer of historical calibration to manual production inputs.
- Best-of-several candidate selection on a single evaluation period.
- Dynamic or shrinkage candidate promotion on history through 2025.
- Primary or temporal-window challenger promotion on history through 2025.
- Inferring pregame availability from participation observed after the deadline.

## Must not be claimed

- "Outperforms strong baselines."
- Any implication of a live or contemporaneous 2026 forecast track record.
- Any claim that historical BPM/SRS calibration validates subjective production
  ratings.
- Official-NBA-data sourcing or betting utility.
- Validated individual coverage for sensitivity intervals.
- Measured historical injury benefit.
- Prospective performance before 2027 observations exist.

## Not measured (open gaps)

- Performance on immutable, contemporaneously issued 2027+ forecasts.
- Historical injury/absence effects until sourced point-in-time coverage is
  material.
- Production-equivalent lagged-rotation effects: zero eligible timestamped
  rotation observations and zero completely covered series.
- Individual latent-probability interval coverage, which is not identifiable
  from one binary series result.
- External forecast or market benchmark comparisons: the schema and audit
  exist, but there are zero eligible timestamped observations.

## Mechanical content-selection rules

1. **Featured replay**: most recent completed NBA Finals in the reconstruction
   archive → 2025 Oklahoma City–Indiana.
2. **Featured failed series**: incorrect rolling-origin series forecast with
   the highest pregame favorite confidence.
3. **Worst-game examples**: descending Brier loss from
   `evidence.json → worstForecasts.game`, top N as computed.
4. **Failure narratives**: only inputs recorded in the pregame snapshot may be
   cited; no retrospective storylines.
