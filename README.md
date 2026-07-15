# Playoff Pulse

Playoff Pulse is a deployed NBA playoff forecasting dashboard built as a portfolio-quality analytics showcase. It demonstrates how to frame an ambiguous sports analytics problem, expose model assumptions, run validation checks, and communicate uncertainty honestly.

This is not a sportsbook, not a betting recommendation tool, and not a fake AI prediction app. Probabilities are model estimates from manual inputs.

## Live Demo

Live demo: https://548-sable.vercel.app

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
- rating-derived point value
- manual adjustment

Expected margins are converted into win probabilities with a logistic function. Remaining best-of-seven paths are solved exactly; the bracket simulation samples shared team-strength, availability, and parameter uncertainty to estimate advancement probabilities.

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
- exact series paths terminate correctly and final-score probabilities sum to one
- historical playoff rotations total exactly 240 minutes
- uncertainty intervals are deterministic, ordered, and bounded
- full bracket title probabilities sum to approximately 100 percent
- bracket coverage warnings surface incomplete paths
- live scoreboard normalization maps games, teams, status, scores, and manual-team matches

Run:

```bash
corepack pnpm verify
corepack pnpm build
corepack pnpm backtest:pregame
corepack pnpm backtest:evidence
corepack pnpm archive:forecast -- --issued-at 2026-06-01T19:00:00-07:00
```

## Current Limitations

- Team ratings, player impacts, projected minutes, injuries, and series states are manual estimates.
- Live scoreboard data is observational only and does not drive forecast math yet.
- No odds feed, market comparison, database, or authentication is active.
- Rolling-origin calibration evidence applies to the historical research model, not subjective production inputs or betting edges.
- Player impact values are subjective and intended for transparent demonstration.

## Model Research

- Historical rotations are normalized to 240 minutes with raw MPG retained.
- Rolling-origin evaluation trains only on seasons before each test season.
- Strong fitted seed/rating baselines, calibration diagnostics, and season-clustered intervals are reported.
- Candidate player and matchup additions are retained as rejected ablations because they did not reliably improve game forecasts.
- Exact score distributions, availability scenarios, sensitivity ranges, model versioning, and forecast archives are exposed in the product.

See `docs/model-development.md` and `docs/backtest/research.json` for the promotion protocol and reproducible results.

The `/lab` route provides a clearly labeled preserved scenario workspace. The
`/evidence` route provides reconstructed pregame timelines, separate game and
series calibration, failure analysis, and immutable production-version
comparison. Full implementation details are in
`docs/point-in-time-implementation.md`.

## Portfolio Framing

This project is meant to show practical product and engineering judgment: transparent forecasting methodology, typed data/model/UI separation, validation discipline, polished public presentation, and honest communication of uncertainty.
