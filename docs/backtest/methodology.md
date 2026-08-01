# Playoff Pulse Backtest Methodology

Generated: 2026-08-01T21:14:49.257Z

## Scope

This report evaluates Playoff Pulse on NBA playoff series from 1984-2026. It includes 645 historical series and 3870 model-series predictions across six model variants.

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
- Simulated series reconstruct the complete season-and-round-specific home pattern from the actual Game 1 host: Best-of-5, 2-2-1 for first rounds through 2002; Best-of-7, 2-3-2 for Finals from 1985 through 2013; and Best-of-7, 2-2-1-1-1 otherwise. Games beyond the realized series length therefore keep the era-correct home court instead of defaulting to neutral.

## Leakage Controls

- Every team snapshot uses the configured regular-season end date for that season.
- The runner asserts `snapshot_as_of < seriesStartDate` for both teams before writing predictions.
- Baseline team ratings come from regular-season BBRef pages only.
- The backtest runner consumes historical snapshots and does not import the current manual forecast config.

## Known Limitations

- The SRS point proxy is not a possession-by-possession Elo history; its legacy storage field is retained only for model compatibility.
- The baseline/overlay split was defined after historical results existed. Its Brier is descriptive, not prospective evidence for that design decision.
- Historical injuries, absences, and minute changes are not modeled; therefore the scenario overlay is unvalidated.
- The pooled 1984-2026 fit spans materially different home-court, pace, and scoring environments without an explicit era term. This makes the registered ten-season training-window candidate a substantive recency test, not a marginal sensitivity check.
- 2020 bubble series are tagged and model home-court advantage is set to zero, but BBRef still supplies nominal home/away designations.
- This is an evaluation harness, not a calibrated production forecast or betting model.

## Results

Accuracy gives half credit to exact 50/50 predictions because those predictions do not favor either team.

| Model | N | Brier Score | Log Loss | Accuracy |
|---|---:|---:|---:|---:|
| srs_proxy_only | 645 | 0.1737 | 0.5201 | 71.9% |
| net_rating_only | 645 | 0.1752 | 0.5237 | 72.6% |
| playoff_pulse | 645 | 0.1855 | 0.5551 | 74.0% |
| higher_seed | 645 | 0.2034 | 0.5978 | 73.0% |
| home_team | 645 | 0.2041 | 0.5991 | 72.6% |
| coinflip | 645 | 0.2500 | 0.6931 | 50.0% |

## Calibration Data

### playoff_pulse

| Bucket | Count | Mean Prediction | Actual Win Rate |
|---|---:|---:|---:|
| 0.2-0.3 | 1 | 28.9% | 0.0% |
| 0.3-0.4 | 7 | 35.5% | 28.6% |
| 0.4-0.5 | 34 | 47.5% | 47.1% |
| 0.5-0.6 | 191 | 55.5% | 57.1% |
| 0.6-0.7 | 245 | 64.7% | 78.4% |
| 0.7-0.8 | 127 | 74.2% | 88.2% |
| 0.8-0.9 | 40 | 83.1% | 100.0% |

### coinflip

| Bucket | Count | Mean Prediction | Actual Win Rate |
|---|---:|---:|---:|
| 0.5-0.6 | 645 | 50.0% | 73.0% |

### home_team

| Bucket | Count | Mean Prediction | Actual Win Rate |
|---|---:|---:|---:|
| 0.5-0.6 | 15 | 50.0% | 66.7% |
| 0.6-0.7 | 630 | 65.0% | 73.2% |

### higher_seed

| Bucket | Count | Mean Prediction | Actual Win Rate |
|---|---:|---:|---:|
| 0.6-0.7 | 645 | 65.0% | 73.0% |

### srs_proxy_only

| Bucket | Count | Mean Prediction | Actual Win Rate |
|---|---:|---:|---:|
| 0.1-0.2 | 4 | 15.2% | 25.0% |
| 0.2-0.3 | 3 | 24.5% | 33.3% |
| 0.3-0.4 | 8 | 34.2% | 25.0% |
| 0.4-0.5 | 46 | 45.9% | 65.2% |
| 0.5-0.6 | 88 | 55.3% | 46.6% |
| 0.6-0.7 | 116 | 65.5% | 67.2% |
| 0.7-0.8 | 151 | 75.0% | 76.2% |
| 0.8-0.9 | 131 | 84.8% | 87.0% |
| 0.9-1.0 | 98 | 94.4% | 90.8% |

### net_rating_only

| Bucket | Count | Mean Prediction | Actual Win Rate |
|---|---:|---:|---:|
| 0.1-0.2 | 4 | 15.8% | 25.0% |
| 0.2-0.3 | 5 | 25.7% | 20.0% |
| 0.3-0.4 | 9 | 36.1% | 44.4% |
| 0.4-0.5 | 45 | 46.3% | 60.0% |
| 0.5-0.6 | 77 | 55.3% | 51.9% |
| 0.6-0.7 | 102 | 65.4% | 63.7% |
| 0.7-0.8 | 141 | 74.8% | 75.2% |
| 0.8-0.9 | 140 | 84.9% | 81.4% |
| 0.9-1.0 | 122 | 94.7% | 92.6% |
