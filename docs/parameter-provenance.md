# Parameter Provenance

Generated: 2026-07-15. This document records how every model parameter was
chosen, which data informed each choice, and what the 150-series
reconstruction is therefore allowed to claim. It exists because "the inputs
avoid leakage" is a weaker statement than "the parameters were chosen without
hindsight," and the two must not be conflated.

## Verifiable timeline

| Date | Event | Commit |
|---|---|---|
| 2026-05-11 | `defaultModelSettings` committed with its current values in the repository's first day of history | `ce2ac4a` |
| 2026-05-14 | Historical backtest harness (150-series reconstruction) added | `a174f0f` |
| 2026-07-14 | Point-in-time lab, rolling-origin research, calibration, dynamic candidate | `22b51cc` |

`git log --follow -- src/lib/data/model-settings.ts` shows exactly one commit:
the production parameters were fixed three days before the evaluation harness
existed and have never been modified after any backtest result. No recorded
process fit them to the 150 series.

## Parameter inventory

### Production model (`src/lib/data/model-settings.ts`)

| Parameter | Value | Provenance | Data informing the choice |
|---|---|---|---|
| `playerWeight` | 0.55 | Domain judgment | None recorded |
| `netRatingWeight` | 0.25 | Domain judgment | None recorded |
| `eloWeight` | 0.2 | Domain judgment | None recorded |
| `homeCourtAdvantage` | 2.2 points | Domain judgment (consistent with the commonly cited 2–3 point NBA home edge) | Public basketball knowledge, no fitting |
| `logisticScale` | 6.5 points per logit | Domain judgment | None recorded |
| `simulationIterations` | 10,000 | Computational budget; does not change expected outputs | n/a |

### Structural constants (`src/lib/model/probability.ts`)

| Constant | Value | Provenance |
|---|---|---|
| `PLAYOFF_ROTATION_MINUTES` | 240 | Structural fact (48 minutes × 5 positions) |
| `ELO_POINTS_PER_POINT` | 35 | Chosen at snapshot-construction time; the historical `eloRating` field stores `1500 + SRS × 35`, so `eloToPointScale` recovers SRS exactly. In the backtest the `eloWeight` term is literally `0.2 × SRS`. |
| `INJURY_MULTIPLIER` | 1 / 0.75 / 0.6 / 0 | Domain judgment; unused in the backtest because all historical players are marked healthy |

### Backtest-only constants (`scripts/backtest/baselines.ts`)

| Constant | Value | Provenance | Note |
|---|---|---|---|
| `DIRECTIONAL_PRIOR` | 0.65 | Domain judgment | Affects the `higher_seed` and `home_team` baselines only. The observed higher-seed win rate is 70%; a constant 0.70 forecast would score Brier 0.2100 instead of 0.2125. Playoff Pulse's advantage over even that optimally tuned version remains conclusive (observed −0.0218 shrinks to ≈ −0.0193, still outside the bootstrap interval). The naive baselines are not strawmen. |
| Bubble handling | HCA = 0 | Factual (2020 bubble had no home crowds) | Applied to all margin-based models identically |
| Historical `manualAdjustment` | 0 | Leakage safety: no hindsight adjustments are permitted | |

### Like-for-like guarantee

The `srs_proxy_only` and `net_rating_only` baselines reuse the identical
logistic scale, home-court advantage, series solver, and bubble handling —
only the input mixture differs. The model-versus-rating-baseline contrast
therefore isolates the value of the input blend while holding the
margin-to-probability mapping constant.

### Rolling-origin research models (`scripts/backtest/research-model.ts`)

All regression weights, ridge strengths, and logistic scales are fitted inside
the rolling protocol using only seasons before each evaluation season. These
are the only genuinely fitted parameters in the project, and they are never
used in production.

### Preregistered dynamic candidate

`dynamic_margin_update_v1` (update rate 12%, cap ±4 points) was frozen on
2026-07-15 with first promotion-eligible season 2026. Its 2016–2025 result
(game Brier 0.235332 vs static 0.235335) is research-only by construction.

## Classification of the 150-series result

The 150-series reconstruction is a **descriptive evaluation of a fixed,
pre-specified configuration**. It is:

- **Not fitted**: no recorded process tuned any parameter against the 150
  series; the configuration predates the harness and never changed afterward.
- **Not genuinely out-of-sample**: the configuration was chosen in 2026 by a
  person with ordinary knowledge of 2016–2025 NBA history, there is no
  preregistration predating the evaluated seasons, and no repository history
  exists before 2026-05-11 to rule out informal iteration.

The honest claim is therefore: *"a fixed configuration, specified before the
evaluation harness existed and never adjusted afterward, scored Brier 0.1907
on reconstructed 2016–2025 series."* Any stronger out-of-sample language
belongs exclusively to the rolling-origin evaluation, whose parameters are
fitted strictly on prior seasons.

## Statistical significance of the 150-series comparisons

Paired bootstrap over per-series squared-error differences
(`scripts/backtest/significance.ts`, 10,000 iterations, percentile intervals,
reported under both series resampling and season-clustered resampling; output
in `docs/backtest/significance.json`):

| Contrast | Brier difference | 95% CI (series-resampled) | 95% CI (season-resampled) | Conclusive |
|---|---:|---|---|---|
| vs coinflip | −0.0593 | [−0.0842, −0.0333] | [−0.0812, −0.0359] | Yes |
| vs home_team | −0.0246 | [−0.0426, −0.0067] | [−0.0377, −0.0103] | Yes |
| vs higher_seed | −0.0218 | [−0.0381, −0.0050] | [−0.0355, −0.0081] | Yes |
| vs net_rating_only | −0.0042 | [−0.0174, +0.0083] | [−0.0155, +0.0079] | No |
| vs srs_proxy_only | −0.0029 | [−0.0148, +0.0087] | [−0.0129, +0.0080] | No |

Negative favors Playoff Pulse. The model conclusively outperforms the naive
baselines. Its edge over the simple rating baselines is **not statistically
distinguishable from zero** — consistent with the rolling-origin finding that
richer feature sets did not conclusively beat SRS + home court. This is the
project's central result and must be stated wherever the 0.1907 headline
appears.

Accuracy disclosure: Playoff Pulse's series accuracy (69.3%) is *below* the
higher-seed baseline (70.0%). Accuracy is not the optimization target — a
probabilistic forecast is scored on its stated probabilities, and Brier/log
loss are the proper scoring rules used throughout — but the number must not be
hidden where accuracy is shown at all.
