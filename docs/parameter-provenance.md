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
after any backtest result. No recorded process fit them to the original 150,
the frozen 345, or the pooled 360 series.

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
71.4% of the pooled reconstructed series; an in-sample constant at that rate
would be an invalid hindsight fit. It is not used as a headline
baseline because fitting it on all evaluated outcomes would leak the evaluation
period. The rolling climatology instead estimates its rate only from seasons
before each evaluated season and scores 0.2049.

Rating-only comparisons reuse the same logistic scale, home-court treatment,
and exact series solver as the fixed blend. They isolate the input blend while
holding the probability mapping constant.

## Rolling-origin fitted parameters

All regression weights, ridge strengths, and logistic scales are fitted inside
each rolling fold using only earlier seasons. Evaluation begins in 2006 after
a 2003–2005 initialization window and continues through 2026.

Nested calibration is likewise fitted only on earlier rolling predictions. In
the expanded evaluation, game and series calibration both improve Brier and
log loss and are retained for research. Neither mapping is transferred to
production.

## Frozen candidates

### `dynamic_margin_update_v1`

- Frozen: 2026-07-15.
- Rule: split 12% of game-margin residual between opponents and cap carried
  postseason adjustment at ±4 points.
- Historical game Brier: 0.21858 versus 0.21928 static.
- Difference: −0.00070; season-clustered 95% interval includes zero.
- First promotion-eligible season: 2027.

### `rating_gap_player_shrinkage_v1`

- Frozen: 2026-07-26 before executing its expanded rolling comparison.
- Rule: `shrunkPlayerDiff = playerDiff × exp(-abs(srsDiff) / 5)`.
- Historical game difference versus SRS + home: +0.00004, interval includes
  zero.
- Historical series difference: −0.00104, interval includes zero.
- First promotion-eligible season: 2027.

Both registrations are research-only. The pooled history through 2026 cannot
promote them; 2026 is contaminated because registration followed the season.

## Classification of the 360-series reconstruction

The reconstruction is a descriptive evaluation of a fixed configuration:

- **Not fitted by the harness:** production parameters predate the original
  evaluation code and were never changed afterward.
- **Not genuinely prospective:** the parameters were selected in 2026 with
  ordinary knowledge of historical NBA results, and the 2003–2015 extension
  was added after the model existed.
- **Leakage-controlled inputs:** every regular-season snapshot predates its
  series and every pregame state contains only previously completed games.

The permitted statement is: “A fixed configuration, specified before the
original evaluation harness and never refit, scored Brier 0.1840 on 360
reconstructed 2003–2026 series.” The frozen pre-2026 record remains Brier
0.1825 on 345 reconstructed 2003–2025 series.

## Paired bootstrap comparisons

| Contrast | Difference | Series-resampled 95% CI | Season-resampled 95% CI | Conclusive |
|---|---:|---|---|---|
| vs coin flip | −0.0660 | [−0.0813, −0.0509] | [−0.0782, −0.0533] | Yes |
| vs home team | −0.0255 | [−0.0359, −0.0149] | [−0.0343, −0.0165] | Yes |
| vs higher seed | −0.0244 | [−0.0346, −0.0139] | [−0.0333, −0.0155] | Yes |
| vs net rating | −0.0013 | [−0.0093, +0.0066] | [−0.0085, +0.0058] | No |
| vs SRS | +0.0006 | [−0.0062, +0.0072] | [−0.0058, +0.0067] | No |

Negative favors Playoff Pulse. The full blend conclusively beats naive
directional baselines but does not beat simple rating models.
