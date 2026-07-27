# Parameter Provenance

Generated: 2026-07-26. This document records how model parameters were chosen,
which data informed each choice, and what the expanded reconstruction may
claim. Input leakage control and parameter provenance are separate questions.

## Verifiable timeline

| Date | Event | Commit / record |
|---|---|---|
| 2026-05-11 | `defaultModelSettings` committed with current values | `ce2ac4a` |
| 2026-05-14 | Original 2016–2025 reconstruction harness added | `a174f0f` |
| 2026-07-14 | Point-in-time lab and rolling-origin research added | `22b51cc` |
| 2026-07-15 | Dynamic update rule frozen | committed research registration |
| 2026-07-26 | Archive extended to 2003; climatology, decomposition, availability audit, and rating-gap shrinkage registration added | current implementation |

`git log --follow -- src/lib/data/model-settings.ts` shows the production
parameters were fixed before the original harness and have not been changed
after any backtest result. No recorded process fit them to either 150 or 345
series.

## Production model

| Parameter | Value | Provenance | Data informing the choice |
|---|---:|---|---|
| `playerWeight` | 0.55 | Domain judgment | None recorded |
| `netRatingWeight` | 0.25 | Domain judgment | None recorded |
| `eloWeight` | 0.20 | Domain judgment | None recorded |
| `homeCourtAdvantage` | 2.2 points | Domain judgment | General basketball knowledge; not fit here |
| `logisticScale` | 6.5 points/logit | Domain judgment | None recorded |
| `simulationIterations` | 10,000 | Computational budget | n/a |

The production scale is not retuned from historical BPM/SRS results. The fixed
reconstruction is underconfident in one large upper bucket, while the
rolling-origin research model is overconfident overall. Those are different
model/input regimes and do not justify a blind production scale change.

## Structural constants and historical inputs

| Item | Value / rule | Provenance |
|---|---|---|
| Rotation minutes | 240 | 48 minutes × five positions |
| Player cap | 40 minutes | Historical rotation heuristic |
| `ELO_POINTS_PER_POINT` | 35 | Historical storage is `1500 + SRS × 35`, so conversion recovers SRS exactly |
| Historical player impact | Regular-season BPM proxy | Distinct from manual production impact |
| Historical adjustment | 0 | Prevents hindsight overrides |
| Availability | `unknown_assumed_available` | No eligible point-in-time observations are present |
| Finals home format through 2013 | 2–3–2 | Era-specific NBA series structure |
| Other covered series | 2–2–1–1–1 | Era-specific NBA series structure |
| 2020 bubble HCA | 0 | Neutral-site structural treatment |

Historical `eloWeight` is therefore literally a 0.2 × SRS contribution. The
type system prevents fitted BPM coefficients from being silently applied to
manual production impact values.

## Baseline parameters

`higher_seed` and `home_team` use a fixed 0.65 directional prior. Team A won
71.6% of the expanded reconstructed series; an in-sample constant at that rate
would score approximately 0.2034, not 0.168. It is not used as a headline
baseline because fitting it on all evaluated outcomes would leak the evaluation
period. The rolling climatology instead estimates its rate only from seasons
before each evaluated season and scores 0.2039.

Rating-only comparisons reuse the same logistic scale, home-court treatment,
and exact series solver as the fixed blend. They isolate the input blend while
holding the probability mapping constant.

## Rolling-origin fitted parameters

All regression weights, ridge strengths, and logistic scales are fitted inside
each rolling fold using only earlier seasons. Evaluation begins in 2006 after
a 2003–2005 initialization window and continues through 2025.

Nested calibration is likewise fitted only on earlier rolling predictions. In
the expanded evaluation, game calibration improved both Brier and log loss and
is retained for research; series calibration worsened both and was rejected.
Neither mapping is transferred to production.

## Frozen candidates

### `dynamic_margin_update_v1`

- Frozen: 2026-07-15.
- Rule: split 12% of game-margin residual between opponents and cap carried
  postseason adjustment at ±4 points.
- Historical game Brier: 0.21815 versus 0.21851 static.
- Difference: −0.00036; season-clustered 95% interval includes zero.
- First promotion-eligible season: 2027.

### `rating_gap_player_shrinkage_v1`

- Frozen: 2026-07-26 before executing its expanded rolling comparison.
- Rule: `shrunkPlayerDiff = playerDiff × exp(-abs(srsDiff) / 5)`.
- Historical game difference versus SRS + home: +0.00005, interval includes
  zero.
- Historical series difference: −0.00083, interval includes zero.
- First promotion-eligible season: 2027.

Both registrations are research-only. History through 2025 cannot promote them.

## Classification of the 345-series reconstruction

The reconstruction is a descriptive evaluation of a fixed configuration:

- **Not fitted by the harness:** production parameters predate the original
  evaluation code and were never changed afterward.
- **Not genuinely prospective:** the parameters were selected in 2026 with
  ordinary knowledge of historical NBA results, and the 2003–2015 extension
  was added after the model existed.
- **Leakage-controlled inputs:** every regular-season snapshot predates its
  series and every pregame state contains only previously completed games.

The permitted statement is: “A fixed configuration, specified before the
original evaluation harness and never refit, scored Brier 0.1825 on 345
reconstructed 2003–2025 series.”

## Paired bootstrap comparisons

| Contrast | Difference | Series-resampled 95% CI | Season-resampled 95% CI | Conclusive |
|---|---:|---|---|---|
| vs coin flip | −0.0675 | [−0.0828, −0.0516] | [−0.0797, −0.0546] | Yes |
| vs home team | −0.0264 | [−0.0372, −0.0156] | [−0.0355, −0.0174] | Yes |
| vs higher seed | −0.0252 | [−0.0354, −0.0147] | [−0.0342, −0.0163] | Yes |
| vs net rating | +0.0005 | [−0.0075, +0.0083] | [−0.0059, +0.0069] | No |
| vs SRS | +0.0024 | [−0.0043, +0.0088] | [−0.0032, +0.0078] | No |

Negative favors Playoff Pulse. The full blend conclusively beats naive
directional baselines but does not beat simple rating models.
