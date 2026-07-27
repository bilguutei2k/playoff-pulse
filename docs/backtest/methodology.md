# Playoff Pulse Backtest Methodology

Generated: 2026-07-26T19:27:06.311Z

## Scope

This report evaluates Playoff Pulse on NBA playoff series from 2003-2025. It includes 345 historical series and 2070 model-series predictions across six model variants.

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
| srs_proxy_only | 345 | 0.1801 | 0.5354 | 71.3% |
| net_rating_only | 345 | 0.1819 | 0.5400 | 72.2% |
| playoff_pulse | 345 | 0.1825 | 0.5447 | 72.5% |
| higher_seed | 345 | 0.2077 | 0.6066 | 71.6% |
| home_team | 345 | 0.2089 | 0.6091 | 70.9% |
| coinflip | 345 | 0.2500 | 0.6931 | 50.0% |

## Calibration Data

### playoff_pulse

| Bucket | Count | Mean Prediction | Actual Win Rate |
|---|---:|---:|---:|
| 0.2-0.3 | 3 | 25.0% | 33.3% |
| 0.3-0.4 | 2 | 38.0% | 0.0% |
| 0.4-0.5 | 26 | 46.8% | 50.0% |
| 0.5-0.6 | 82 | 55.4% | 58.5% |
| 0.6-0.7 | 101 | 65.2% | 67.3% |
| 0.7-0.8 | 81 | 74.4% | 88.9% |
| 0.8-0.9 | 43 | 84.7% | 88.4% |
| 0.9-1.0 | 7 | 92.3% | 100.0% |

### coinflip

| Bucket | Count | Mean Prediction | Actual Win Rate |
|---|---:|---:|---:|
| 0.5-0.6 | 345 | 50.0% | 71.6% |

### home_team

| Bucket | Count | Mean Prediction | Actual Win Rate |
|---|---:|---:|---:|
| 0.5-0.6 | 15 | 50.0% | 66.7% |
| 0.6-0.7 | 330 | 65.0% | 71.8% |

### higher_seed

| Bucket | Count | Mean Prediction | Actual Win Rate |
|---|---:|---:|---:|
| 0.6-0.7 | 345 | 65.0% | 71.6% |

### srs_proxy_only

| Bucket | Count | Mean Prediction | Actual Win Rate |
|---|---:|---:|---:|
| 0.1-0.2 | 3 | 14.5% | 33.3% |
| 0.2-0.3 | 1 | 24.2% | 0.0% |
| 0.3-0.4 | 5 | 33.9% | 20.0% |
| 0.4-0.5 | 28 | 45.6% | 60.7% |
| 0.5-0.6 | 50 | 55.4% | 52.0% |
| 0.6-0.7 | 53 | 65.2% | 66.0% |
| 0.7-0.8 | 82 | 75.2% | 72.0% |
| 0.8-0.9 | 66 | 84.6% | 86.4% |
| 0.9-1.0 | 57 | 94.5% | 89.5% |

### net_rating_only

| Bucket | Count | Mean Prediction | Actual Win Rate |
|---|---:|---:|---:|
| 0.1-0.2 | 3 | 15.0% | 33.3% |
| 0.2-0.3 | 2 | 25.6% | 0.0% |
| 0.3-0.4 | 6 | 35.6% | 33.3% |
| 0.4-0.5 | 27 | 45.8% | 55.6% |
| 0.5-0.6 | 40 | 55.1% | 55.0% |
| 0.6-0.7 | 53 | 65.1% | 64.2% |
| 0.7-0.8 | 73 | 75.2% | 72.6% |
| 0.8-0.9 | 72 | 84.8% | 79.2% |
| 0.9-1.0 | 69 | 95.0% | 91.3% |
