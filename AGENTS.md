# AGENTS.md

## Project Identity
- Playoff Pulse is a transparent, manually configured NBA playoff forecasting dashboard.
- It is a polished MVP with a working model, deployed at https://548-sable.vercel.app.
- It is not a betting product. Modeling inputs — team ratings, player impact, projected minutes, injury statuses, and model weights — remain manual configuration; the model itself does not consume live data at runtime. The model has been backtested against 150 playoff series (2016–2025), first on May 13, 2026 and regenerated on July 12, 2026 after correcting a minutes-parsing defect and home-pattern truncation in the historical inputs; see docs/backtest/methodology.md for results and known limitations. It is not yet calibrated against external benchmarks or production-grade for unsupervised public use.
- Series scores and the snapshot timestamp are updated via a PR-gated GitHub Actions workflow that fetches finalized game results from the ESPN public scoreboard daily (`.github/workflows/refresh-data.yml` + `scripts/refresh-data.ts`). The workflow opens a pull request; a human reviewer merges or rejects before any change reaches `src/lib/data/playoff-config.ts` on the default branch. No other model inputs are auto-fetched.
- The repo includes a read-only live scoreboard probe for display only: `src/app/api/live-scoreboard/route.ts`, `src/lib/live-data/espn-scoreboard.ts`.
- The scoreboard MUST NOT feed model inputs. Team ratings, player impact, projected minutes, and injuries remain manual in `src/lib/data/`.

## Hard Model-Correctness Rules
- Probabilities MUST be bounded between 0 and 1. Validate at output boundaries.
- Series simulation MUST respect current series score from config.
- Home-court pattern MUST apply to the correct remaining games, not arbitrary games.
- Injured or out players MUST affect projected minutes or impact; out means 0 contribution.
- Stronger teams MUST win more often in simulation. This is a verifier invariant.
- Equal teams on neutral court MUST be near 50/50.
- Random number generation MUST be seeded; same inputs must produce same outputs.
- Historical backtests MUST NOT use future data. Check available-at-time-of-prediction.
- UI probabilities MUST NOT use fake precision. One decimal point is enough.
- New probability outputs MUST add or reuse invariants in `scripts/verify/invariants.ts` (generic) or `scripts/verify/data-snapshot.ts` (current-snapshot assertions).

## Never Do
- Never put forecasting math in UI components.
- Never import from `src/lib/live-data/` inside `src/lib/model/`. Never pass scoreboard-derived values into model functions. The scoreboard is display-only.
- Never claim official NBA data sources. Current model data is manually configured; the authoritative snapshot time is `dataLastUpdatedTimestamp` in `src/lib/data/playoff-config.ts`.
- Never hide placeholder or manual-data caveats. Keep caveats visible in the UI.
- Never make betting recommendations or use betting framing. Market odds, if added later, are comparison only.
- Never present model output as authoritative beyond what has been validated.
- Never hard-code team IDs inside model functions. Look teams up through config or typed maps.
- Never use unbounded probability operations that could produce values outside [0, 1].
- Never write simulations that do not terminate correctly; every series ends at 4 wins.
- Never produce randomness that changes on re-render. Keep stochastic work out of render paths.
- Never broadly rewrite working code without a stated reason and user approval.

## Architectural Layers
- Data/config layer: `src/lib/data/` owns manual teams, players, ratings, injuries, projected minutes, series state, home patterns, and model settings. Do not put forecasting math here.
- Live-data display layer: `src/lib/live-data/` and `/api/live-scoreboard` normalize external scoreboard data for display only. Do not feed this into model inputs.
- Model engine layer: `src/lib/model/` contains pure reusable TypeScript functions for player-minute impact, team strength, expected margin, win probability, series simulation, and bracket Monte Carlo.
- Model modules MUST NOT import React or UI code.
- UI layer: `src/components/` and `src/app/` display model outputs and controls. They MUST NOT contain Monte Carlo logic, probability formulas, or rating math.
- Methodology layer: `src/app/methodology/page.tsx` explains formulas, assumptions, manual sources, and limitations.
- Evaluation layer: `scripts/` contains verification now and may contain backtesting or calibration later.

## Workflow Rules
- For non-trivial changes, propose a plan first and wait for approval before writing code.
- When uncertain about a modeling decision, state the uncertainty and propose options. Do not silently pick.
- New model components need types, a pure function, a verify-script invariant, and a methodology update or TODO.
- Keep TypeScript strict. Do not loosen types to silence errors.
- Use existing dependencies and patterns unless the user approves a package or architecture change.
- Before claiming done, run `corepack pnpm verify` and `corepack pnpm build`.
- Use `corepack pnpm lint` when touching lint-sensitive app code; note existing lint scope if unrelated files fail.
- Use `corepack pnpm dev` for local development and `corepack pnpm start` for production start checks.

When claiming a task is done, include the actual output or summary of the verify/build commands you ran. Never claim a check passed without running it in this session.

## Verification Expectations
- `corepack pnpm verify` runs `scripts/verify-model.ts`, which runs both halves of the verifier:
  - `scripts/verify/invariants.ts` (`pnpm verify:invariants`) — generic model invariants that must hold for any valid config: equal teams near 50/50, stronger teams/home court/adjustments/injuries move probabilities the right way, series terminate at 4 wins and respect the home pattern, a 3-0 lead massively improves series probability, title probabilities sum to ~100%, no reach probability exceeds 1.0, and live scoreboard normalization (display-only) maps games, scores, and ESPN abbreviation aliases.
  - `scripts/verify/data-snapshot.ts` (`pnpm verify:data`) — assertions describing the current manual snapshot (rosters, series scores, bracket state). Update this file in the same commit as any manual data change.
- The automated refresh workflow runs ONLY `pnpm verify:invariants`, because the refresh changes series scores by design and snapshot assertions would block every legitimate update.
- New model features should add focused invariants before UI polish.

## Tech Stack and Project Map
- Package scripts live in `package.json`; use the actual `dev`, `build`, `start`, `lint`, and `verify` scripts.
- Next.js, React, TypeScript, Tailwind CSS, Lucide React, and pnpm are the current stack.
- Model weights are in `src/lib/data/model-settings.ts:3`.
- Manual data timestamp and live probe label are in `src/lib/data/playoff-config.ts:11`-`src/lib/data/playoff-config.ts:13`.
- Manual teams, series, and market placeholder config are in `src/lib/data/playoff-config.ts:224`, `src/lib/data/playoff-config.ts:225`, and `src/lib/data/playoff-config.ts:359`.
- Probability math is in `src/lib/model/probability.ts:14`-`src/lib/model/probability.ts:90`.
- Series simulation exports are in `src/lib/model/simulator.ts:69`-`src/lib/model/simulator.ts:196`.
- Bracket simulation exports are in `src/lib/model/bracket-simulator.ts:135` and `src/lib/model/bracket-simulator.ts:257`.
- UI lives under `src/components/forecast/`, layout under `src/components/layout/`, and routes under `src/app/`.

## Where To Look
- Model weights/config: `src/lib/data/model-settings.ts`; team/player/series state: `src/lib/data/playoff-config.ts`.
- Win probability math: `src/lib/model/probability.ts`; series simulation: `src/lib/model/simulator.ts`; bracket simulation: `src/lib/model/bracket-simulator.ts`.
- Live scoreboard display probe: `src/lib/live-data/espn-scoreboard.ts` and `src/app/api/live-scoreboard/route.ts`; verifier: `scripts/verify-model.ts`.
