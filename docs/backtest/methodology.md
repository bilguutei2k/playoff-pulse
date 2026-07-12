# Playoff Pulse Backtest Methodology

Generated: 2026-07-12T22:09:00.492Z

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
- `eloRating` is approximated as `1500 + adjustedMargin * 35`; the ratings table exposes adjusted margin (`MOV/A`), not a literal SRS column.
- Player impact is proxied with regular-season BPM.
- Projected minutes use regular-season minutes per game capped at 40.
- Historical manual adjustments are fixed at 0.
- All historical players are treated as healthy because injury timelines are not yet modeled.
- Simulated series use the full seven-game 2-2-1-1-1 home pattern reconstructed from the actual Game 1 host, so games beyond the realized series length keep the correct home court instead of defaulting to neutral.

## Leakage Controls

- Every team snapshot uses the configured regular-season end date for that season.
- The runner asserts `snapshot_as_of < seriesStartDate` for both teams before writing predictions.
- Team ratings and player inputs come from regular-season BBRef pages only.
- The backtest runner consumes historical snapshots and does not import the current manual forecast config.

## Known Limitations

- Elo is an adjusted-margin proxy, not a true possession-by-possession Elo history.
- BPM is a player impact proxy and is not the same scale as the current manual player-impact inputs.
- Historical injuries, absences, and minute changes are not modeled.
- 2020 bubble series are tagged and model home-court advantage is set to zero, but BBRef still supplies nominal home/away designations.
- This is an evaluation harness, not a calibrated production forecast or betting model.

## Results

Accuracy gives half credit to exact 50/50 predictions because those predictions do not favor either team.

| Model | N | Brier Score | Log Loss | Accuracy |
|---|---:|---:|---:|---:|
| playoff_pulse | 150 | 0.1905 | 0.5612 | 70.0% |
| elo_only | 150 | 0.1926 | 0.5680 | 68.7% |
| net_rating_only | 150 | 0.1952 | 0.5759 | 70.0% |
| higher_seed | 150 | 0.2125 | 0.6165 | 70.0% |
| home_team | 150 | 0.2152 | 0.6221 | 68.3% |
| coinflip | 150 | 0.2500 | 0.6931 | 50.0% |

## Calibration Data

### playoff_pulse

| Bucket | Count | Mean Prediction | Actual Win Rate |
|---|---:|---:|---:|
| 0.2-0.3 | 1 | 27.4% | 100.0% |
| 0.3-0.4 | 2 | 37.5% | 0.0% |
| 0.4-0.5 | 11 | 47.6% | 54.5% |
| 0.5-0.6 | 32 | 55.1% | 53.1% |
| 0.6-0.7 | 48 | 65.6% | 68.8% |
| 0.7-0.8 | 30 | 74.3% | 83.3% |
| 0.8-0.9 | 21 | 85.4% | 85.7% |
| 0.9-1.0 | 5 | 92.3% | 100.0% |

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

### elo_only

| Bucket | Count | Mean Prediction | Actual Win Rate |
|---|---:|---:|---:|
| 0.1-0.2 | 1 | 14.5% | 100.0% |
| 0.2-0.3 | 2 | 26.5% | 0.0% |
| 0.3-0.4 | 1 | 33.2% | 100.0% |
| 0.4-0.5 | 12 | 45.8% | 58.3% |
| 0.5-0.6 | 17 | 54.5% | 35.3% |
| 0.6-0.7 | 23 | 64.9% | 73.9% |
| 0.7-0.8 | 41 | 75.5% | 70.7% |
| 0.8-0.9 | 21 | 83.9% | 76.2% |
| 0.9-1.0 | 32 | 95.1% | 87.5% |

### net_rating_only

| Bucket | Count | Mean Prediction | Actual Win Rate |
|---|---:|---:|---:|
| 0.1-0.2 | 1 | 16.7% | 100.0% |
| 0.2-0.3 | 2 | 25.5% | 0.0% |
| 0.3-0.4 | 1 | 31.0% | 100.0% |
| 0.4-0.5 | 14 | 46.3% | 50.0% |
| 0.5-0.6 | 14 | 54.9% | 42.9% |
| 0.6-0.7 | 22 | 65.1% | 68.2% |
| 0.7-0.8 | 38 | 75.5% | 73.7% |
| 0.8-0.9 | 25 | 84.0% | 72.0% |
| 0.9-1.0 | 33 | 95.5% | 87.9% |
