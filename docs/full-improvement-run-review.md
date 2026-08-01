# Playoff Pulse full improvement run review

Date: 2026-08-01  
Branch: `main`  
Repository: `bilguutei2k/playoff-pulse`  
Production URL: `https://548-sable.vercel.app`

This is the review record for the improvement run through Phase 14. It
separates fixed-model reconstruction, rolling-origin research, the isolated
2026 holdout, and the immutable pre-2026 archive. It also records null results,
coverage failures, ingestion flags, and work intentionally skipped.

## Executive decisions

- The visible published baseline is now exactly the rating-only probability
  path used by the backtest. Player impact, minutes, injuries, and manual
  adjustments are a separate, zero-default scenario overlay. The overlay is
  visibly labeled unvalidated and cannot enter the backtest path.
- The symmetric retirement gate fires. Across 645 reconstructed series, the
  former production blend is worse than SRS-only by +0.011750 Brier and worse
  than net-rating-only by +0.010242; both season-clustered intervals are wholly
  above zero and both secondary safeguards pass. The former production blend
  is research-only.
- Neither registered challenger is promoted. Both were first durably
  registered after the 2026 playoffs began and are `CONTAMINATED_2026`.
- Direct series-output calibration and nested game calibration propagated
  through the exact solver are `CLOSED`, not deferred research items.
- Rotation and injury effects remain unestimable. There are no timestamped
  player-level pre-series observations; no contract clause rejected a real
  candidate because no candidates exist.
- The FiveThirtyEight comparison is an external model benchmark on 105 matched
  series. It is not a market benchmark; timestamped no-vig market coverage is
  still zero.

## Phase and commit ledger

| Phase | Status | Commit(s) | Decision or outcome |
|---|---|---|---|
| 0 | Skipped under the revised plan; earlier repository work exists | `3d10ba7` | Original retrospective work had already been committed and pushed. |
| 1 | Complete | `5ff48ae`, `217f53f` | Default branch is `main`; Vercel Git integration and a no-op deploy trigger were verified. `.gitignore` contains `* 2.ts`. |
| 2 | Complete | `100007a` | Vitest safety net added. Solver/brute-force, venue indexing, probability invariants, and leakage guards pass. |
| 3 | Read-only; skipped in revised execution sequence because provenance had already been established | no commit | Both challenger registrations are `CONTAMINATED_2026`. |
| 4 | Earlier prerequisite complete; not rerun | `baa7384` | Nine immutable 2003–2025 artifacts frozen with checksums. |
| 5 | Earlier prerequisite complete; not rerun | `8ba629f` | 2026 ingested as 15 series and 85 games. |
| 6 | Earlier prerequisite complete; not rerun | `d75f826` | Isolated 2026 holdout produced without fitting on 2026. |
| 7 | Complete | `c80d332`, `27e9225` | Gate definition was committed before its verdict. Expanded-data verdict: retire to research-only. |
| 8 | Complete by explicit user instruction | `e5617d3` | Evidenced baseline separated from the unvalidated scenario overlay. The reason was production/backtest input divergence, independent of the original retirement verdict. |
| 9a | Complete | `9e915f1` | Per-season/per-round Best-of-5 and Finals format registry, sources, and tests. |
| 9b | Complete | `9d117e4` | Stable franchise map and exhaustive data-code test. |
| 9c | Complete | `735c020` | Historical league-size and cutoff handling verified. |
| 9d | Complete | `e8d9f60` | 1984–2002 ingestion added. |
| 9e | Complete | `a9515b3` | Fixed and rolling evaluation extended through 1984–2026; frozen archive unchanged. |
| 9f | Complete | `3a21e30` | Era-pooling limitation and recency interpretation published. |
| 10 | Complete | `b2caea1` | Rotation rejection audit instrumented; genuine source-coverage failure found. |
| 11 mapping | Complete | `a3fb2c5` | FiveThirtyEight mapping rule frozen before scoring. |
| 11 scoring | Complete | `12bdbe0` | 105-series model comparison produced and published. |
| 12 | Complete | `995f524` | Reliability threshold triggered uncertainty work; candidate worsened reliability and was not promoted. |
| 13 | Complete | `7f25205` | Direct and nested calibration lines marked `CLOSED`. |
| 14 | Complete to the limits of the available environment when the enclosing commit is on `main` | enclosing `Full regeneration and documentation sweep` commit | Full pipeline, claim sweep, HTTP/rendered-content checks, push, and deployment verification. Pixel-level responsive automation was unavailable as documented below. |

## Registration provenance and 2026 holdout

The 2026 NBA playoffs began on 2026-04-18. Git history first shows the
challenger strings in a 2026-07-26 checkpoint and in the first durable authored
main-line registration at `3d10ba7` on 2026-07-27. The selection gate appears
in the same post-playoff work. Both dates are after the playoff start, so:

| Candidate | Classification |
|---|---|
| `exact_srs_logit_plus_seed_v1` | `CONTAMINATED_2026` |
| `ten_season_training_window_v1` | `CONTAMINATED_2026` |

The isolated holdout has 85 games and 15 series. Every fit used only
2003–2025. One future archived season satisfies the gate's future-season
condition, but cannot alone supply a season-clustered confidence interval;
that condition is necessary, not sufficient.

| Model | Game Brier | Game log loss | Series Brier | Series log loss |
|---|---:|---:|---:|---:|
| Evidenced production baseline | 0.231742 | 0.656089 | 0.219469 | 0.623953 |
| Exact SRS logit + seed | 0.234491 | 0.667499 | 0.230363 | 0.651186 |
| Ten-season training window | 0.231785 | 0.658366 | 0.240757 | 0.673576 |
| SRS-only | 0.231435 | 0.657089 | 0.258057 | 0.732135 |
| Net-rating-only | 0.233396 | 0.662466 | 0.260729 | 0.754213 |
| Higher-seed | 0.238971 | 0.671116 | 0.222500 | 0.637129 |
| Home-team | 0.256618 | 0.707530 | 0.222500 | 0.637129 |
| Coin flip | 0.250000 | 0.693147 | 0.250000 | 0.693147 |

Both challengers were worse than production on the 2026 series point
estimate; every paired production-versus-challenger interval crossed zero. The
selection gate did not promote either candidate.

## Retirement gate

The gate was committed before recomputing its verdict. Its primary endpoint is
paired fixed-model series Brier; the named comparators are SRS-only and
net-rating-only; the meaningful-deficit threshold is +0.005, symmetric with
the promotion threshold; inference is a 10,000-draw season-clustered paired
bootstrap; comparator log loss and calibration slope must be no worse.

| Comparator | Production minus comparator Brier | Season-clustered 95% CI | Gate |
|---|---:|---:|---|
| SRS-only | +0.011750 | [+0.005311, +0.017992] | Met |
| Net-rating-only | +0.010242 | [+0.002730, +0.017589] | Met |

Verdict: `retire_production_to_research_only`. This does not prospectively
validate a replacement; it demotes an incumbent that failed its own symmetric
standard.

## Series formats and franchise identity

The solver reads a per-season/per-round registry:

| Seasons | First round | Finals |
|---|---|---|
| 1984 | Best-of-5, 2-2-1 | Best-of-7, 2-2-1-1-1 |
| 1985–2002 | Best-of-5, 2-2-1 | Best-of-7, 2-3-2 |
| 2003–2013 | Best-of-7, 2-2-1-1-1 | Best-of-7, 2-3-2 |
| 2014–2026 | Best-of-7, 2-2-1-1-1 | Best-of-7, 2-2-1-1-1 |

Sources are frozen in `docs/series-format-provenance.md`: NBA season reviews
for the 1984 and 2003 opening-round changes, a contemporaneous 2002 schedule
for 2-2-1, and NBA releases for the 1985 and 2014 Finals transitions.

The franchise map resolves all 37 distinct team codes present in committed
series data to 30 stable franchise IDs. It distinguishes the original
Charlotte-to-New-Orleans lineage from the later Charlotte expansion and
covers Seattle/Oklahoma City, Vancouver/Memphis, New Jersey/Brooklyn,
Bullets/Wizards, San Diego/Los Angeles Clippers, and Kansas City/Sacramento.
Unknown codes throw; the exhaustive test prevents silent omissions.

## 1984–2002 ingestion and validation

The extension added 285 series, 1,361 games, and 304 team-season snapshots.
Every observed series reached its era-correct required wins, game dates did
not precede series start, and venue prefixes matched the registered format.
No value was clamped.

Eight historical-extreme flags were retained for review:

- 1984 WSB net rating −3.31, below prior minimum −3.04.
- 1986 CHI net rating −3.77.
- 1986 SAC SRS −3.19.
- 1988 SAS SRS −5.02 and net rating −4.52.
- 1992 MIA SRS −3.94 and net rating −4.28.
- 1996 CHI net rating +13.49.

These are flags, not validation failures. The source values remain unchanged.

## Full 1984–2026 evaluation

The fixed-coefficient reconstruction contains 645 series. It does not define a
game-level score, so no game metric was invented. The rolling-origin research
contains 3,160 games and 600 series from 1987–2026; the exact-SRS-plus-seed
candidate begins after two additional calibration seasons and has 570 series.

### Fixed-model series results

| Model | N | Brier | Log loss | Paired production-minus-model 95% season CI |
|---|---:|---:|---:|---:|
| Playoff Pulse rating-only baseline | 645 | 0.185480 | 0.555088 | reference |
| SRS-only | 645 | 0.173730 | 0.520095 | [+0.005311, +0.017992] |
| Net-rating-only | 645 | 0.175238 | 0.523725 | [+0.002730, +0.017589] |
| Higher-seed | 645 | 0.203430 | 0.597780 | [−0.023882, −0.012264] |
| Home-team | 645 | 0.204070 | 0.599082 | [−0.024482, −0.013034] |
| Coin flip | 645 | 0.250000 | 0.693147 | [−0.073411, −0.055497] |

### Rolling-origin game and series results

| Model | Game N | Game Brier | Game log loss | Series N | Series Brier | Series log loss | Paired candidate-minus-SRS+home 95% CI |
|---|---:|---:|---:|---:|---:|---:|---|
| SRS + home reference | 3,160 | 0.214828 | 0.619507 | 600 | 0.176583 | 0.527436 | reference |
| Net rating + home | 3,160 | 0.215217 | 0.620189 | 600 | 0.177423 | 0.528778 | game [−0.000047, +0.000812]; series [−0.000518, +0.002181] |
| Exact SRS logit + seed | not defined | not defined | not defined | 570 | 0.173518 | 0.521361 | series [−0.008498, +0.002240] |
| Ten-season window | 3,160 | 0.214064 | 0.617517 | 600 | 0.176283 | 0.526573 | game [−0.001425, −0.000128]; series [−0.001310, +0.000495] |

Higher-seed, home-team, and coin-flip game metrics are reported for the 2026
holdout above. The full-history fixed-model harness scores those directional
contracts at series level only; adding unregistered game definitions during a
documentation sweep would manufacture a new evaluation.

## Rotation contract diagnosis

- Candidate team-series rotation observations: 0.
- Player rows: 0.
- Completely covered paired series: 0 of 645.
- Player-series opportunities: 12,900; eligible availability observations: 0.
- Rejections attributed to every individual clause: 0.
- Largest eliminator: none.
- Exactly-240 hypothesis: not responsible, because no candidate observations
  reached any clause. The contract describes one regulation-game rotation,
  not a ten-game aggregate.

The missing prerequisite is timestamped player-level game logs available
strictly before the series deadline. The result is a genuine source-coverage
failure, so no clause was loosened and no corrected-clause review was needed.

## FiveThirtyEight model benchmark

Source: pinned commit `f6d5b2e1d6da2889345d381c41431f9a4ee208dd` of
`fivethirtyeight/checking-our-work-data`, file `nba_playoffs.csv`. Covered
seasons are 2016–2022: 60 series in the CARM-Elo/CARMELO era and 45 in the
RAPTOR era. FiveThirtyEight stopped updating sports forecasts in 2023.

Frozen mapping: for each series, take the latest date strictly before series
start on which both teams have a positive round-specific advancement
probability; normalize `qA / (qA + qB)`. Championship probability is used only
for the Finals. Missing common timestamps fail closed.

Coverage is 105 of 105 eligible series. Playoff Pulse scores Brier 0.184298 and
log loss 0.552159; FiveThirtyEight scores Brier 0.171869 and log loss 0.504133.
Playoff-Pulse-minus-FiveThirtyEight Brier is +0.012429 with season-clustered
95% interval [−0.000979, +0.025258]. The point estimate favors FiveThirtyEight;
the interval crosses zero. This is a model benchmark, not a market benchmark.

## Reliability and uncertainty decision

The decision rule was recorded before reading the metric: skip uncertainty if
series reliability is below 0.002. Grouped Murphy reliability is 0.001454 for
games and 0.002696 for series, so the conditional work ran.

The research-only candidate fits the standard deviation of SRS-minus-net-
rating residuals from earlier seasons only and averages 512 deterministic
team-strength samples. Series Brier changes 0.176583 to 0.176464, a −0.000120
change with interval [−0.000302, +0.000060]. Grouped series reliability worsens
by +0.000831 to 0.003527. It is not promoted.

## Calibration closure

Direct series-output calibration changes Brier 0.176921 to 0.178451 and log
loss 0.528574 to 0.533080: worse on both endpoints. Coherent nested game
calibration propagated through the exact solver changes series Brier 0.176921
to 0.177316 and log loss 0.528574 to 0.530036; its paired Brier interval
[−0.000269, +0.001047] crosses zero. Both lines are `CLOSED`.

## Superseded-literal audit

The required literals were searched across every tracked file.

- `0.179954` and `0.005365`: no tracked occurrences.
- `0.185284` and `0.184548`: occur only inside immutable frozen-2003-2025
  JSON and remain untouched.
- `0.1825`: the authored prose occurrence is explicitly the frozen 345-series
  record; other hits are frozen data or coincidental per-record/current
  generated probabilities, not headline metrics.
- `0.1801`, `0.1819`, `0.2077`, `0.2089`: hits outside the frozen directory are
  per-record or subgroup numeric values inside regenerated JSON, not authored
  claims. Frozen hits remain immutable.
- `345`, `1929`, `2070`, `1675`, `300`, and `6900`: authored occurrences are
  explicitly labeled as frozen/original verification history or unrelated
  constants such as cache seconds and test sample sizes. Remaining hits are
  substrings of source data, probabilities, IDs, or generated record values;
  they are not current aggregate claims.
- `2003–2025`: retained only for the immutable archive and the isolated 2026
  fitting scope. `2006–2025` has no tracked occurrence.
- `2016`: retained as an actual season identifier, the original-plan scope
  (now labeled archival), the start of FiveThirtyEight coverage, and the
  ten-season 2026 fitting window. It is not used as the current evaluation
  start.

## Files whose numeric content changed in this run

Historical data:

- `data/historical/games/1984.json` through `2002.json`.
- `data/historical/series/1984.json` through `2002.json`.
- `data/historical/team-snapshots/1984.json` through `2002.json`.
- `data/historical/external-series-benchmarks.json`.

Generated evaluation artifacts:

- `docs/backtest/availability.json`, `evidence.json`,
  `external-benchmark-538.json`, `input-audit.json`, `methodology.md`,
  `predictions.json`, `pregame-archive.json`, `research.json`, `results.json`,
  `retirement-decision.json`, `significance.json`, and `summary.json`.

Authored numeric claims or scope statements:

- `AGENTS.md`, `PLAN.md`, `docs/claims-ledger.md`,
  `docs/model-development.md`, `docs/parameter-provenance.md`,
  `docs/point-in-time-implementation.md`, `docs/series-format-provenance.md`,
  `docs/backtest/external-benchmark-mapping.md`, `src/app/page.tsx`,
  `src/app/evidence/page.tsx`, `src/app/methodology/page.tsx`,
  `src/components/forecast/EvidenceExplorer.tsx`, and
  `src/components/forecast/ResearchEvidence.tsx`.

Numeric logic, registrations, or tests:

- `package.json`; `scripts/backtest/baselines.ts`,
  `build-538-benchmark.ts`, `build-evidence.ts`, `build-input-audits.ts`,
  `build-snapshots.ts`, `evaluate-2026-holdout.ts`,
  `ingest-1984-2002.ts`, `report.ts`, `research-model.ts`, and
  `scrape-bbref.ts`.
- `src/data/franchise-map.ts`; `src/lib/backtest/input-observations.ts`,
  `series-formats.ts`, and `types.ts`.
- `tests/external-benchmark.test.ts`, `franchise-map.test.ts`,
  `home-pattern.test.ts`, `league-size.test.ts`, `legacy-ingestion.test.ts`,
  `rating-uncertainty.test.ts`, `rotation-contract.test.ts`, and
  `series-format.test.ts`.

The immutable files under `docs/backtest/frozen-2003-2025/` did not change.

## Validation record and unresolved contracts

- The solver/brute-force suite passes at every reachable Best-of-5 and
  Best-of-7 score with asymmetric probabilities and tolerance below `1e-12`.
- Home patterns pass hand-written table tests for 2-2-1, 2-3-2, and
  2-2-1-1-1.
- Every fitting isolation guard rejects target-season rows.
- Every historical team code resolves to a stable franchise.
- `backtest:verify-frozen` verifies all nine immutable artifacts.
- No ingestion validation failed. Eight source-extreme flags are listed above.
- Rotation/availability remains unsatisfied because required source rows do
  not exist. No-vig market comparison remains unsatisfied at zero coverage.
- A test fixture briefly failed while tightening the rating-uncertainty
  leakage API because it supplied a target-season row to the insufficient-data
  case. The fixture was corrected; the guard now has separate passing tests for
  contamination rejection and insufficient prior data. No published number was
  affected.
- Local production HTTP checks returned 200 for `/`, `/evidence`,
  `/methodology`, `/lab`, and `/snapshot`; rendered HTML contains the required
  retirement, holdout, contamination, market-coverage, and non-betting text.
- Pixel-level 390px/desktop overflow and console inspection could not be run:
  the collaborative preview required unavailable T3 authorization, the
  supported browser runtime reported no browser, `agent-browser` was not
  installed, and no Playwright executable was present. This is an explicit
  validation limitation, not a claimed pass. The production build and static
  prerender completed successfully for every route.
- No broad refactor was performed. The unrelated untracked `drafts/`
  directory was not read, edited, staged, or committed.

## Final public-claim checklist

The homepage, `/evidence`, and `/methodology` now state plainly:

- what the published Brier validates and that it does not validate the overlay;
- the retirement verdict;
- the 2026 holdout score and `CONTAMINATED_2026` registrations;
- zero availability and rotation coverage;
- 105 external-model observations but zero no-vig market observations; and
- that Playoff Pulse is not a betting product, does not recommend wagers, and
  does not claim to beat a market.

Final command outputs and browser/deployment observations are appended to the
Phase 14 commit handoff after they are run against this exact tree.
