# Model development protocol

## Status

Model version: `2026.2-exact-uncertainty`  
Research protocol: `rolling-origin-v1`

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

The research harness evaluates 2019–2025 with rolling origin:

1. Train only on seasons strictly earlier than the evaluation season.
2. Select ridge strength using season-held-out folds within the available
   training data.
3. Fit expected game margin, then tune the margin-to-probability scale using
   training data only.
4. Score game probabilities and exact pre-series probabilities.
5. Report Brier score, log loss, margin MAE, equal-count reliability groups,
   calibration intercept/slope, and season-clustered bootstrap comparisons.

The harness also includes fitted seed-only and seed-plus-SRS series baselines.
Raw results and rolling predictions are committed in
`docs/backtest/research.json` so every headline can be independently checked.

## Phase 2 — expected-margin model and exact series solution

The research model is regularized linear expected margin followed by a fitted
logistic probability scale. The parsimonious `srs_home` specification is the
reference model. It evaluates 587 games and 105 series from 2019–2025.

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

These intervals describe sensitivity to the stated assumptions. They must not
be described as validated 80% confidence or credible intervals until forecast
coverage has been measured on archived future predictions.

## Phase 4 — feature ablation decision

Candidate models tested net rating, normalized BPM rotation impact, a collinear
full ensemble, and separate offense/defense features. None earned production
promotion:

- every candidate's season-clustered game-Brier interval included harm;
- normalized BPM additions worsened aggregate game Brier;
- the offense/defense/player candidate improved aggregate series Brier but
  worsened game Brier and did not improve the 2025 evaluation slice;
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

## Point-in-time extension (`rolling-origin-v2`)

Model version `2026.3-point-in-time-lab` adds standardized forecast-time
provenance, 240-minute replacement allocation, 834 leakage-safe reconstructed
pregame forecasts, nested calibration evaluation, and the preregistered
`dynamic_margin_update_v1` candidate. Game calibration was rejected; series
calibration improved the eligible research subset but is not applied to manual
production inputs. See `docs/point-in-time-implementation.md` for the complete
implementation record and scientific boundaries.
