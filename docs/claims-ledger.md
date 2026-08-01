# Claims Ledger

Generated: 2026-08-01. This ledger gates all public copy. A claim may appear
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
| 1984–2026 reconstruction | Point-in-time forecasts built after the fact under leakage controls | Not contemporaneously issued predictions |
| 1987–2026 rolling origin | Models fitted only on prior seasons after a three-season initialization window | Temporally held out, but not a preregistered prospective track record |
| 2027+ prospective issuance | Immutable forecasts issued before a declared game start | No observations exist yet |

## Supported (may be stated plainly)

1. The rating-only baseline displayed by the product scored **Brier 0.1855**
   on 645 reconstructed 1984–2026 playoff series. The baseline/overlay boundary
   was defined after historical results existed, so this is descriptive, not
   prospective evidence.
2. That baseline conclusively outperforms the naive baselines—coin flip
   (difference −0.064520), directional home-team (−0.018589), and directional
   higher-seed (−0.017950)—with paired 95% bootstrap intervals excluding zero
   under both series and season resampling.
3. The rating-only baseline conclusively trails the simple rating baselines:
   SRS-only by +0.011750 Brier and net-rating-only by +0.010242. Both paired
   season-clustered intervals are entirely above zero; the retirement gate fires.
4. The published Brier validates only the rating-only baseline. Player impact,
   projected minutes, injury status, and manual adjustment form a separate
   scenario overlay that defaults to zero, is always shown beside the baseline,
   and has no point-in-time historical validation.
   The live baseline executes the same probability path as the backtest, but
   current rating values remain manual inputs and are not individually certified
   by the aggregate historical score.
5. In rolling-origin evaluation (1987–2026, 3,160 games, 600 series), no
   richer feature set conclusively improved the game-level primary comparison
   against SRS + home court. The exploratory SRS-plus-player series interval is
   barely below zero, but its game interval crosses zero and its BPM proxy is
   not production-equivalent.
6. Rolling-origin forecasts remain overconfident: calibration slopes are
   approximately 0.94 (series) and 0.97 (games).
7. Nested game calibration changes Brier from 0.2161 to 0.2159 across 3,009
   predictions, but direct series-output calibration worsens Brier from 0.1769
   to 0.1785 across 570 series. The direct line is **CLOSED**.
8. A rolling prior-only climatology scores series Brier 0.2006 versus 0.1766
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
    worsens the eligible point estimate from Brier 0.1769 to 0.1773. The
    candidate-minus-raw difference is +0.000392 with season-clustered interval
    [−0.000269, +0.001047]. The nested line is **CLOSED**.
13. The registered `exact_srs_logit_plus_seed_v1` primary challenger improves
    the matched historical point estimate from 0.1769 to 0.1735 (difference
    −0.0034), but its 95% interval [−0.0085, +0.0022] includes zero. It is not
    promoted.
14. The frozen ten-season training-window candidate improves historical game
    Brier by −0.000759 with a season-clustered 95% interval
    [−0.001425, −0.000128]. This is retrospective research, not prospective
    validation, and it is first promotion-eligible in 2027.
15. The frozen FiveThirtyEight mapping covers all 105 eligible series from
    2016–2022. Playoff Pulse scores Brier 0.1843 versus 0.1719 for
    FiveThirtyEight; the paired Playoff-Pulse-minus-538 difference is +0.0124
    with season-clustered 95% interval [−0.0010, +0.0253]. This is a model
    benchmark spanning CARM-Elo/CARMELO and RAPTOR eras, not a market benchmark.
16. Grouped Murphy reliability is 0.001454 Brier for games and 0.002696 for
    series. The predeclared 0.002 series threshold therefore triggered a
    rating-uncertainty candidate. It slightly improves series Brier by 0.000120
    with an interval crossing zero, but worsens grouped series reliability by
    +0.000831 to 0.003527; it remains research-only and is not promoted.

## Supported with qualification

| Claim | Required qualification |
|---|---|
| "Baseline Brier 0.1855 vs 0.1737 SRS-only" | The visible rating-only baseline is conclusively worse by +0.011750; the retirement gate fires and the score does not validate the overlay |
| "Traceable" | Define on first use: every probability links to the code, data snapshot, and evaluation artifact that produced it |
| Series accuracy 74.0% | Higher-seed baseline is 73.0%; Brier/log loss remain the primary proper scoring rules |
| Game calibration point estimate | A negligible game-only change (0.2161 → 0.2159); both direct and propagated series calibration lines are CLOSED |
| 2026 scenario lab results | Counterfactual under preserved July roster assumptions; not an issued forecast |
| Sensitivity reliability | Zero of ten grouped observed rates lie inside mean bands after baseline isolation; this is not individual probability-interval coverage |
| Historical injury effects | Not estimable: zero eligible point-in-time availability observations across 12,900 player-series opportunities |
| FiveThirtyEight comparison | Model benchmark on 105 matched 2016–2022 series; 538 has the better point estimate, while the paired season-clustered interval crosses zero |
| "Coherent game-to-series calibration helps" | Not permitted: the expanded point estimate worsens, its interval includes zero, and the line is CLOSED |
| Exact-SRS-plus-seed challenger helps | The pooled historical improvement is below the 0.005 threshold, its interval includes zero, its 2026 registration is contaminated, and the isolated 2026 result is low-powered |
| Ten-season training window helps | Historical game interval excludes zero; the candidate is frozen for a future 2027 check and is not promoted on retrospective evidence |
| 2026 isolated holdout | Baseline series Brier is 0.2195; both challengers are worse on point estimate, all paired intervals cross zero, and both registrations are `CONTAMINATED_2026`; the overlay is not scored |

## Research-only (never in production claims)

- Rolling-origin fitted models and calibration diagnostics.
- Rolling climatology and fitted seed baselines.
- Murphy Brier decomposition.
- Grouped sensitivity reliability diagnostic.
- Dynamic margin-update candidate.
- Rating-gap player-shrinkage candidate.
- Exact-SRS-logit-plus-seed primary challenger.
- Ten-season training-window challenger.
- Player/minutes/injury/manual scenario overlay.
- SRS rating-uncertainty candidate.

## Rejected or not promoted

- Automatic transfer of historical calibration to manual production inputs.
- Best-of-several candidate selection on a single evaluation period.
- Dynamic or shrinkage candidate promotion on pooled history through 2026.
- Primary or temporal-window challenger promotion on pooled history through
  2026 or on the contaminated single-season holdout.
- Inferring pregame availability from participation observed after the deadline.
- Direct series-output calibration and nested game calibration propagated
  through the exact solver. Both research lines are CLOSED, not deferred.

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
- Timestamped no-vig market comparisons: the market contract remains at zero
  eligible observations. The separate FiveThirtyEight model benchmark has 105
  matched observations and does not satisfy the market contract.

## Mechanical content-selection rules

1. **Featured replay**: most recent completed NBA Finals in the reconstruction
   archive → 2026 San Antonio–New York.
2. **Featured failed series**: incorrect rolling-origin series forecast with
   the highest pregame favorite confidence.
3. **Worst-game examples**: descending Brier loss from
   `evidence.json → worstForecasts.game`, top N as computed.
4. **Failure narratives**: only inputs recorded in the pregame snapshot may be
   cited; no retrospective storylines.
