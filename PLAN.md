# Playoff Pulse — Backtesting & Evaluation Harness

> Archived initial implementation plan. Its 2016–2025 ranges describe the
> original build target, not the current 1984–2026 evaluation scope.

## Overview

Build two coupled systems:
1. **Historical playoff data pipeline** — scrape NBA playoff results from Basketball-Reference (BBRef) for 2016–2025, normalize into a clean schema, cache JSON committed in the repo.
2. **Backtest + evaluation harness** — run the existing model against each historical series under leakage-safe conditions, compute Brier score, log loss, and calibration curves, compare against five baselines, produce a methodology-quality report.

## Option Choice: Option 3 — Hybrid

- **Net Rating** (`ORTG − DRTG`): from BBRef team ratings page (end-of-regular-season).
- **Elo proxy**: `1500 + SRS × 35` where SRS is from the same BBRef ratings page.
- **Player impact proxy**: per-player BPM and MP/G from BBRef advanced stats. Uses BPM as `impact`, `min(mpg, 40)` as `projectedMinutes`. All historical players treated as healthy.
- Documented gaps: Elo from SRS proxy, BPM vs. manual impact, no historical injury data, 2020 bubble home-court caveat.

## Tech Stack

- TypeScript + tsx (existing)
- `cheerio` v1.2.0 (installed) — HTML parsing
- Native Node 24 `fetch` — HTTP
- No new runtime dependencies

## File Structure

```
data/historical/
  raw/                              # cached BBRef HTML — NOT committed
    {year}/
      playoff-bracket.html
      playoff-games.html
      team-ratings.html
      player-advanced.html
  series/                           # normalized series JSON — committed
    2016.json … 2025.json
  games/                            # normalized game-level JSON — committed
    2016.json … 2025.json
  team-snapshots/                   # pre-series team inputs — committed
    2016.json … 2025.json

scripts/backtest/
  types.ts                          # re-exports from src/lib/backtest/types.ts
  scrape-bbref.ts                   # BBRef fetcher + parsers
  build-snapshots.ts                # raw → normalized JSON
  run-backtest.ts                   # main runner
  evaluate.ts                       # metrics
  baselines.ts                      # 5 baseline models
  report.ts                         # generate docs/backtest/ outputs

src/lib/backtest/
  types.ts                          # canonical shared types
  metrics.ts                        # pure evaluation functions
  leakage-check.ts                  # leakage assertion utilities

docs/backtest/
  methodology.md                    # generated report
  results.json                      # generated machine-readable results
```

## BBRef Data Sources (4 pages × 10 years = 40 requests)

| Page key | URL | Purpose |
|---|---|---|
| `playoff-bracket` | `https://www.basketball-reference.com/playoffs/NBA_{YEAR}.html` | Series results, matchups, seeds |
| `playoff-games` | `https://www.basketball-reference.com/playoffs/NBA_{YEAR}_games.html` | Game-by-game dates and scores |
| `team-ratings` | `https://www.basketball-reference.com/leagues/NBA_{YEAR}_ratings.html` | ORTG, DRTG, Net Rating, SRS, W, L |
| `player-advanced` | `https://www.basketball-reference.com/leagues/NBA_{YEAR}_advanced.html` | BPM, MP/G, GP per player |

Rate limiting: 2-second delay between uncached requests.
Cache: save HTML to `data/historical/raw/{year}/{page-key}.html`; skip fetch if cached.

## Leakage Rules

- Every `TeamSeasonSnapshot` has `snapshot_as_of` = last day of regular season (strictly before first playoff game).
- `REGULAR_SEASON_END_DATES` in `build-snapshots.ts` provides these dates.
- The backtest runner calls `assertNoLeakage` before writing any results.
- Regular-season team ratings pages on BBRef cover only regular-season games (not playoffs), so team stats are naturally leakage-safe.
- Player advanced stats pages (`/leagues/NBA_{YEAR}_advanced.html`) show regular-season per-player stats only by default.

## 2020 Bubble

All 2020 series tagged `bubble: true`. Home pattern still uses seeded assignment (higher seed = home), but the methodology doc notes no physical home-court advantage existed.

## Baseline Models

| Name | Logic | P(teamA wins) — teamA = higher seed |
|---|---|---|
| `coinflip` | Always 0.5 | 0.500 |
| `higher_seed` | Fixed prior | 0.650 |
| `home_team` | 0.65 if teamA has home court; 0.5 in bubble | 0.650 / 0.500 |
| `elo_only` | Model with playerWeight=0, netRatingWeight=0, eloWeight=1 | computed |
| `net_rating_only` | Model with playerWeight=0, netRatingWeight=1, eloWeight=0 | computed |

## Phases

### Phase 1 — COMPLETE
Types, stubs, scaffolding, `.gitignore` update, `cheerio` installed. `pnpm verify` and `pnpm build` pass.

---

### Phase 2 — Scraper for 2024 only

**Implement the BBRef scraper for the 2024 playoffs only.**

#### 2.1 Implement `fetchWithCache` in `scripts/backtest/scrape-bbref.ts`

The function signature and cache helpers are already stubbed. Implement the full fetch-with-cache logic:
- Check if `data/historical/raw/{year}/{pageKey}.html` exists → return cached content
- Otherwise fetch from BBRef URL with 2-second rate limiting and `User-Agent` header
- Write response HTML to cache path before returning

#### 2.2 Implement `extractCommentedTable` (already stubbed — verify it works)

BBRef hides some tables inside HTML comments. The stub is present; verify it extracts content correctly when the table ID is inside a comment block.

#### 2.3 Implement `parsePlayoffBracket` for 2024

Parse `https://www.basketball-reference.com/playoffs/NBA_2024.html`.

Expected output for 2024:
- 15 series total (8 first round + 4 conf semis + 2 conf finals + 1 Finals)
- Returns `RawSeriesResult[]`

The BBRef playoff page has a bracket table. Each series shows team names, seeds, and win counts. Parse team abbreviations, round names, conference, seeds, and win totals.

Key 2024 results to validate against:
- NBA Finals: Celtics def. Mavericks 4-1
- East Finals: Celtics def. Pacers 4-0
- West Finals: Mavericks def. Timberwolves 4-1
- Celtics were the 1-seed East, Mavericks the 4-seed West, Pacers 3-seed East, Timberwolves 3-seed West

#### 2.4 Implement `parsePlayoffGames` for 2024

Parse `https://www.basketball-reference.com/playoffs/NBA_2024_games.html`.

This page has a table (`#schedule`) with all playoff games: date, visitor team, visitor score, home team, home score. Parse all rows into `RawGameResult[]`.

#### 2.5 Implement `parseTeamRatings` for 2024

Parse `https://www.basketball-reference.com/leagues/NBA_2024_ratings.html`.

The table (id `#ratings`) has columns including: Team, ORTG, DRTG, Net Rating, SRS, W, L. Parse all teams into `RawTeamRating[]`.

Note: this table may be inside an HTML comment block. Use `extractCommentedTable` if needed.

#### 2.6 Implement `parsePlayerAdvanced` for 2024

Parse `https://www.basketball-reference.com/leagues/NBA_2024_advanced.html`.

The table (id `#advanced`) has per-player rows including: Player name, Tm (team abbreviation), G (games played), MP (minutes per game or total — check which), BPM. Parse into `RawPlayerAdvanced[]`.

Important: filter out "TOT" rows (players who were traded — BBRef shows a "TOT" row for their combined stats plus individual team rows). Keep only the team-specific row for the team they ended the season with (their playoff team), not the TOT row.

Also: some players appear on non-playoff teams. Keep all players for now; `buildSnapshots` will filter to playoff teams.

#### 2.7 Implement `fetchSeasonData` for 2024

Wire together: fetch all 4 pages for 2024 (using `fetchWithCache`), parse each, return the combined object.

#### 2.8 Implement `normalizeSeries` in `build-snapshots.ts` for 2024

Convert `RawSeriesResult[]` + `RawGameResult[]` → `HistoricalSeries[]`.

Rules:
- `teamA` = higher seed (lower seed number); if seeds equal (can happen in Finals based on conference records), use alphabetical order as tiebreak.
- `id` format: `{year}-{conf}-{round-short}-{teamA}-{teamB}` e.g. `"2024-east-r1-bos-mia"`. Round short: `r1`, `csf`, `cf`, `finals`.
- `homePattern`: derive from game-level data — for each game in the series, determine which team was home.
- `seriesStartDate` and `seriesEndDate`: first and last game dates in the series.
- `bubble: false` for 2024.
- Validate: `gamesPlayed` must be 4–7, winner must have exactly 4 wins.

#### 2.9 Implement `normalizeGames` for 2024

Convert `RawGameResult[]` → `HistoricalGame[]`, linking each game to its series via `seriesId`.

Match games to series by: date range (game date between `seriesStartDate` and `seriesEndDate`) and teams (both teams match the series). Assign `gameNumber` as 1-indexed within the series by date order.

#### 2.10 Implement `buildSnapshots` for 2024

Convert `RawTeamRating[]` + `RawPlayerAdvanced[]` + `HistoricalSeries[]` → `TeamSeasonSnapshot[]`.

One snapshot per unique team that appeared in the 2024 playoffs.

Fields:
- `teamId`: BBRef abbreviation (lowercase, e.g. `"bos"`)
- `snapshot_as_of`: `REGULAR_SEASON_END_DATES[2024]` = `"2024-04-14"`
- `eloRating`: `1500 + srs * 35`
- `netRating`: `ortg - drtg`
- `manualAdjustment`: `0` (literal)
- `eloSource`: `"srs_proxy"` (literal)
- `playerImpactSource`: `"bpm_proxy"` (literal)
- `players`: top players by minutes for this team from `RawPlayerAdvanced[]`
  - Filter to players whose `teamId` matches this team
  - Filter out players with fewer than 10 games played (too small a sample)
  - Sort descending by `mpg`
  - Take top 10 (or all if fewer than 10)
  - `impact = bpm` (direct proxy)
  - `projectedMinutes = min(mpg, 40)`
  - `injuryStatus` is not stored in snapshot (all treated as healthy at prediction time)

#### 2.11 Write normalized data to JSON

Call `writeSeriesJson(2024, series)`, `writeGamesJson(2024, games)`, `writeSnapshotsJson(2024, snapshots)` to produce:
- `data/historical/series/2024.json`
- `data/historical/games/2024.json`
- `data/historical/team-snapshots/2024.json`

#### 2.12 Sanity test

Write a test (can be in `scripts/backtest/scrape-bbref.ts` or a separate `scripts/backtest/test-2024.ts`) that:
1. Loads `data/historical/series/2024.json`
2. Asserts the NBA Finals series exists with `winner = "BOS"`, `winsA = 4` (or `winsB = 4` for whichever is BOS), `gamesPlayed = 5`
3. Asserts every series has `gamesPlayed >= 4 && gamesPlayed <= 7`
4. Asserts every `snapshot.snapshot_as_of < series.seriesStartDate` for each team's series

Run the test and confirm it passes.

#### 2.13 Run `corepack pnpm verify` and `corepack pnpm build`

Both must pass before Phase 2 is considered complete.

#### What to flag (do not silently handle)

- If BBRef HTML structure for 2024 differs from what's described (different table IDs, different column order), stop and report the actual structure found.
- If the Celtics-Mavericks Finals sanity check fails (wrong winner, wrong game count), stop and report the raw parsed data.
- If team abbreviations in the ratings page don't match abbreviations in the games page (BBRef sometimes uses different abbreviations), report the discrepancy.
- If any snapshot has `snapshot_as_of >= seriesStartDate`, this is a leakage violation — stop and report.

---

### Phase 3 — Extend to all 10 years (2016–2025)

**After Phase 2 is approved.**

- Run `fetchSeasonData` for all years 2016–2025
- Tag all 2020 series with `bubble: true`
- Implement `validateSeries` and `validateSnapshots` in `build-snapshots.ts`
- Validation rules:
  - Every series: `gamesPlayed >= 4 && gamesPlayed <= 7`
  - Every series: winner has exactly 4 wins
  - Every snapshot: `snapshot_as_of < series.seriesStartDate` (no future data)
  - Every team rating: `netRating` is plausible (e.g., between -15 and +20)
- Report anomalies (don't fail silently — stop and report any found)
- Run `corepack pnpm verify` and `corepack pnpm build`

---

### Phase 4 — Backtest runner + baselines

**After Phase 3 is approved.**

- Implement `snapshotToTeam` in `baselines.ts` (converts `TeamSeasonSnapshot` → `Team` for model consumption)
- Implement `eloOnlyPrediction` and `netRatingOnlyPrediction` in `baselines.ts`
- Implement `playoffPulsePrediction` in `run-backtest.ts` — calls `estimateSeriesProbability` with historical snapshot inputs (NOT `playoff-config.ts`)
- Implement `predictSeries`, `predictSeason`, `runBacktest` in `run-backtest.ts`
- Implement `findLeakageViolations` and `assertNoLeakage` in `src/lib/backtest/leakage-check.ts`
- Run leakage check: assert `snapshot.snapshot_as_of < series.seriesStartDate` for every prediction
- Output: `BacktestPrediction[]` for every (series × model) combination
- Run adversarial Codex review on leakage check specifically
- Run `corepack pnpm verify` and `corepack pnpm build`

---

### Phase 5 — Evaluation + report

**After Phase 4 is approved.**

- Implement all functions in `src/lib/backtest/metrics.ts`: `brierScore`, `logLoss`, `accuracy`, `calibrationBuckets`, `evaluateModel`, `byRoundBreakdown`
- Implement `evaluate` in `scripts/backtest/evaluate.ts`
- Implement `buildReport` and `renderMethodologyMarkdown` in `scripts/backtest/report.ts`
- Write `docs/backtest/results.json` and `docs/backtest/methodology.md`
- Methodology doc must include: data sources, hybrid input methodology, leakage controls, known limitations, results table, calibration data
- Run `corepack pnpm verify` and `corepack pnpm build`
