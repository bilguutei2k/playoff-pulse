# Playoff Pulse Backtest Methodology

Generated: 2026-08-01T04:09:29.900Z

## Scope

This report evaluates Playoff Pulse on NBA playoff series from 2003-2026. It includes 360 historical series and 2160 model-series predictions across six model variants.

## Data Sources

- Basketball-Reference playoff summary pages: series matchups, winners, and series game counts.
- Basketball-Reference playoff schedule pages: game dates, home/away designation, and scores.
- Basketball-Reference team ratings pages: regular-season ORtg, DRtg, net rating, adjusted margin proxy, wins, and losses.
- Basketball-Reference advanced player pages: regular-season BPM, games played, and minutes retained for research candidates, not the published baseline.

Raw HTML is cached under `data/historical/raw/` and normalized JSON is written under `data/historical/series/`, `data/historical/games/`, and `data/historical/team-snapshots/`.

## Evidenced Baseline and Scenario Overlay

- `netRating` is calculated as ORtg minus DRtg from regular-season team ratings.
- The historical point-scale rating stored in the legacy-compatible `eloRating` field is `1500 + SRS × 35`; it is an SRS point proxy, not Elo.
- The published Playoff Pulse baseline uses only the fixed net-rating term, SRS point-proxy term, home-court term, and logistic scale. Its existing coefficients were not refit when the baseline/overlay boundary was introduced.
- Player impact, projected minutes, injuries, and manual adjustments are excluded from every published baseline prediction and from this backtest path.
- Those manual inputs are available only through a visibly separate scenario overlay. The overlay defaults to zero, is always shown beside the baseline with a delta, and has no point-in-time historical validation.
- Player BPM and normalized regular-season MPG remain in the archive for explicitly labeled research candidates. They do not enter the published baseline Brier.
- Simulated series reconstruct the full seven-game home pattern from the actual Game 1 host: 2-3-2 for NBA Finals through 2013 and 2-2-1-1-1 otherwise. Games beyond the realized series length therefore keep the era-correct home court instead of defaulting to neutral.

## Leakage Controls

- Every team snapshot uses the configured regular-season end date for that season.
- The runner asserts `snapshot_as_of < seriesStartDate` for both teams before writing predictions.
- Baseline team ratings come from regular-season BBRef pages only.
- The backtest runner consumes historical snapshots and does not import the current manual forecast config.

## Known Limitations

- The SRS point proxy is not a possession-by-possession Elo history; its legacy storage field is retained only for model compatibility.
- The baseline/overlay split was defined after historical results existed. Its Brier is descriptive, not prospective evidence for that design decision.
- Historical injuries, absences, and minute changes are not modeled; therefore the scenario overlay is unvalidated.
- 2020 bubble series are tagged and model home-court advantage is set to zero, but BBRef still supplies nominal home/away designations.
- This is an evaluation harness, not a calibrated production forecast or betting model.

## Results

Accuracy gives half credit to exact 50/50 predictions because those predictions do not favor either team.

| Model | N | Brier Score | Log Loss | Accuracy |
|---|---:|---:|---:|---:|
| srs_proxy_only | 360 | 0.1833 | 0.5436 | 70.8% |
| net_rating_only | 360 | 0.1852 | 0.5489 | 71.7% |
| playoff_pulse | 360 | 0.1900 | 0.5641 | 72.5% |
| higher_seed | 360 | 0.2083 | 0.6079 | 71.4% |
| home_team | 360 | 0.2095 | 0.6102 | 70.7% |
| coinflip | 360 | 0.2500 | 0.6931 | 50.0% |

## Calibration Data

### playoff_pulse

| Bucket | Count | Mean Prediction | Actual Win Rate |
|---|---:|---:|---:|
| 0.2-0.3 | 1 | 28.9% | 0.0% |
| 0.3-0.4 | 4 | 35.2% | 50.0% |
| 0.4-0.5 | 25 | 47.4% | 44.0% |
| 0.5-0.6 | 100 | 55.4% | 59.0% |
| 0.6-0.7 | 133 | 64.7% | 73.7% |
| 0.7-0.8 | 69 | 74.4% | 85.5% |
| 0.8-0.9 | 28 | 82.9% | 100.0% |

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
