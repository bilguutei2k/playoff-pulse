# Point-in-time forecasting and product evidence implementation

## Scope

This document records the implementation requested after model version
`2026.2-exact-uncertainty`. It covers standardized input snapshots, replacement
minutes, historical pregame archives, calibration, the preregistered dynamic
rating candidate, scenario/replay tools, evidence views, and verification.

## Scientific boundaries

- Production inputs remain manual and use `manual_point_estimate` impact scale.
- Historical player inputs use `bpm_proxy`; the type system and archive metadata
  keep those scales distinct.
- Fitted historical coefficients are not applied to subjective production
  player ratings.
- Historical injury status remains unknown unless a point-in-time source exists.
- The live scoreboard display layer does not feed ratings, rotations, injuries,
  or model settings.

## Change log

Implementation entries are added below as each workstream is completed.

### 1. Standardized inputs

- Added `PointInTimeForecastInput` with forecast time, information set, model
  version, settings, series state, and structured provenance.
- Added discriminated impact/rating scales. `assertCompatibleImpactScales`
  prevents a historical BPM coefficient from being silently applied to a
  manual production impact value.
- Advanced the model to `2026.3-point-in-time-lab` and research protocol to
  `rolling-origin-v2`.

### 2. Rotation replacements

- Added a pure scenario allocator that always returns 240 team minutes.
- Explicit player minutes are retained when the request is below 240; missing
  and vacated minutes become a named zero-impact replacement player.
- Requests above 240 are proportionally scaled, preserving relative roles.
- Out players receive zero minutes. The UI discloses replacement minutes and
  whether scenario changes move the central forecast.

### 3. Historical pregame reconstruction

- Generated 834 forecasts, one immediately before each historical playoff game
  from 2016–2025.
- Each record includes only the regular-season snapshot and prior completed
  games, plus the pregame score, next-game probability, exact series
  distribution, sensitivity range, drivers, provenance, and actual outcomes.
- These are explicitly called *reconstructed* forecasts; they were not issued
  contemporaneously.
- Leakage verification requires `lastIncludedGameNumber = gameNumber - 1`, the
  score to match the included games, and source snapshots to predate forecasts.

### 4. Calibration and dynamic candidate

- Nested calibration trains on earlier rolling predictions and evaluates only
  later seasons (2021–2025).
- Game calibration was rejected because Brier and log loss worsened.
- Series calibration improved both metrics across 75 eligible forecasts, but is
  research-only because its input scale differs from production.
- Preregistered `dynamic_margin_update_v1`: after each prediction, split 12% of
  the observed margin residual between opponents, carry it through that
  postseason, and cap adjustments at ±4 points.
- The candidate is frozen for evaluation but is not promotion-eligible on data
  through 2025; its first genuinely future evaluation season is 2026.

### 5. Product interfaces

- Added `/lab` for manual availability/minutes scenarios, replacement minutes,
  central-versus-sensitivity comparison, exact scores, drivers, and a preserved
  0–0 demonstration explicitly labeled hypothetical.
- Added `/evidence` for season/series archive browsing, probability timelines,
  exact pregame distributions, separate game/series calibration, worst
  forecasts, model comparison, dynamic candidate status, and production-version
  deltas.
- Added navigation and completed-season dashboard links to both routes.
- Production sections use manual-input language and accent styling; historical
  sections use research/reconstruction labels and do not imply live status.

### 6. Artifacts and archive behavior

- `docs/backtest/pregame-archive.json`: complete leakage-safe reconstruction.
- `docs/backtest/evidence.json`: compact product-facing evidence data.
- Production archives are now versioned by both snapshot date and model version,
  plus an explicit issue time, preventing forecasts issued before different
  games from overwriting one another. Each archive carries the complete manual
  team, player, series, note, settings, and output snapshot required to replay
  it. Use `pnpm archive:forecast -- --issued-at <ISO timestamp>` immediately
  before a game or forecast publication.

### 7. Verification

- Rotation conservation, deterministic allocation, out-player zero minutes,
  replacement flow, incompatible scale rejection, pregame leakage, archive
  size, and probability bounds are checked by `pnpm verify`.
- Final command and browser results are recorded at the end of this file after
  completion.

### 8. Deployment packaging

- Added an explicit `.vercelignore` so local Basketball Reference HTML caches,
  build output, package stores, and environment files never enter a deployment
  upload.
- The first production attempt exposed the missing boundary by uploading 40
  ignored raw-cache files (33.7 MB total) and remaining in Vercel's `UNKNOWN`
  state without starting a build. A Vercel dry run confirmed the raw files were
  included even though `data/historical/raw/` was listed in `.gitignore`.
- Product-required `docs/backtest/evidence.json`,
  `docs/backtest/research.json`, and `docs/backtest/summary.json` remain in the
  source bundle. Raw HTML is research provenance/cache only and is not a model
  or runtime input.
- Environment files are now explicitly ignored by both Git and Vercel after
  linking the production project.

## Evaluation results

### Nested calibration

| Target | Eligible N | Raw Brier | Calibrated Brier | Raw log loss | Calibrated log loss | Decision |
|---|---:|---:|---:|---:|---:|---|
| Game | 422 | 0.2323 | 0.2339 | 0.6592 | 0.6602 | Rejected |
| Series | 75 | 0.2122 | 0.2108 | 0.6112 | 0.6054 | Research improvement; not applied to production |

### Dynamic candidate

`dynamic_margin_update_v1` records game Brier 0.23533 across 587 rolling
predictions, effectively indistinguishable from the static SRS/home reference
(0.23533 at displayed precision). Its historical result is descriptive only;
the registration explicitly prevents promotion on 2016–2025 data.

## Primary files

- `src/lib/model/point-in-time.ts` — standardized forecast-time inputs and
  scale compatibility.
- `src/lib/model/rotation.ts` — deterministic replacement-minute allocation.
- `src/lib/backtest/point-in-time-types.ts` — archive schema and leakage audit.
- `scripts/backtest/build-pregame-archive.ts` — 834 pregame reconstructions.
- `scripts/backtest/research-model.ts` — nested calibration and dynamic candidate.
- `scripts/backtest/build-evidence.ts` — compact UI evidence artifact.
- `src/components/forecast/ScenarioLab.tsx` and `/lab` — scenario/replay UI.
- `src/components/forecast/EvidenceExplorer.tsx` and `/evidence` — archive and
  evidence UI.
- `scripts/verify/backtest-integrity.ts` — rotation, provenance, and archive
  invariants.

## Final verification record

- `corepack pnpm backtest:research` — completed; all five registered research
  variants regenerated.
- `corepack pnpm backtest:pregame` — completed; 834 forecasts written and zero
  leakage violations found.
- `corepack pnpm archive:forecast` — archived
  `2026.3-point-in-time-lab` without overwriting `2026.2-exact-uncertainty`.
- `corepack pnpm backtest:evidence` — compact evidence artifact regenerated.
- `corepack pnpm verify` — passed: `Model verification passed.`
- `corepack pnpm lint` — passed with no warnings or errors.
- `corepack pnpm build` — passed; `/`, `/case-study`, `/methodology`, `/lab`, and
  `/evidence` statically generated; `/api/live-scoreboard` remains dynamic.
- `git diff --check` — passed.
- Desktop laboratory interaction: setting Victor Wembanyama to out moved the
  preserved SAS series estimate from 59.5% to 52.4% and assigned 38.0 minutes
  to disclosed SAS replacement minutes.
- Mobile laboratory and evidence routes: 390px viewport, no horizontal
  overflow, no runtime error overlay.
- Evidence interaction: selecting Game 2 updated the archive detail from
  `PREGAME 1` to `PREGAME 2`; both production versions and their comparison
  rendered successfully.
