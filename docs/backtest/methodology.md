# Playoff Pulse Backtest Methodology

Generated: 2026-07-15T04:26:45.631Z

## Scope

This report evaluates Playoff Pulse on NBA playoff series from 2016-2025. It includes 150 historical series and 900 model-series predictions across six model variants.

## Data Sources

- Basketball-Reference playoff summary pages: series matchups, winners, and series game counts.
- Basketball-Reference playoff schedule pages: game dates, home/away designation, and scores.
- Basketball-Reference team ratings pages: regular-season ORtg, DRtg, net rating, adjusted margin proxy, wins, and losses.
- Basketball-Reference advanced player pages: regular-season BPM, games played, and minutes.

Raw HTML is cached under `data/historical/raw/` and normalized JSON is written under `data/historical/series/`, `data/historical/games/`, and `data/historical/team-snapshots/`.

## Hybrid Input Methodology

- `netRating` is calculated as ORtg minus DRtg from regular-season team ratings.
- The historical point-scale rating stored in the legacy-compatible `eloRating` field is `1500 + SRS × 35`; it is an SRS point proxy, not Elo.
- Player impact is proxied with regular-season BPM.
- Raw regular-season MPG is retained, then deterministically normalized into a complete 240-minute playoff rotation with a 40-minute player cap.
- Historical manual adjustments are fixed at 0.
- Historical availability is explicitly marked unknown and assumed available because injury timelines are not yet modeled.
- Simulated series use the full seven-game 2-2-1-1-1 home pattern reconstructed from the actual Game 1 host, so games beyond the realized series length keep the correct home court instead of defaulting to neutral.

## Leakage Controls

- Every team snapshot uses the configured regular-season end date for that season.
- The runner asserts `snapshot_as_of < seriesStartDate` for both teams before writing predictions.
- Team ratings and player inputs come from regular-season BBRef pages only.
- The backtest runner consumes historical snapshots and does not import the current manual forecast config.

## Known Limitations

- The SRS point proxy is not a possession-by-possession Elo history; its legacy storage field is retained only for model compatibility.
- BPM is a player impact proxy and is not the same scale as the current manual player-impact inputs.
- Historical injuries, absences, and minute changes are not modeled.
- 2020 bubble series are tagged and model home-court advantage is set to zero, but BBRef still supplies nominal home/away designations.
- This is an evaluation harness, not a calibrated production forecast or betting model.

## Results

Accuracy gives half credit to exact 50/50 predictions because those predictions do not favor either team.

| Model | N | Brier Score | Log Loss | Accuracy |
|---|---:|---:|---:|---:|
| playoff_pulse | 150 | 0.1907 | 0.5618 | 69.3% |
| srs_proxy_only | 150 | 0.1935 | 0.5702 | 68.7% |
| net_rating_only | 150 | 0.1949 | 0.5747 | 70.0% |
| higher_seed | 150 | 0.2125 | 0.6165 | 70.0% |
| home_team | 150 | 0.2152 | 0.6221 | 68.3% |
| coinflip | 150 | 0.2500 | 0.6931 | 50.0% |

Note that playoff_pulse accuracy (69.3%) is below the higher-seed baseline
(70.0%). Accuracy is not the optimization target; Brier score and log loss are
the proper scoring rules used for all comparisons.

## Statistical Significance

Paired bootstrap intervals for every playoff_pulse-versus-baseline Brier
difference are computed by `scripts/backtest/significance.ts` (10,000
iterations, percentile intervals, both series-resampled and season-clustered)
and stored in `docs/backtest/significance.json`. Negative differences favor
playoff_pulse.

| Contrast | Difference | 95% CI (series) | 95% CI (season) | Conclusive |
|---|---:|---|---|---|
| vs coinflip | −0.0593 | [−0.0842, −0.0333] | [−0.0812, −0.0359] | Yes |
| vs home_team | −0.0246 | [−0.0426, −0.0067] | [−0.0377, −0.0103] | Yes |
| vs higher_seed | −0.0218 | [−0.0381, −0.0050] | [−0.0355, −0.0081] | Yes |
| vs net_rating_only | −0.0042 | [−0.0174, +0.0083] | [−0.0155, +0.0079] | No |
| vs srs_proxy_only | −0.0029 | [−0.0148, +0.0087] | [−0.0129, +0.0080] | No |

The model conclusively beats the naive baselines. Its edge over the simple
rating baselines is not statistically distinguishable from zero. See
`docs/parameter-provenance.md` for how each parameter was chosen and why this
evaluation is classified as descriptive rather than out-of-sample.

## Calibration Data

### playoff_pulse

| Bucket | Count | Mean Prediction | Actual Win Rate |
|---|---:|---:|---:|
| 0.2-0.3 | 1 | 26.3% | 100.0% |
| 0.3-0.4 | 2 | 38.0% | 0.0% |
| 0.4-0.5 | 10 | 47.8% | 60.0% |
| 0.5-0.6 | 33 | 54.9% | 51.5% |
| 0.6-0.7 | 50 | 65.7% | 68.0% |
| 0.7-0.8 | 27 | 74.1% | 88.9% |
| 0.8-0.9 | 22 | 84.8% | 81.8% |
| 0.9-1.0 | 5 | 92.2% | 100.0% |

### coinflip

| Bucket | Count | Mean Prediction | Actual Win Rate |
|---|---:|---:|---:|
| 0.5-0.6 | 150 | 50.0% | 70.0% |

### home_team

| Bucket | Count | Mean Prediction | Actual Win Rate |
|---|---:|---:|---:|
| 0.5-0.6 | 15 | 50.0% | 66.7% |
| 0.6-0.7 | 135 | 65.0% | 70.4% |

### higher_seed

| Bucket | Count | Mean Prediction | Actual Win Rate |
|---|---:|---:|---:|
| 0.6-0.7 | 150 | 65.0% | 70.0% |

### srs_proxy_only

| Bucket | Count | Mean Prediction | Actual Win Rate |
|---|---:|---:|---:|
| 0.1-0.2 | 1 | 14.0% | 100.0% |
| 0.2-0.3 | 1 | 24.2% | 0.0% |
| 0.3-0.4 | 2 | 31.3% | 50.0% |
| 0.4-0.5 | 12 | 45.7% | 58.3% |
| 0.5-0.6 | 19 | 55.1% | 42.1% |
| 0.6-0.7 | 20 | 65.0% | 70.0% |
| 0.7-0.8 | 43 | 75.4% | 72.1% |
| 0.8-0.9 | 20 | 84.1% | 75.0% |
| 0.9-1.0 | 32 | 95.0% | 87.5% |

### net_rating_only

| Bucket | Count | Mean Prediction | Actual Win Rate |
|---|---:|---:|---:|
| 0.1-0.2 | 1 | 16.6% | 100.0% |
| 0.2-0.3 | 2 | 25.6% | 0.0% |
| 0.3-0.4 | 1 | 31.7% | 100.0% |
| 0.4-0.5 | 14 | 46.3% | 50.0% |
| 0.5-0.6 | 15 | 55.0% | 46.7% |
| 0.6-0.7 | 21 | 65.2% | 66.7% |
| 0.7-0.8 | 38 | 75.5% | 73.7% |
| 0.8-0.9 | 25 | 83.9% | 72.0% |
| 0.9-1.0 | 33 | 95.5% | 87.9% |
