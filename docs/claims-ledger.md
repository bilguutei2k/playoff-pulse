# Claims Ledger

Generated: 2026-07-27. This ledger gates all public copy. A claim may appear
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
| Frozen 2003–2025 reconstruction | The immutable pre-2026 record under `docs/backtest/frozen-2003-2025/` | Must never be regenerated |
| 2026 isolated holdout | Models fit only on 2003–2025; 85 games and 15 series scored separately | Not prospective candidate evidence: both challengers were registered after the postseason began |
| 2003–2026 reconstruction | Point-in-time forecasts built after the fact under leakage controls | Not contemporaneously issued predictions |
| 2006–2026 rolling origin | Models fitted only on prior seasons after a three-season initialization window | Temporally held out, but not a preregistered prospective track record |
| 2027+ prospective issuance | Immutable forecasts issued before a declared game start | No observations exist yet |

## Supported (may be stated plainly)

1. The rating-only baseline displayed by the product scored **Brier 0.1900**
   on 360 reconstructed 2003–2026 playoff series. The baseline/overlay boundary
   was defined after historical results existed, so this is descriptive, not
   prospective evidence.
2. That baseline conclusively outperforms the naive baselines—coin flip
   (difference −0.0600), directional home-team (−0.0195), and directional
   higher-seed (−0.0183)—with paired 95% bootstrap intervals excluding zero
   under both series and season resampling.
3. The rating-only baseline does **not** outperform the simple rating
   baselines. Its point estimate trails SRS-only by +0.0067 Brier and
   net-rating-only by +0.0048; both intervals include zero.
4. The published Brier validates only the rating-only baseline. Player impact,
   projected minutes, injury status, and manual adjustment form a separate
   scenario overlay that defaults to zero, is always shown beside the baseline,
   and has no point-in-time historical validation.
   The live baseline executes the same probability path as the backtest, but
   current rating values remain manual inputs and are not individually certified
   by the aggregate historical score.
5. In rolling-origin evaluation (2006–2026, 1,760 games, 315 series), no
   richer feature set conclusively beat SRS + home court.
6. Rolling-origin forecasts remain overconfident, especially for series:
   calibration slopes are approximately 0.72 (series) and 0.88 (games).
7. Nested calibration improved Brier and log loss for games
   (0.2209 → 0.2202; 1,592 predictions) and series
   (0.1888 → 0.1888; 285 series). Both mappings are retained inside research
   only and neither transfers to manual production inputs.
8. A rolling prior-only climatology scores series Brier 0.2049 versus 0.1879
   for SRS + home. The difference is conclusive under season resampling.
9. Grouped Murphy decomposition attributes the reference model's advantage
   over climatology mainly to greater resolution. Components are equal-count
   grouped diagnostics with season-clustered intervals, not an exact
   observation-level identity.
10. The dynamic margin-update candidate and smooth rating-gap player-shrinkage
   candidate both have historical comparison intervals that include zero.
   Neither is promoted; both are frozen for first eligible evaluation in 2027.
11. All reconstructed inputs pass leakage assertions
    (`snapshot_as_of < forecastAsOf` and only prior games in each pregame
    state); raw predictions are committed as JSON.
12. Propagating nested game calibration through the exact series solver
    improves the eligible point estimate from Brier 0.1888 to 0.1877, but the
    season-clustered interval for the −0.0012 difference includes zero.
13. The registered `exact_srs_logit_plus_seed_v1` primary challenger improves
    the matched historical point estimate from 0.1888 to 0.1826 (difference
    −0.0063), but its 95% interval [−0.0133, +0.0010] includes zero. It is not
    promoted.
14. The frozen ten-season training-window candidate improves historical game
    Brier by −0.0010 with a season-clustered 95% interval
    [−0.0017, −0.0003]. This is retrospective research, not prospective
    validation, and it is first promotion-eligible in 2027.

## Supported with qualification

| Claim | Required qualification |
|---|---|
| "Baseline Brier 0.1900 vs 0.1833 SRS-only" | The visible rating-only baseline is worse by +0.0067, with a 95% interval including zero; the score does not validate the overlay |
| "Traceable" | Define on first use: every probability links to the code, data snapshot, and evaluation artifact that produced it |
| Series accuracy 72.5% | Higher-seed baseline is 71.4%; Brier/log loss remain the primary proper scoring rules |
| Game calibration helps | Nested historical research only; not transferred to production because input scales differ |
| 2026 scenario lab results | Counterfactual under preserved July roster assumptions; not an issued forecast |
| Sensitivity reliability | Eight of ten grouped observed rates lie inside mean bands; this is not individual probability-interval coverage |
| Historical injury effects | Not estimable: zero eligible point-in-time availability observations across 7,200 player-series opportunities |
| Coherent game-to-series calibration helps | Historical point estimate only; the paired interval includes zero and the mapping is not transferred to manual production inputs |
| Exact-SRS-plus-seed challenger helps | The pooled historical point estimate exceeds the threshold, but its interval includes zero; its 2026 registration is contaminated and the isolated 2026 result is low-powered |
| Ten-season training window helps | Historical game interval excludes zero; the candidate is frozen for a future 2027 check and is not promoted on retrospective evidence |
| 2026 isolated holdout | Baseline series Brier is 0.2195; both challengers are worse on point estimate, all paired intervals cross zero, and both registrations are `CONTAMINATED_2026`; the overlay is not scored |

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
- Player/minutes/injury/manual scenario overlay.

## Rejected or not promoted

- Automatic transfer of historical calibration to manual production inputs.
- Best-of-several candidate selection on a single evaluation period.
- Dynamic or shrinkage candidate promotion on pooled history through 2026.
- Primary or temporal-window challenger promotion on pooled history through
  2026 or on the contaminated single-season holdout.
- Inferring pregame availability from participation observed after the deadline.

## Must not be claimed

- "Outperforms strong baselines."
- Any implication of a live or contemporaneous 2026 forecast track record.
- Any claim that historical BPM/SRS calibration validates subjective production
  ratings.
- Any claim that the published baseline Brier validates the scenario overlay.
- Official-NBA-data sourcing or betting utility.
- Validated individual coverage for sensitivity intervals.
- Measured historical injury benefit.
- Prospective performance before 2027 observations exist.

## Not measured (open gaps)

- Performance on immutable, contemporaneously issued 2027+ forecasts.
- Historical injury/absence effects until sourced point-in-time coverage is
  material.
- Production-equivalent lagged-rotation effects: zero candidate or eligible
  timestamped player-game-log observations and zero completely covered series.
  Clause-level instrumentation records zero rejections for every clause; the
  240-minute, timestamp, and six-player rules did not eliminate anything
  because the required source rows do not exist.
- Individual latent-probability interval coverage, which is not identifiable
  from one binary series result.
- External forecast or market benchmark comparisons: the schema and audit
  exist, but there are zero eligible timestamped observations.

## Mechanical content-selection rules

1. **Featured replay**: most recent completed NBA Finals in the reconstruction
   archive → 2026 San Antonio–New York.
2. **Featured failed series**: incorrect rolling-origin series forecast with
   the highest pregame favorite confidence.
3. **Worst-game examples**: descending Brier loss from
   `evidence.json → worstForecasts.game`, top N as computed.
4. **Failure narratives**: only inputs recorded in the pregame snapshot may be
   cited; no retrospective storylines.
