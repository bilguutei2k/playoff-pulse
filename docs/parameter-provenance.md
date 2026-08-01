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

## Classification of the 360-series baseline reconstruction

The reconstruction is a descriptive evaluation of the rating-only baseline:

- **Not refit at separation:** the existing 0.25 net-rating, 0.20 rating-proxy,
  2.2 home-court, and 6.5 logistic-scale coefficients were preserved when the
  player/minutes/injury/manual terms were moved to the scenario overlay.
- **Post-hoc boundary:** the baseline/overlay separation was defined after the
  historical results existed. It cannot be represented as preregistered or
  genuinely prospective.
- **Not genuinely prospective:** the parameters were selected in 2026 with
  ordinary knowledge of historical NBA results, and the 2003–2015 extension
  was added after the model existed.
- **Leakage-controlled inputs:** every regular-season snapshot predates its
  series and every pregame state contains only previously completed games.

The permitted statement is: “The visible rating-only baseline scored Brier
0.1900 on 360 reconstructed 2003–2026 series; this descriptive number does not
validate the separate scenario overlay.” The frozen pre-2026 record remains
Brier 0.1825 on 345 reconstructed 2003–2025 series and is not regenerated.

## Paired bootstrap comparisons

| Contrast | Difference | Series-resampled 95% CI | Season-resampled 95% CI | Conclusive |
|---|---:|---|---|---|
| vs coin flip | −0.0600 | [−0.0731, −0.0469] | [−0.0699, −0.0495] | Yes |
| vs home team | −0.0195 | [−0.0288, −0.0101] | [−0.0274, −0.0118] | Yes |
| vs higher seed | −0.0183 | [−0.0275, −0.0090] | [−0.0261, −0.0108] | Yes |
| vs net rating | +0.0048 | [−0.0054, +0.0146] | [−0.0047, +0.0139] | No |
| vs SRS | +0.0067 | [−0.0022, +0.0154] | [−0.0019, +0.0147] | No |

Negative favors the Playoff Pulse baseline. It conclusively beats naive
directional baselines but does not beat simple rating models. The SRS point
deficit exceeds the 0.005 retirement threshold, but the interval crosses zero,
so the symmetric retirement gate still does not fire.
