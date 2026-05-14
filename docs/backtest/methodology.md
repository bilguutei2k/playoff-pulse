# Playoff Pulse Backtest Methodology

Generated: 2026-05-14T09:04:01.937Z

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
| playoff_pulse | 150 | 0.1926 | 0.5669 | 70.7% |
| elo_only | 150 | 0.1939 | 0.5704 | 70.0% |
| net_rating_only | 150 | 0.1948 | 0.5735 | 70.7% |
| higher_seed | 150 | 0.2125 | 0.6165 | 70.0% |
| home_team | 150 | 0.2152 | 0.6221 | 68.3% |
| coinflip | 150 | 0.2500 | 0.6931 | 50.0% |

## Calibration Data

### playoff_pulse

| Bucket | Count | Mean Prediction | Actual Win Rate |
|---|---:|---:|---:|
| 0.2-0.3 | 1 | 27.4% | 100.0% |
| 0.3-0.4 | 3 | 38.6% | 33.3% |
| 0.4-0.5 | 15 | 45.5% | 46.7% |
| 0.5-0.6 | 29 | 55.2% | 55.2% |
| 0.6-0.7 | 47 | 65.3% | 70.2% |
| 0.7-0.8 | 30 | 74.7% | 83.3% |
| 0.8-0.9 | 19 | 85.1% | 84.2% |
| 0.9-1.0 | 6 | 92.8% | 100.0% |

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
| 0.2-0.3 | 3 | 27.6% | 33.3% |
| 0.4-0.5 | 14 | 45.5% | 50.0% |
| 0.5-0.6 | 20 | 55.8% | 45.0% |
| 0.6-0.7 | 20 | 65.0% | 75.0% |
| 0.7-0.8 | 40 | 75.0% | 75.0% |
| 0.8-0.9 | 22 | 84.1% | 72.7% |
| 0.9-1.0 | 30 | 95.1% | 86.7% |

### net_rating_only

| Bucket | Count | Mean Prediction | Actual Win Rate |
|---|---:|---:|---:|
| 0.1-0.2 | 1 | 16.7% | 100.0% |
| 0.2-0.3 | 3 | 26.8% | 33.3% |
| 0.4-0.5 | 15 | 46.0% | 46.7% |
| 0.5-0.6 | 16 | 55.4% | 50.0% |
| 0.6-0.7 | 21 | 64.8% | 66.7% |
| 0.7-0.8 | 36 | 75.0% | 72.2% |
| 0.8-0.9 | 25 | 83.4% | 76.0% |
| 0.9-1.0 | 33 | 95.3% | 87.9% |
