# Model development protocol

## Status

Model version: `2026.3-point-in-time-lab`
Research protocol: `rolling-origin-v2`

The production forecast remains a transparent manually configured model. The
historically fitted expected-margin models are research comparators, not a
drop-in replacement for production, because historical BPM/SRS inputs are not
on the same scale as the manually assigned current player and rating inputs.

## Phase 0 — measurement integrity

- Historical regular-season MPG is retained as raw provenance.
- Each historical roster is deterministically converted to a 240-minute
  rotation with a 40-minute player cap.
- Historical availability is `unknown_assumed_available`; no injury history is
  fabricated.
- The historical rating formerly described as Elo is identified as an SRS
  point proxy. The legacy `eloRating` storage field remains for compatibility.
- Verification asserts rotation totals, caps, provenance, and determinism.

## Phase 1 — evaluation protocol

The research harness evaluates 1987–2026 with rolling origin after a
three-season 1984–1986 initialization window:

1. Train only on seasons strictly earlier than the evaluation season.
2. Select ridge strength using season-held-out folds within the available
   training data.
3. Fit expected game margin, then tune the margin-to-probability scale using
   training data only.
4. Score game probabilities and exact pre-series probabilities.
5. Report Brier score, log loss, margin MAE, equal-count reliability groups,
   calibration intercept/slope, and season-clustered bootstrap comparisons.

The harness also includes rolling prior-only climatology, fitted seed-only, and
seed-plus-SRS series baselines.
Raw results and rolling predictions are committed in
`docs/backtest/research.json` so every headline can be independently checked.

## Phase 2 — expected-margin model and exact series solution

The research model is regularized linear expected margin followed by a fitted
logistic probability scale. The parsimonious `srs_home` specification is the
reference model. It evaluates 3,160 games and 600 series from 1987–2026.

Production series probabilities no longer use Monte Carlo for their central
estimate. Dynamic programming enumerates every possible remaining path and
returns exact winner, final-score, and expected-games distributions from any
valid series score.

## Phase 3 — uncertainty

Uncertainty simulations draw one latent strength adjustment per team and reuse
it across that simulated path. They also sample home-court and logistic-scale
uncertainty, plus questionable-player availability. This avoids treating every
game as an unrelated estimate.

The current uncertainty constants are disclosed assumptions, not empirically
calibrated coverage guarantees:

- team strength standard deviation: 0.75 points;
- home-court standard deviation: 0.40 points;
- logistic-scale relative standard deviation: 8%;
- questionable play probability: 55%;
- displayed interval: 10th–90th percentile.

These intervals describe sensitivity to the stated assumptions. A grouped
reliability diagnostic places observed rates inside the mean sensitivity band
for zero of ten equal-count groups after the evidenced baseline was isolated;
this is not individual interval coverage,
because one binary outcome does not identify a series' latent probability.

## Phase 4 — feature ablation decision

Candidate models tested net rating, normalized BPM rotation impact, a collinear
full ensemble, and separate offense/defense features. None earned production
promotion:

- every candidate's season-clustered game-Brier interval included zero or harm;
- normalized BPM additions slightly improved the aggregate point estimate for
  game and series Brier, but neither interval excluded zero;
- the offense/defense/player candidate improved aggregate series Brier but
  worsened game Brier, and neither interval established improvement;
- selecting the best of several candidates on the same evaluation period would
  introduce selection bias.

The features remain visible as rejected ablations. A future candidate needs a
predeclared specification and improvement on newly archived seasons.

## Phase 5 — product evidence

The application exposes:

- exact final-score distributions;
- input/model sensitivity ranges;
- available-versus-out player scenarios;
- next-game expected-margin drivers;
- rolling reliability evidence and calibration slope;
- strong fitted baselines and rejected ablations;
- model/research protocol versions;
- immutable forecast snapshots under `docs/forecast-archive/`.

## Promotion rule

A research component may replace a production component only when all of the
following hold:

1. its inputs have the same definition and scale in research and production;
2. it is specified without reference to the next evaluation season;
3. it improves a proper scoring rule in rolling evaluation;
4. the season-clustered uncertainty interval rules out material degradation;
5. calibration does not materially worsen;
6. methodology, invariants, and forecast version are updated together.

The 2026-07-26 selection gate makes this rule operational:

- `exact_srs_logit_plus_seed_v1` is the only primary challenger;
- series Brier is the primary endpoint;
- the minimum meaningful improvement is 0.005 Brier;
- the paired season-clustered interval must be entirely below zero;
- log loss may not worsen and calibration slope may not move farther from one;
- input definitions must be production-equivalent;
- at least one genuinely future immutable season must be available.

All other candidates are exploratory for this evaluation. This prevents
promoting whichever of several experiments happens to look best.

## Point-in-time extension (`rolling-origin-v2`)

Model version `2026.3-point-in-time-lab` adds standardized forecast-time
provenance, 240-minute replacement allocation, 834 leakage-safe reconstructed
pregame forecasts in its original release, nested calibration evaluation, and
the preregistered `dynamic_margin_update_v1` candidate.

The immutable July 26 record remains 1,929 pregame forecasts across 2003–2025.
The current pooled archive contains 3,375 pregame forecasts across 1984–2026,
adds rolling climatology and grouped Murphy decomposition, records zero
historical availability coverage rather than imputing injuries, and freezes
`rating_gap_player_shrinkage_v1` for 2027. Direct series calibration worsens;
the coherent nested game-to-series calibration also worsens the series point
estimate. Both calibration research lines are CLOSED. See
`docs/point-in-time-implementation.md` for the complete record.

The subsequent rigor pass adds three high-return tests:

1. Nested game calibration is propagated through every possible future game
   and then through the exact series solver. The series point estimate worsens
   0.1769 → 0.1773; its interval includes zero and the line is CLOSED.
2. The single primary challenger combines the exact SRS-series logit and seed
   difference. It improves the matched point estimate 0.1769 → 0.1735, but its
   interval [−0.0085, +0.0022] does not establish improvement.
3. A fixed ten-season training window improves historical game Brier by
   0.000759, with an interval below zero. Its series interval crosses zero,
   and it remains frozen research until a
   future 2027 evaluation.

The isolated 2026 artifact uses only models fit on 2003–2025. After the
baseline/overlay separation, it records rating-only baseline series Brier
0.2195, primary-challenger Brier 0.2304, and
ten-season-challenger Brier 0.2408. Both challenger registrations are
`CONTAMINATED_2026`, all paired production comparisons include zero, and the
gate decision remains not promoted. A single archived season is necessary but
cannot supply a season-clustered interval by itself.

Player impact, projected minutes, injuries, and manual adjustment are not
scored in this artifact. They are an unvalidated scenario overlay and must
always be shown beside the rating-only baseline with a delta.

Timestamped lagged rotations still fail closed at zero coverage because no
player-level pre-series logs exist. The FiveThirtyEight model benchmark covers
105 series under a frozen mapping rule; it does not satisfy the distinct
timestamped no-vig market contract, whose coverage remains zero.
