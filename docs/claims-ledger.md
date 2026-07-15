# Claims Ledger

Generated: 2026-07-15. This ledger gates all public copy. A claim may appear
on the site only in the category listed here, with the required qualification
attached at the point of use. Sources: `docs/backtest/summary.json`,
`docs/backtest/significance.json`, `docs/backtest/research.json`,
`docs/parameter-provenance.md`, `docs/point-in-time-implementation.md`.

## Data regimes (must be labeled at point of use)

| Regime | What it is | What it is not |
|---|---|---|
| 2026 final production state | Completed factual bracket (Knicks beat Spurs 4–1); terminal probabilities are accounting, not skill | Not a forecast track record |
| 2026 preserved scenario | Counterfactual reset using July roster assumptions | Not an issued Finals forecast |
| 2016–2025 reconstruction | Point-in-time forecasts built after the fact under leakage controls | Not contemporaneously issued predictions |
| 2019–2025 rolling origin | Models fitted only on prior seasons, evaluated forward | The only regime supporting out-of-sample language |

## Supported (may be stated plainly)

1. A fixed model configuration, specified before the evaluation harness
   existed and never adjusted afterward, scored **Brier 0.1907** on 150
   reconstructed 2016–2025 playoff series.
2. That configuration **conclusively outperforms the naive baselines** — coin
   flip (−0.059), constant home-team (−0.025), and constant higher-seed
   (−0.022) — with 95% bootstrap intervals excluding zero under both series
   and season resampling.
3. Its edge over simple rating baselines (SRS-only −0.003, net-rating-only
   −0.004) is **not statistically distinguishable from zero**.
4. In rolling-origin evaluation (2019–2025, 587 games, 105 series), **no
   richer feature set conclusively beat SRS + home court**; every candidate's
   interval included zero or harm.
5. Rolling-origin forecasts were **overconfident**: calibration slopes ≈ 0.80
   (series) and ≈ 0.82 (games), with negative intercepts.
6. Nested game-level calibration **worsened** Brier (0.2323 → 0.2339) and was
   rejected; series-level calibration improved it (0.2122 → 0.2108) and is
   retained as research evidence only.
7. The preregistered dynamic margin-update candidate (frozen 2026-07-15,
   before its first promotion-eligible season) was **indistinguishable from
   static** on 2016–2025 (0.235332 vs 0.235335) and was not promoted.
8. All evaluation inputs pass leakage assertions
   (`snapshot_as_of < seriesStartDate`); raw predictions are committed as JSON.

## Supported with qualification

| Claim | Required qualification |
|---|---|
| "Brier 0.1907 vs 0.1935 SRS-only" | Difference is −0.003 with CI including zero; must not be framed as outperformance |
| "Traceable" | Define on first use: every probability links to the code, data snapshot, and evaluation artifact that produced it |
| Series accuracy 69.3% | Must disclose higher-seed baseline = 70.0% and state that Brier/log loss, not accuracy, are the scoring rules |
| Series-level calibration helps | Research subset only (75 eligible forecasts); not applied to production because input scales differ |
| 2026 scenario lab results | Counterfactual under preserved July roster assumptions; not an issued forecast |
| Uncertainty intervals | Sensitivity to stated assumptions, not validated coverage |

## Research-only (never in production claims)

- Rolling-origin fitted models (all five specifications).
- Series-level calibration mapping.
- Dynamic margin-update candidate.
- Strong fitted series baselines (fitted seed, seed+SRS).

## Rejected (state as rejections — these are evidence of process)

- Game-level calibration (worsened Brier).
- Normalized-BPM feature additions (worsened aggregate game Brier).
- Best-of-several candidate selection on a single evaluation period
  (selection bias).
- Dynamic candidate promotion on 2016–2025 evidence.

## Must not be claimed

- "Outperforms strong baselines" without the CI qualification (violates §
  Supported 3–4).
- Any accuracy claim omitting the higher-seed comparison.
- Any implication of a live or contemporaneous 2026 forecast track record,
  including passive phrasings ("the model's 2026 season", "the model called
  the Finals").
- Official-NBA-data sourcing; betting utility.
- Calibration quality without the ≈0.8 slope disclosure.
- Validated coverage for uncertainty intervals.

## Not measured (open gaps — disclose, do not extrapolate)

- Forecast coverage of the uncertainty intervals on genuinely archived future
  predictions.
- Injury/absence effects in historical reconstructions (availability assumed).
- Performance of the production configuration on any season after 2025 under
  preregistration.
- Contemporaneous forecasting skill of any kind.

## Mechanical content-selection rules

Featured content is selected by rule, not editorial choice. The rule is stated
in the UI beside each feature.

1. **Featured replay**: the most recent completed NBA Finals in the
   reconstruction archive → 2025 Oklahoma City–Indiana.
2. **Featured failed series**: the incorrect series forecast with the highest
   pregame favorite confidence → 2020 Milwaukee–Miami (93.8%).
3. **Worst-game examples**: descending `brierLoss` from
   `evidence.json → worstForecasts.game`, top N as computed; no substitutions.
4. **Failure narratives**: only inputs recorded in the pregame snapshot may be
   cited as explanation; no retrospectively invented storylines.
