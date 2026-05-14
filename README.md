# Playoff Pulse

Playoff Pulse is a deployed NBA playoff forecasting dashboard built as a portfolio-quality analytics showcase. It demonstrates how to frame an ambiguous sports analytics problem, expose model assumptions, run validation checks, and communicate uncertainty honestly.

This is not a sportsbook, not a betting recommendation tool, and not a fake AI prediction app. Probabilities are model estimates from manual inputs.

## Live Demo

Live demo: `TODO: add deployed URL`

## Tech Stack

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- Lucide React icons
- pnpm

## Methodology Summary

The model builds a point-scale team strength estimate from:

- player-minute weighted impact
- net rating
- Elo-derived point value
- manual adjustment

Expected margins are converted into win probabilities with a logistic function. Remaining games are simulated through best-of-seven series, and the bracket Monte Carlo simulation estimates conference finals, Finals, and championship probabilities.

## Architecture Overview

- `src/lib/data`: manual playoff configuration and model settings
- `src/lib/model`: probability, team strength, series simulation, bracket simulation, and validation logic
- `src/lib/live-data`: read-only live scoreboard normalization and provider logic
- `src/components/forecast`: dashboard, probability tables, series cards, model controls, and team detail drawer
- `src/app`: public routes for the dashboard, methodology, case study, and live scoreboard API route
- `scripts/verify-model.ts`: local validation checks for model behavior and bracket consistency

The current forecast model uses static TypeScript data and pure model functions. A read-only server route can fetch and normalize a live NBA scoreboard feed, but that feed does not yet overwrite model inputs. The app does not require a database or auth system.

## Live Data Layer

- `/api/live-scoreboard` fetches a public NBA scoreboard feed server-side.
- The feed is normalized into a small typed snapshot before reaching the UI.
- The dashboard displays feed status, fetched timestamp, game rows, and manual-team matches.
- Forecast probabilities still come from manual model inputs until explicit reconciliation rules are added.

## Validation Checks

The verification script checks core model behavior, including:

- equal teams are close to 50 percent on neutral court
- home court changes game probability
- manual adjustments affect outputs
- injuries affect player-minute impact and probabilities
- series simulations terminate correctly
- full bracket title probabilities sum to approximately 100 percent
- bracket coverage warnings surface incomplete paths
- live scoreboard normalization maps games, teams, status, scores, and manual-team matches

Run:

```bash
corepack pnpm verify
corepack pnpm build
```

## Current Limitations

- Team ratings, player impacts, projected minutes, injuries, and series states are manual estimates.
- Live scoreboard data is observational only and does not drive forecast math yet.
- No odds feed, market comparison, database, or authentication is active.
- Probabilities are not presented as calibrated betting edges.
- Player impact values are subjective and intended for transparent demonstration.

## Future Roadmap

- Add explicit live-to-manual reconciliation for scores and series state.
- Add injury and lineup source citations.
- Add market odds comparison as a separate analysis layer.
- Add historical backtesting and calibration reports.
- Add editable rotation assumptions with saved scenario exports.
- Add clearer provenance metadata for every manual input.

## Portfolio Framing

This project is meant to show practical product and engineering judgment: transparent forecasting methodology, typed data/model/UI separation, validation discipline, polished public presentation, and honest communication of uncertainty.
