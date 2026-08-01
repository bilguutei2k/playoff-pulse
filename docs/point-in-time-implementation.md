# Point-in-time forecasting and product evidence implementation

## Scope

This document records the implementation requested after model version
`2026.2-exact-uncertainty`. It covers standardized input snapshots, replacement
minutes, historical pregame archives, calibration, the preregistered dynamic
rating candidate, scenario/replay tools, evidence views, and verification.

## 2026-07-26 rigor extension: calibration, challengers, and input gates

This extension implements the approved high-ROI validity sequence without
manufacturing unavailable history.

### Production-equivalent input prerequisites

- Added `data/historical/lagged-rotation-observations.json` and a typed
  `last_10_team_games_before_deadline` contract.
- A valid team-series rotation must be timestamped before the conservative
  deadline, cite an HTTPS source, name at least six rostered players, constrain
  each player to 0–48 minutes, and total exactly 240 minutes.
- Added `data/historical/external-series-benchmarks.json` for timestamped public
  probabilities or explicitly no-vig two-sided series prices.
- `scripts/backtest/build-input-audits.ts` writes
  `docs/backtest/input-audit.json`. Lagged rotations and no-vig market prices
  have zero coverage. A separately labeled FiveThirtyEight model benchmark
  covers 105 series under a mapping rule frozen before scoring.
- Post-deadline player participation and unsourced prices are never used as
  substitutes.

### Coherent nested calibration

For every evaluation season from 2008 onward:

1. fit the base game model using earlier seasons only;
2. fit a logistic game calibrator using earlier rolling-origin game
   predictions only;
3. calibrate the home-win probability at every possible remaining game slot;
4. convert back to team-A probability and rerun the exact series solver.

On 570 eligible series, Brier changes 0.176921 → 0.177316 and log loss
0.528574 → 0.530036. The paired candidate-minus-raw Brier difference is
+0.000392 with 95% interval [−0.000269, +0.001047]. The point estimate worsens,
the interval includes zero, and the research line is CLOSED.

### Primary series challenger

`exact_srs_logit_plus_seed_v1` is frozen on 2026-07-26:

`logit(P(series)) = intercept + beta1 × exact SRS-series logit + beta2 × seed difference`

On the 570-series matched set, Brier changes 0.176921 → 0.173518 and log loss
0.528574 → 0.521361. The paired Brier difference is −0.003415 with 95%
interval [−0.008498, +0.002240]. It clears neither the 0.005 point-estimate
threshold nor the interval rule. It is the only primary challenger and is first
promotion-eligible after a genuinely future 2027 archive.

Prospective issuance now seals this candidate's probability beside the raw
production estimate for the declared target series. It is labeled research and
does not replace the production forecast.

### Temporal weighting challenger

`ten_season_training_window_v1` retains the SRS + home formula but trains on
at most the ten completed seasons immediately before each target season.
Historical game Brier changes 0.214828 → 0.214064, a difference of −0.000759
with 95% interval [−0.001425, −0.000128]. Series Brier improves by −0.000302
with interval [−0.001310, +0.000495].

The game result is encouraging, but it is retrospective. The candidate is
frozen for its first legitimate promotion check in 2027.

### Model-selection gate

The committed gate declares:

- one primary challenger and one primary endpoint;
- minimum meaningful Brier improvement of 0.005;
- paired season-clustered uncertainty entirely below zero;
- no-worse log loss;
- calibration slope no farther from one;
- production-equivalent inputs;
- at least one genuinely future immutable evaluation season.

Exploratory candidates cannot be promoted from the same evaluation. The 2026
archive satisfies the future-season-available prerequisite, but both challenger
registrations are `CONTAMINATED_2026`, a single season cannot produce a
season-clustered interval, and production-equivalent inputs remain absent.
Current decision:
`not_eligible_contaminated_2026_registration_and_no_production_equivalent_inputs`.

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

- The original release generated 834 forecasts from 2016–2025. The frozen
  July 26 extension contains 1,929 forecasts through 2025; the pooled archive
  now contains 3,375 forecasts, one immediately before each historical
  playoff game from 1984–2026.
- Each record includes only the regular-season snapshot and prior completed
  games, plus the pregame score, next-game probability, exact series
  distribution, sensitivity range, drivers, provenance, and actual outcomes.
- These are explicitly called *reconstructed* forecasts; they were not issued
  contemporaneously.
- Leakage verification requires `lastIncludedGameNumber = gameNumber - 1`, the
  score to match the included games, and source snapshots to predate forecasts.

### 4. Calibration and dynamic candidate

- Nested calibration trains on earlier rolling predictions and evaluates only
  later seasons (1989–2026 after two rolling seasons initialize the calibrator).
- Expanded-sample game calibration has a negligible game-only improvement.
- Direct series calibration and coherent propagation through the exact solver
  both worsen series Brier. Both lines are CLOSED.
- Preregistered `dynamic_margin_update_v1`: after each prediction, split 12% of
  the observed margin residual between opponents, carry it through that
  postseason, and cap adjustments at ±4 points.
- The candidate is frozen for evaluation but is not promotion-eligible on data
  through 2026; because its registration followed the completed 2026 season,
  its first prospectively eligible evaluation season remains 2027.

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
  it. Prospective issuance uses
  `pnpm archive:issue -- --issued-at <ISO> --target-series <id> --target-game <id> --target-start <ISO>`.
  It rejects issue times before the data snapshot or at/after game start and
  refuses to overwrite an existing archive.

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

### 9. Expanded evidence program (2026-07-26)

- The frozen July 26 record added 2003–2015 source snapshots and produced
  345 series and 1,929 pregame states through 2025. Those figures are preserved
  historical scope. The current pooled record has 645 series and 3,375 pregame
  states across 1984–2026.
- Added the historical 2–3–2 NBA Finals home pattern through 2013; the modern
  2–2–1–1–1 pattern applies elsewhere.
- Added rolling prior-only climatology for games and series.
- Added grouped Murphy Brier decomposition with season-clustered intervals.
- Added a typed historical availability observation schema and completeness
  audit. Coverage is currently zero; no status is inferred from later
  participation.
- Added a grouped sensitivity reliability diagnostic. Zero of ten groups
  contain the observed rate, but this is not individual interval coverage.
- Froze `rating_gap_player_shrinkage_v1` with exponential decay over absolute
  SRS gap. Historical game and series comparison intervals include zero, so it
  remains research-only for 2027.

## Evaluation results

### Nested calibration

| Target | Eligible N | Raw Brier | Calibrated Brier | Raw log loss | Calibrated log loss | Decision |
|---|---:|---:|---:|---:|---:|---|
| Game | 3,009 | 0.2161 | 0.2159 | 0.6224 | 0.6219 | Closed as a product line; negligible game-only change |
| Series | 570 | 0.1769 | 0.1785 | 0.5286 | 0.5331 | CLOSED; worsened |

### Dynamic candidate

`dynamic_margin_update_v1` records game Brier 0.215266 across 3,160 rolling
predictions versus 0.214828 static. The +0.000445 difference has a
season-clustered interval spanning zero. Its historical result is descriptive;
the registration prevents promotion on pooled data through 2026.

## Primary files

- `src/lib/model/point-in-time.ts` — standardized forecast-time inputs and
  scale compatibility.
- `src/lib/model/rotation.ts` — deterministic replacement-minute allocation.
- `src/lib/backtest/point-in-time-types.ts` — archive schema and leakage audit.
- `scripts/backtest/build-pregame-archive.ts` — 3,375 pregame reconstructions.
- `scripts/backtest/build-availability-audit.ts` — sourced observation
  validation and missingness report.
- `scripts/backtest/research-model.ts` — nested calibration and dynamic candidate.
- `scripts/backtest/build-evidence.ts` — compact UI evidence artifact.
- `src/components/forecast/ScenarioLab.tsx` and `/lab` — scenario/replay UI.
- `src/components/forecast/EvidenceExplorer.tsx` and `/evidence` — archive and
  evidence UI.
- `scripts/verify/backtest-integrity.ts` — rotation, provenance, and archive
  invariants.

## Prior release verification record

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

The verification record for the 2026-07-26 expansion is appended after the
current implementation passes the complete command and browser suite.

## 2026-07-26 expansion verification record

- `corepack pnpm backtest:snapshots` — completed for 2003–2025. Every season
  normalized to 15 series; validation caught and then explicitly accommodated
  the legitimate 2012 Charlotte −15.41 net rating and the pre-2014 Finals
  2–3–2 format.
- `corepack pnpm backtest:all` — passed end to end: 2,070 fixed-model
  predictions, 1,929 leakage-safe pregame forecasts, availability audit,
  rolling research, significance, and compact evidence regenerated.
- `corepack pnpm verify` — passed: `Model verification passed.` New checks
  cover era-specific home patterns, smooth symmetric rating-gap shrinkage,
  prospective issue-time ordering, availability observation validity, Brier
  decomposition reconciliation, and candidate non-promotion.
- `corepack pnpm lint` — passed with no source warnings or errors after
  generated `.vercel/**` output was added to the global ignore list.
- `corepack pnpm build` — passed under Next.js 16.1.5. `/`, `/evidence`,
  `/lab`, `/methodology`, and `/snapshot` prerendered; the display-only
  scoreboard API remains dynamic.
- `git diff --check` — passed.
- Collaborative-browser checks at 1280px and 390px found no page-level
  horizontal overflow or Next.js error overlay. Wide evidence tables remain
  intentionally scrollable inside their cards.
- Shared navigation/actions, replay selectors, scenario controls, reset
  actions, and snapshot controls render with the same 2px border, 6px radius,
  and 38px minimum height.
- Evidence replay interaction advanced from pregame Game 1 to Game 2.
- Scenario interaction marking Victor Wembanyama out moved the preserved SAS
  estimate from 59.5% to 52.4%, assigned 38.0 replacement minutes, and showed
  a −7.1 percentage-point delta.
