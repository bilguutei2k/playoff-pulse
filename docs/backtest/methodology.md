# Playoff Pulse Backtest Methodology

Generated: 2026-07-27T09:35:05.876Z

## Scope

This report evaluates Playoff Pulse on NBA playoff series from 2003-2026. It includes 360 historical series and 2160 model-series predictions across six model variants.

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
- Simulated series reconstruct the full seven-game home pattern from the actual Game 1 host: 2-3-2 for NBA Finals through 2013 and 2-2-1-1-1 otherwise. Games beyond the realized series length therefore keep the era-correct home court instead of defaulting to neutral.

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
| srs_proxy_only | 360 | 0.1833 | 0.5436 | 70.8% |
| playoff_pulse | 360 | 0.1840 | 0.5478 | 71.9% |
| net_rating_only | 360 | 0.1852 | 0.5489 | 71.7% |
| higher_seed | 360 | 0.2083 | 0.6079 | 71.4% |
| home_team | 360 | 0.2095 | 0.6102 | 70.7% |
| coinflip | 360 | 0.2500 | 0.6931 | 50.0% |

## Calibration Data

### playoff_pulse

| Bucket | Count | Mean Prediction | Actual Win Rate |
|---|---:|---:|---:|
| 0.2-0.3 | 3 | 25.0% | 33.3% |
| 0.3-0.4 | 2 | 38.0% | 0.0% |
| 0.4-0.5 | 27 | 46.5% | 51.9% |
| 0.5-0.6 | 83 | 55.4% | 59.0% |
| 0.6-0.7 | 106 | 65.2% | 65.1% |
| 0.7-0.8 | 84 | 74.4% | 89.3% |
| 0.8-0.9 | 48 | 84.7% | 87.5% |
| 0.9-1.0 | 7 | 92.3% | 100.0% |

### coinflip

| Bucket | Count | Mean Prediction | Actual Win Rate |
|---|---:|---:|---:|
| 0.5-0.6 | 360 | 50.0% | 71.4% |

### home_team

| Bucket | Count | Mean Prediction | Actual Win Rate |
|---|---:|---:|---:|
| 0.5-0.6 | 15 | 50.0% | 66.7% |
| 0.6-0.7 | 345 | 65.0% | 71.6% |

### higher_seed

| Bucket | Count | Mean Prediction | Actual Win Rate |
|---|---:|---:|---:|
| 0.6-0.7 | 360 | 65.0% | 71.4% |

### srs_proxy_only

| Bucket | Count | Mean Prediction | Actual Win Rate |
|---|---:|---:|---:|
| 0.1-0.2 | 3 | 14.5% | 33.3% |
| 0.2-0.3 | 2 | 25.9% | 50.0% |
| 0.3-0.4 | 5 | 33.9% | 20.0% |
| 0.4-0.5 | 28 | 45.6% | 60.7% |
| 0.5-0.6 | 50 | 55.4% | 52.0% |
| 0.6-0.7 | 55 | 65.1% | 65.5% |
| 0.7-0.8 | 86 | 75.1% | 70.9% |
| 0.8-0.9 | 68 | 84.6% | 85.3% |
| 0.9-1.0 | 63 | 94.5% | 88.9% |

### net_rating_only

| Bucket | Count | Mean Prediction | Actual Win Rate |
|---|---:|---:|---:|
| 0.1-0.2 | 3 | 15.0% | 33.3% |
| 0.2-0.3 | 3 | 25.2% | 33.3% |
| 0.3-0.4 | 6 | 35.6% | 33.3% |
| 0.4-0.5 | 27 | 45.8% | 55.6% |
| 0.5-0.6 | 40 | 55.1% | 55.0% |
| 0.6-0.7 | 56 | 65.2% | 62.5% |
| 0.7-0.8 | 75 | 75.2% | 72.0% |
| 0.8-0.9 | 75 | 84.8% | 78.7% |
| 0.9-1.0 | 75 | 95.1% | 90.7% |
