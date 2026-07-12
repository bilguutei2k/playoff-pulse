# Codebase Handover — Playoff Pulse

Audit date: 2026-07-12. Auditor: incoming technical maintainer (AI-assisted audit).
Branch audited: `feature/setup` at `4eb8872` ("Update Finals after Game 3").

> **Remediation, 2026-07-12 (same day, after the audit):** the five most serious
> findings were fixed in the working tree — see §0 "Remediation Log" below.
> Sections 1–20 preserve the audit as performed; findings that have since been
> fixed are marked **[FIXED 2026-07-12]** inline. The improvement register in
> §16 reflects post-remediation status.

---

## 0. Remediation Log (2026-07-12)

All changes are in the working tree (not committed); `pnpm verify`, `pnpm build`,
and `pnpm lint` pass after every item.

1. **Final state restored (P0-1 symptom).** `src/lib/data/playoff-config.ts`
   now records the completed Finals — NYK defeated SAS 4-1 (Game 4: NYK 107-106
   at New York, June 10; Game 5: NYK 94-90 at San Antonio, June 13; both
   verified against the ESPN scoreboard). Snapshot timestamp updated to
   2026-07-12 02:45 PM PT. The dashboard shows a "Playoffs complete" status
   pill and an explanatory empty state instead of a bare "Active Series"
   section (`src/components/forecast/ForecastDashboard.tsx` — display logic
   only, no model math).
2. **ESPN abbreviation mismatch fixed (P0-1 root cause).** New module
   `src/lib/live-data/espn-abbreviations.ts` maps ESPN feed abbreviations
   (NY, SA, GS, NO, UTAH, WSH) to standard tricodes. Both the refresh matcher
   (`scripts/refresh-data.ts`) and the display-layer manual-team counter
   (`src/lib/live-data/espn-scoreboard.ts`) now canonicalize both sides before
   comparing. The refresh script additionally emits a loud warning (console +
   PR summary section) when a final game matches exactly one active-series
   team — the signature of a future unknown alias.
3. **Self-blocking verifier fixed (P0-2).** `scripts/verify-model.ts` was split:
   `scripts/verify/invariants.ts` (generic, any-config; `pnpm verify:invariants`),
   `scripts/verify/refresh-checks.ts` (refresh regression fixtures;
   `pnpm verify:refresh`), and `scripts/verify/data-snapshot.ts`
   (current-snapshot assertions; `pnpm verify:data`). `pnpm verify` still runs
   all three. The refresh workflow now runs only invariants + refresh checks,
   so a legitimate score update can no longer fail its own PR gate. The
   state-dependent injury-sensitivity invariant was made robust to a completed
   bracket (it resets the Finals to 0-0 for that check only).
4. **Fabricated snapshot timestamp fixed (P0-4).** The refresh script now
   stamps the actual run moment in PT (`ptSnapshotStamp`) instead of a
   forward-dated "11:00 PM PT", so same-evening games remain newer than the
   snapshot and are counted by the next run. The em-dash/hyphen header-regex
   mismatch was also fixed (hyphen everywhere) and a silent header no-op now
   warns. `main()` is guarded behind `require.main` so importing the exported
   helpers for testing can never trigger a refresh.
5. **Backtest minutes bug fixed and inputs rebuilt (P0-3).** `mpg` is now
   always `totalMinutes / gamesPlayed` (the BBRef advanced MP column is always
   totals), with a `gamesPlayed > 0` guard and a new `mpg > 44` /
   `projectedMinutes > 40` validator in `build-snapshots.ts`. All 40 BBRef
   pages were re-fetched (delay raised to 3.5 s per BBRef's 20-req/min crawl
   policy) and snapshots rebuilt. **The corruption was broader than the audit's
   7 flagged players: 21 team-seasons had a garbage-time player wrongly in
   their top-10 rotation (22 players replaced).** Series and game files came
   back byte-identical to the committed versions.
6. **Truncated home patterns fixed (finding 5).** `fullHomePattern` in
   `scripts/backtest/baselines.ts` reconstructs the seven-slot 2-2-1-1-1
   pattern from the Game 1 host and asserts it against every game actually
   played (all 150 series conform; verified before implementing). Simulated
   games beyond the realized series length now keep the correct home court
   instead of defaulting to neutral.
7. **Backtest regenerated and all published numbers re-synced.**
   `predictions.json`, `results.json`, and `docs/backtest/methodology.md` were
   regenerated; the UI methodology page and `BacktestSummaryCard` were updated
   to match, with a visible correction note. Headline movement (old → new):
   playoff_pulse Brier **0.1926 → 0.1905** (log loss 0.5669 → 0.5612, accuracy
   70.7% → 70.0%); elo_only 0.1939 → 0.1926; net_rating_only 0.1948 → 0.1952;
   structural baselines unchanged. The model's edge over elo_only **widened
   from 0.0013 to 0.0022** Brier (net-rating-only: 0.0048) — the audit's
   concern that the fix might flip the headline claim did not materialize, and
   every qualitative conclusion (first-round weakness vs Elo-only, mid-round
   strength, high-bucket underconfidence, ~+0.03 bubble degradation) survived.
   All regenerated metrics were re-verified by independent recomputation from
   `predictions.json`, and the rebuilt data passed the full §9 consistency
   audit with zero implausible-minutes players.
8. **AGENTS.md updated** to describe the split verifier, the regenerated
   backtest, and to stop embedding a rot-prone data date.

**Follow-up hardening (same day, second pass):**

9. **CI added** (`.github/workflows/ci.yml`): lint + full `pnpm verify` +
   build on pushes to `main`/`feature/setup` and on all PRs. Documented
   caveat: automated data-refresh PRs will fail the `verify` step until a
   human updates `scripts/verify/data-snapshot.ts` on the PR branch — data
   changes and their pinned expectations must land together (the refresh
   workflow itself still gates only on invariants + refresh checks, so the PR
   is always created).
10. **Freshness alerting added.** `scripts/refresh-data.ts` now fails loudly
    (exit 1 + "STALE DATA ALARM" section in the summary) when active series
    exist but the snapshot has not advanced in >4 days (`REFRESH_STALE_DAYS`
    to override) — no NBA playoff series pauses that long, so a quiet stretch
    means the pipeline broke. The dashboard mirrors this with a client-side
    staleness banner (same 4-day threshold, `useSyncExternalStore` so the
    static prerender never disagrees with the viewer's clock). Boundary-tested
    in `verify/refresh-checks.ts`.
11. **Backtest numbers wired to a generated artifact.** `report.ts` now also
    emits `docs/backtest/summary.json` (~1 KB headline file);
    `BacktestSummaryCard` and the methodology sidebar import it at build time
    and compute their deltas from it. Regenerating the backtest now updates
    the displayed numbers automatically. Display rounding standardized on
    `toFixed(3)` of the stored values (headline Brier renders **0.190**;
    higher-seed renders 0.212), and the methodology prose was aligned to
    match. Narrative paragraphs (round-table, calibration commentary) remain
    authored by hand — deliberately, since they need human rewording when
    results change.

Not addressed (unchanged from the audit): JSON-based series state,
seed-inference tiebreakers, raw-HTML archival policy, calibration work — see
§16 P1/P2.

Every material claim below is labeled: **[Confirmed-impl]** (verified against code/data/commands run during this audit), **[Confirmed-doc+impl]** (documentation cross-checked against implementation), **[Strong inference]**, **[Weak inference]**, or **[Unknown]**. Commands executed and their outputs are listed in §20.

---

## 1. Executive Summary

**What this is.** A transparent, manually configured NBA playoff forecasting dashboard (Next.js/TypeScript, no database, no auth) built as a portfolio analytics showcase, plus a genuinely rigorous historical backtesting harness covering 150 playoff series (2016–2025). **[Confirmed-doc+impl]**

**Overall condition.** The model engine and backtest harness are the strongest parts: pure, typed, seeded (fully reproducible), invariant-checked, and honestly documented. The operational layer is the weakest part — and it is currently **failing silently in production**.

**The single most important finding [FIXED 2026-07-12, see §0]:** the deployed site (https://548-sable.vercel.app, HTTP 200 verified 2026-07-12) still shows the NBA Finals at NYK 2–1 SAS with live championship probabilities, dated 2026-06-08. In reality the Knicks won the title 4–1 on 2026-06-13 (verified against the ESPN scoreboard endpoint during this audit). The daily data-refresh GitHub Action has run every day and reported **success** every day while updating nothing, because ESPN reports the Knicks and Spurs as `NY` and `SA` while the config uses `NYK` and `SAS`; the game-matching logic silently matches zero games. Two further latent defects (a verifier that hard-codes the current series score, and a fabricated "11:00 PM PT" snapshot timestamp) would each independently have broken the pipeline even if the abbreviation bug did not exist. See §15/§16, findings P0-1..P0-3. **[Confirmed-impl — run logs, endpoint probes, prod curl]** All three defects and the stale data are fixed in the working tree; production remains wrong until the fixes are committed and deployed.

**Analytical trustworthiness.** The published backtest numbers (Brier 0.1926, etc.) are internally consistent — I recomputed every headline metric and the methodology page's round-level and bubble tables from `docs/backtest/predictions.json` and they match exactly, and individual model predictions reproduce bit-identically from the committed snapshots. However, the **inputs** to six team-season snapshots are corrupted by a minutes-parsing heuristic (total minutes ≤ 48 misread as minutes *per game*, promoting garbage-time players to 40-minute starters, worst case shifting a team's expected margin by ~1.6 points). Because the model's published edge over the Elo-only baseline is only 0.0013 Brier, the headline claim "Playoff Pulse beats all baselines" is **fragile** and could flip when this is fixed. **[Confirmed-impl — quantified in §7/§15]** **[FIXED 2026-07-12]:** rebuild revealed the corruption reached 21 team-seasons; after the fix and regeneration the headline *improved* to Brier 0.1905 and the edge over elo_only widened to 0.0022 — the claim survived (§0.7).

**Production readiness.** Fine as a static portfolio demo; not production-ready as an automatically refreshing forecast product. The refresh pipeline needs the three P0 fixes plus staleness monitoring before it can be trusted.

**Recommended immediate direction.** ~~(1) Manually correct the Finals result and put the dashboard into a truthful "season complete" state; (2) fix the three refresh-pipeline defects; (3) fix the backtest minutes bug and regenerate the published numbers; (4) split the verifier into permanent invariants vs. snapshot-specific data checks;~~ **(1)–(4) done 2026-07-12 (§0).** Next: commit and deploy the fixes, then (5) add CI and staleness alerting. Detail in §17.

---

## 2. Project Mission

- **Problem being solved:** communicate NBA playoff forecasts with visible assumptions, honest uncertainty, and validation discipline — explicitly *not* a betting product. **[Confirmed-doc+impl]** (README, AGENTS.md, methodology page, and repeated in-UI caveats all agree; the code enforces the separation — see below.)
- **Intended users:** portfolio reviewers, hiring managers, analytics-minded NBA fans. **[Confirmed-doc]** (`src/app/case-study/page.tsx` says "for portfolio review, internship applications, and analytics discussions".)
- **Sports domain:** NBA playoffs only; currently the 2026 postseason (a fictional-to-this-repo bracket: DET/NYK/CLE/PHI East, OKC/SAS/MIN/LAL West, SAS–NYK Finals). Historical scope: 2016–2025 playoffs for backtesting. **[Confirmed-impl]**
- **Core outputs:** per-game win probability, per-series win probability, expected games remaining, reach-conference-finals / reach-Finals / championship probabilities, team strength decomposition, and a published backtest report. **[Confirmed-impl]**
- **Differentiation:** transparency and honesty about limitations, rather than data breadth or model sophistication. The methodology page even publishes the model's *losses* to its own baseline (first-round Brier is worse than Elo-only) — unusual and commendable. **[Confirmed-impl]**
- **Confirmed scope boundaries (enforced in code/config, not just prose):** the live ESPN scoreboard is display-only; `src/lib/model/` imports nothing from `src/lib/live-data/` (verified by import inspection); model math is absent from UI components (verified by grep). **[Confirmed-impl]**
- **Inferred trajectory:** README roadmap + AGENTS.md suggest gradual automation (live-to-manual reconciliation, odds comparison as a *separate* layer, provenance metadata). **[Strong inference]** The repo does **not** support any inference that this will become a betting product; the opposite is stated everywhere.
- **Unresolved product question:** what the site should display now that the 2026 playoffs are over (final retrospective? archive mode? 2027 pre-season state?). **[Unknown — needs owner decision, §19]**

---

## 3. System Overview

### Repository map

| Path | Responsibility | State |
|---|---|---|
| `src/lib/data/playoff-config.ts` | **Source of truth** for teams, players, ratings, injuries, series state; hand-edited TS + regex-edited by refresh script | Working, **stale (2026-06-08)** |
| `src/lib/data/model-settings.ts` | Model weights: player 0.55, netRating 0.25, elo 0.20; HCA 2.2; logistic scale 6.5; 10 000 iterations | Working |
| `src/lib/model/` | Pure model engine: probability, team strength, series & bracket Monte Carlo, config validation | Working, well-tested |
| `src/lib/live-data/` + `src/app/api/live-scoreboard/` | Read-only ESPN scoreboard probe (display only) | Working |
| `src/lib/backtest/` | Pure evaluation functions (Brier, log loss, calibration) + leakage guard | Working |
| `scripts/verify-model.ts` | Invariant suite (`pnpm verify`) — **mixes invariants with snapshot-specific assertions** | Passing, but see P0-2 |
| `scripts/refresh-data.ts` | Daily ESPN → config series-score updater | **Broken silently** (P0-1) |
| `scripts/backtest/` | BBRef scraper, normalizer, backtest runner, evaluator, report generator | Working; input defect (P0-3) |
| `data/historical/{series,games,team-snapshots}/` | Committed normalized JSON, 2016–2025 | Internally consistent (audited) |
| `data/historical/raw/` | BBRef HTML cache — **gitignored, absent locally** | Reproducibility gap |
| `docs/backtest/` | `methodology.md`, `results.json`, `predictions.json` (generated) | Consistent with each other (verified) |
| `src/components/forecast/`, `src/components/layout/`, `src/app/` | Dashboard, methodology, case-study pages | Working |
| `.github/workflows/refresh-data.yml` | Daily 17:00 UTC cron → refresh script → verify → PR | Runs daily, silently useless |
| `design-reference/` | Static design export (reference only, not built) | Inert |
| `AGENTS.md` / `CLAUDE.md` | Agent working rules; CLAUDE.md defers to AGENTS.md | Accurate (spot-checked) |

### Architecture and data flow

```mermaid
flowchart LR
  subgraph Manual["Manual inputs (human)"]
    PC[playoff-config.ts<br/>teams · players · ratings ·<br/>injuries · series state]
    MS[model-settings.ts<br/>weights · HCA · scale]
  end
  subgraph Engine["src/lib/model (pure TS)"]
    TS2[teamStrength] --> EM[expectedMargin] --> LP[logistic → P(win game)]
    LP --> SS[series Monte Carlo<br/>seeded RNG] --> BS[bracket Monte Carlo]
  end
  subgraph UI["Next.js UI (client)"]
    FD[ForecastDashboard<br/>useMemo → buildForecastSnapshot]
  end
  subgraph Live["Display-only live layer"]
    ESPN[(ESPN scoreboard API)] --> Route["/api/live-scoreboard"] --> Panel[LiveDataPanel]
  end
  subgraph Ops["Daily refresh (broken)"]
    Cron[GH Action 17:00 UTC] --> RD[refresh-data.ts] -->|regex edit| PC
    RD -->|PR, human merges| PC
  end
  PC --> Engine
  MS --> Engine
  Engine --> FD
  ESPN -. reference only .-> RD
```

- **Runtime:** Next.js 16.1.5 (App Router, Turbopack), React 19, TypeScript 5.9 strict, Tailwind 4, pnpm 10. **[Confirmed-impl]** Four routes: `/` (static), `/methodology` (static), `/case-study` (static), `/api/live-scoreboard` (dynamic). Build verified.
- **Storage:** none. All state is TypeScript/JSON files in the repo. No database, no auth, no user data. **[Confirmed-impl]**
- **Deployment:** Vercel at https://548-sable.vercel.app (HTTP 200; serving the 2026-06-08 snapshot — verified by curl). Deploy mechanism (`vercel --prod` vs git integration) is **[Unknown]**; the workflow comments hedge on this too.
- **All simulation runs client-side** in `useMemo` — every slider change re-runs ~16 series × 10 000 sims plus the bracket sim in the browser. Works, but is a perf consideration (§10).

---

## 4. Domain Model

Types in `src/lib/model/types.ts` (live) and `src/lib/backtest/types.ts` (historical).

- **Team:** id, name, abbreviation, conference, seed, eloRating, netRating, manualAdjustment, players. No season field (single-season config), no team record, no venue. **[Confirmed-impl]**
- **Player:** id (positional: `"nyk-3"`), name, impact (subjective points-scale), projectedMinutes, injuryStatus ∈ {healthy, questionable, limited, out}. Identity is name+position-in-array; **no stable player IDs** — fine for the manual config, but nothing links a live player to a historical BPM record.
- **Series:** teamA/teamB ids, winsA/winsB, 7-slot `homePattern` (array of team ids per game slot), round, conference, bracketOrder. Completed games are *not* stored in the live config — only the aggregate score (game-level history lives only in prose notes).
- **Bracket-shape workaround [Confirmed-impl]:** the first round is represented by four **self-play placeholder series** per conference (`teamA === teamB`, 4-0) so the bracket simulator's structural completeness check passes mid-playoffs; PHI and LAL are retained as "inactive eliminated placeholder" teams with near-empty rosters. This is documented in `playoffConfig.notes` and handled correctly by the simulator (a 4-0 series simulates zero remaining games), but it is a hack a new maintainer must know about: `activeRealSeries()` in the refresh script and several UI filters rely on `teamA !== teamB` / `wins < 4` conventions.
- **Historical model** is richer and cleaner: `HistoricalSeries` (seeds, winner, dates, per-game homePattern, `bubble` flag), `HistoricalGame` (scores, winner, gameNumber), `TeamSeasonSnapshot` (ratings + top-10 players + provenance literals `eloSource: "srs_proxy"`, `playerImpactSource: "bpm_proxy"`, `snapshot_as_of`). **[Confirmed-impl]**
- **Correctly handled:** playoff/regular-season separation (snapshots are regular-season only); 2020 bubble (flagged, HCA zeroed in backtest); overtime (irrelevant — only W/L is modeled); traded players (BBRef `TOT`/`2TM` rows dropped, last team row kept); series termination at 4 wins (enforced + verified).
- **Known limitations [Confirmed-impl]:**
  - Home court in simulated future rounds is assigned by **seed**, not regular-season record (`bySeedThenStrength` in `bracket-simulator.ts:43`); the NBA assigns it by record. Usually identical, occasionally wrong. The Team type has no record field, so this is structural.
  - Historical seeds are **inferred** (`inferSeedMap`, `scrape-bbref.ts:192`) by sorting first-round home-court teams by W-L (no real NBA tiebreakers), with opponents assigned `9 − homeSeed`. Spot-checked correct for 2024 including the play-in (LAL 7, NOP 8), but tied-record seasons are a risk. **[Strong inference of residual risk; no wrong seed actually found]**
  - No injuries in historical snapshots (all players "healthy") — documented limitation, biases the backtest's player layer.
  - `historicalSeriesToModelSeries` (`baselines.ts:28`) maps "NBA Finals" → round "Conference Final" and conference "Finals" → "East". Harmless today because the simulator ignores those fields, but a trap if round-aware logic is ever added.

---

## 5. Data Pipeline

There are three distinct pipelines. Keep them separate in your head:

### 5a. Manual forecast config (primary product input)
Human edits `playoff-config.ts` → `pnpm verify` → commit → deploy. Provenance is prose comments and `playoffConfig.notes`. Timestamps: `dataLastUpdated`, `dataLastUpdatedTimestamp` ("PT" strings). **[Confirmed-impl]**

### 5b. Daily automated series-score refresh — **was silently broken; fixed 2026-07-12 (§0.2–0.4)**
`.github/workflows/refresh-data.yml` (17:00 UTC cron) → `scripts/refresh-data.ts`:
1. Filters "active real series" (`teamA !== teamB`, neither at 4 wins).
2. Parses `dataLastUpdatedTimestamp` as PT = UTC−7 (hardcoded PDT).
3. Fetches ESPN scoreboard for every day from snapshot date to now.
4. Matches final games to series **by team-abbreviation pair** and counts wins.
5. Regex-rewrites `winsA`/`winsB` and the timestamp constants in the TS source.
6. Workflow then runs `pnpm verify` and opens a PR (`peter-evans/create-pull-request@v6`, branch `data-refresh/auto`) for human review.

Three independent defects were found here (full detail §15), **all fixed 2026-07-12 (§0.2–0.4)**: the ESPN abbreviation mismatch (NY/SA vs NYK/SAS) meant step 4 matched zero Finals games since June 9 — 30+ consecutive "successful" no-op runs verified in Actions logs; the hard-coded Finals score assertions in the verifier would have failed the workflow the moment step 5 ever produced a real change; and step 5 wrote a fabricated future timestamp ("11:00 PM PT" for a 10:00 AM PT run) that would have permanently excluded that evening's games from all later runs. There was also a byte-level regex mismatch (em-dash vs hyphen) that silently no-op'd the header-comment update. The fixes are covered by regression fixtures in `scripts/verify/refresh-checks.ts`, including the exact NY/SA Finals scenario.

Failure behavior: per-date fetch errors are caught and logged as warnings; zero matches is indistinguishable from "no games played." No retries, no alerting, no staleness check. Idempotency: re-runs are safe in principle (wins capped at 4, only counts games after snapshot) but the timestamp bug breaks the "only counts once" guarantee in the other direction (games never counted).

### 5c. Historical backtest pipeline (one-shot, reproducible)
```
BBRef HTML (4 pages × 10 seasons, cached to data/historical/raw/ — gitignored)
  → scrape-bbref.ts parsers (cheerio; commented-table extraction; strict row counts:
    15 series/season, 30 team ratings/season — parse failures throw)
  → build-snapshots.ts normalizers + validators (wins==games, 4-win winner,
    homePattern length, netRating plausibility, snapshot_as_of < seriesStartDate;
    anomalies throw)
  → committed JSON: series/, games/, team-snapshots/ per season
  → run-backtest.ts: 150 series × 6 models → assertNoLeakage → predictions.json
  → evaluate.ts / report.ts → results.json + methodology.md
```
**Audited during this handover [Confirmed-impl]:** all 150 series and 834 games are internally consistent (wins reconcile with game records, homePattern matches actual game home teams in date order, no leakage violations, elo/netRating formulas match stored raw values); all published metrics recompute exactly from `predictions.json`; two sampled `playoff_pulse` predictions recompute bit-identically from the committed snapshots (seeded RNG works as designed). The **one input defect** is the minutes heuristic (P0-3, §7).

**Replay capability:** predictions → metrics → report is fully reproducible from committed JSON. Raw HTML → JSON is **not** currently replayable (cache absent, BBRef pages may have drifted or be rate-limited). Provenance chain is broken at exactly one stage: raw source snapshots.

---

## 6. Data Lineage and Provenance

Can the system answer "where did this number come from?"

| Question | Live forecast | Backtest |
|---|---|---|
| Which source record produced it? | Prose comments/notes only ("re-checked against NBA.com Game 2 notes") — no structured provenance | Yes: snapshot carries srs/ortg/drtg/wins/losses + `eloSource`/`playerImpactSource` literals |
| Which formula generated it? | Yes — single implementation in `src/lib/model/probability.ts`, documented on `/methodology` | Same engine, same answer |
| Which version of logic? | Git history (no runtime version stamp) | `results.json` has `generatedAt` but no code version/commit hash |
| When last refreshed? | Yes — `dataLastUpdatedTimestamp`, shown prominently in UI | `generatedAt` |
| Reproducible from raw inputs? | N/A (inputs are subjective) | Metrics: yes, exactly. Raw HTML → JSON: **no** (cache gitignored) |
| Correctable without editing final outputs? | Yes (edit config, model re-derives) | Yes (fix parser, re-run) — but requires re-fetching BBRef |

Lineage is **lost** at: (a) raw BBRef HTML (not retained); (b) manual ratings/impacts (inherently subjective — the repo is honest about this); (c) the report generator does not record the code commit that produced `predictions.json`.

---

## 7. Analytics and Metrics (formula dictionary)

Canonical implementation: `src/lib/model/probability.ts`. All stated definitions on `/methodology` **match the implementation** (verified line-by-line). All outputs are computed dynamically (nothing derived is stored except the backtest artifacts).

| Metric | Formula | Grain | Location | Validation status |
|---|---|---|---|---|
| Player-minute impact | Σ over non-out players of `impact × projectedMinutes × availabilityMult` ÷ 240; mult: healthy 1, questionable 0.75, limited 0.6, out 0 | team | `probability.ts:22` | Verified by `pnpm verify` invariants |
| Elo point value | `(elo − 1500) / 35` | team | `probability.ts:35` | Round-trips exactly with backtest's `1500 + srs×35` |
| Team strength | `0.55·playerImpact + 0.25·netRating + 0.20·eloPoints + manualAdj` | team | `probability.ts:39` | Weights sum to 1.0; validated in `validation.ts:126` |
| Expected margin | `strengthA − strengthB ± 2.2` (home team) | game | `probability.ts:48` | Verified |
| Game win prob | `1 / (1 + e^(−margin/6.5))`, clamped [0,1]; non-finite → 0.5 | game | `probability.ts:67` | Verified incl. ±∞ bounds; methodology's "+6.5 ≈ 73%, +13 ≈ 88%" is arithmetically correct |
| Series win prob | Monte Carlo from current score, seeded FNV-1a → mulberry32-style RNG; seed includes full inputs → deterministic | series | `simulator.ts:146` | Terminates at 4 wins (verified); 3-0 lead check verified |
| Expected games remaining | mean simulated remaining games | series | `simulator.ts:199` | Label in UI ("Games left") matches semantics |
| Bracket probabilities | per-iteration conference resolution; unconfigured future rounds generated from winners, 2-2-1-1-1 pattern, higher seed home; configured Finals score respected | team×stage | `bracket-simulator.ts:315` | Title probs sum ≈ 1 (verified); CF-reach sum sanity-checked with runtime throw |
| Implied probability (odds) | `|ml|/(|ml|+100)` or `100/(ml+100)` | odds record | `market.ts:3` | Correct formula; **unused** (marketOdds is empty; vig-removal not implemented — fine since inactive) |
| Brier / log loss / accuracy / calibration | standard; log loss clamps p to [1e-7, 1−1e-7]; accuracy gives half credit at exactly 0.5 (documented) | prediction set | `src/lib/backtest/metrics.ts` | **Recomputed independently — matches published values exactly** |

Common sports-analytics error checklist (Phase-5 sweep): no division-by-zero paths found (240 constant, simulationCount ≥ 1 enforced); no rounding-before-computation (UI formats at display only, 1 dp per AGENTS rule); no double-counted games (game↔series reconciliation verified); no playoff/regular-season mixing (verified); no missing-treated-as-zero in the live path (placeholders excluded via injuryStatus/minutes). Findings that *did* survive scrutiny:

1. **Backtest minutes heuristic (P0-3) [Confirmed-impl] [FIXED 2026-07-12, §0.5]:** `scrape-bbref.ts:451` — `mpg: minutes > 48 ? minutes / gamesPlayed : minutes`. BBRef's advanced table MP is *always total minutes*; for players with ≤ 48 total minutes and ≥ 10 games the heuristic misreads totals as per-game. The audit flagged seven players with mpg > 44 across six team-seasons (Davon Reed IND'19, Antonius Cleveland DAL'20, Vlatko Čančar DEN'20, Ty-Shon Alexander PHO'21, Hunter Tyson DEN'24, DaQuan Jeffries + Ryan Arcidiacono NYK'24). Each landed at the **top of the roster minutes sort** with projectedMinutes 40 and strongly negative BPM (−4.8 to −10.1), and crowded a real rotation player out of the top-10. Quantified impact on `playerMinuteWeightedImpact`: −0.80 to −1.68 points; ×0.55 weight → −0.44 to −0.93 margin points per team (NYK'24 doubly hit: ≈ −1.6 margin points ≈ ~6 pp of game win probability at scale 6.5). Concrete downstream artifact: the model priced 2-seed NYK at **43.5%** vs 7-seed PHI in the 2024 first round. *Post-fix rebuild showed the true blast radius was larger: players with smaller mistotaled minutes (below the 44-MPG alarm) had quietly cracked top-10 rosters too — **21 team-seasons, 22 players** were corrected (§0.5, §0.7).*
2. **Truncated home patterns (P1) [Confirmed-impl] [FIXED 2026-07-12, §0.6]:** historical `homePattern` covers only games actually played (116/150 series shorter than 7). The backtest simulated every series from 0-0, and slots beyond the pattern fell back to **neutral court** (`simulator.ts:123`). This understated home-court advantage in late games of short series and injected a weak outcome-correlated artifact (realized series length shaped the simulated venue schedule). Fixed by `fullHomePattern` in `baselines.ts`, which reconstructs the 7-slot 2-2-1-1-1 pattern from the Game 1 host and asserts it against every played game (all 150 series conform). The stored data still records only played games — reconstruction happens at prediction time, keeping the data factual.
3. **Baseline redundancy (P2):** `home_team` and `higher_seed` are both a flat 0.65 for the higher seed except in the 2020 bubble (15 series). Effectively four baselines, not five. The honest headline comparison is vs `elo_only`, where the edge (0.0013 Brier) is well within noise for n=150 — and finding #1 sits directly on that margin.

---

## 8. Predictive Models and Simulations

- **Target:** P(higher seed wins a best-of-7 series), evaluated per series. Unit: series (n=150). **[Confirmed-impl]**
- **Features at prediction time:** regular-season SRS (as Elo proxy), ORtg−DRtg, top-10 players' BPM × capped MPG, seed, actual home-court assignment. All regular-season-only; `snapshot_as_of` = configured last day of regular season; enforced strictly before series start by `assertNoLeakage` (`src/lib/backtest/leakage-check.ts`) *and* re-verified independently in this audit across all 300 team-series pairs — zero violations. **[Confirmed-impl]**
- **No training occurred.** Weights (0.55/0.25/0.20), HCA 2.2, and scale 6.5 were set by judgment *before* the backtest and deliberately not retuned ("documented here rather than tuned against" — methodology page). This means the backtest is a clean out-of-sample evaluation of a hand-specified model, with no train/test split needed. **[Confirmed-doc+impl]**
- **Evaluation:** Brier, log loss, accuracy (0.5-half-credit rule documented), 10-bucket calibration, by-season/by-round/bubble breakdowns, vs 5 baselines. Published results at audit time (recomputed and confirmed): playoff_pulse 0.1926 Brier / 70.7% acc; elo_only 0.1939; net_rating_only 0.1948; higher_seed 0.2125; home_team 0.2152; coinflip 0.25. **Post-remediation (2026-07-12, corrected inputs + full home patterns):** playoff_pulse **0.1905** / 70.0%; elo_only 0.1926 / 68.7%; net_rating_only 0.1952 / 70.0%; structural baselines unchanged.
- **Honest self-assessment in the methodology page is accurate** (I verified its round-level table and bubble deltas to 4 decimals; re-verified after regeneration): the player layer *hurts* in the first round (+0.0157 Brier vs elo_only post-fix; +0.0184 pre-fix) and helps in later rounds; the model is systematically underconfident in the 0.6–0.8 buckets, consistent with scale 6.5 being too conservative.
- **Leakage risks that remain:** truncated home patterns (§7.2 — mild); seed inference from final standings uses full regular-season records, which is legitimate (known pre-playoffs). No target leakage found. **[Confirmed-impl]**
- **Calibration:** none applied; identified as future work. Reasonable at this sample size.
- **Bookmaker baseline:** absent (consistent with the non-betting stance; a closing-line comparison would still be the strongest scientific benchmark if ever added as analysis-only).

---

## 9. Data-Quality Assessment

Audited programmatically (script in §20):

- **Completeness:** 10 seasons × 15 series = 150 series, 834 games, 160 snapshots, 10 players per snapshot. No missing games or series vs the 4-7-game invariant. ✅
- **Validity:** all scores 60–200 plausible range; no ties; winners consistent with scores; wins ≤ 4. ✅
- **Consistency:** series wins ≡ game-level wins; homePattern ≡ actual game home teams in order; elo/netRating recompute from stored raw fields. ✅
- **Uniqueness:** series ids unique; games keyed by series+number. ✅
- **Accuracy:** champions verified for all 10 seasons against known results (2016 CLE … 2025 OKC). 2024 seeds spot-verified including play-in outcomes. ⚠️ except the poisoned snapshots (§7.1) — *field-level* accuracy failure in `mpg`/`projectedMinutes`. **[FIXED 2026-07-12]** — snapshots rebuilt; re-audit found zero implausible values and a new validator guards the invariant.
- **Timeliness:** historical data static (fine). **Live config: 34 days stale and factually wrong** (§1). ❌
- **Provenance:** good for backtest (raw fields + source literals), prose-only for manual config, missing raw HTML. ⚠️
- **Proposed hard invariants** (all currently hold): winner has exactly 4 wins; winsA+winsB = gamesPlayed = homePattern length = game-record count; snapshot_as_of < seriesStartDate; per-player `mpg ≤ 44` **(added 2026-07-12 to `validateSnapshots` — would have caught P0-3)**; total roster projected minutes within [150, 400]; NBA Finals teams from opposite conferences; title probabilities sum to 1 ± 0.01.
- **Source-dependent checks:** ESPN abbreviation ↔ config abbreviation mapping must be validated per team (**failed silently** — the root cause of P0-1); BBRef 15-series and 30-team row counts (already enforced, good).

---

## 10. Frontend and User Experience

Pages: `/` (dashboard), `/methodology`, `/case-study`; shared `Header`. **[Confirmed-impl]**

Strengths: caveats are pervasive and honest (manual-data pills, "not betting advice," sample-size warnings, per-bucket n published); probability bars are 0-based and clamped; one-decimal probability formatting throughout (`format.ts`) per the AGENTS "no fake precision" rule; tables scroll horizontally on mobile; eliminated teams shown as inactive rather than zero; empty/error/loading states exist for the live panel; iteration count displayed next to series probabilities.

Presentation risks:
- **Stale-truth risk (partially addressed 2026-07-12):** the UI presents `dataLastUpdatedTimestamp` faithfully, and now shows a "Playoffs complete" pill and an explanatory empty state when the bracket is finished. But there is still no *staleness* signal during a live postseason (snapshot older than N days → warning) — that remains open (§16 P1-1).
- **Hard-coded analytics in JSX [FIXED 2026-07-12, §0.11]:** `BacktestSummaryCard.tsx` and the methodology sidebar now import the generated `docs/backtest/summary.json` at build time and compute deltas from it, so regenerating the backtest updates the displayed numbers automatically. Residual (accepted): the methodology page's *narrative* paragraphs still contain authored numbers — they carry editorial framing and must be reworded by a human whenever results change.
- Monte Carlo noise (~±0.5–1 pp between distinct input signatures) is only explained on the methodology page, not near the numbers; and 10k-iteration client-side recomputation on every slider tick can jank low-end devices (consider debounce/worker).
- Localization: none; English-only, `lang="en"` (no Cyrillic requirement found anywhere in the repo). Accessibility: icons are `aria-hidden` with text labels, buttons are real buttons; no full a11y audit performed. **[Not fully validated]**

---

## 11. Backend and API

One route: `GET /api/live-scoreboard` (`force-dynamic`). Fetches ESPN (60 s revalidate hint), normalizes defensively (every field type-checked; unknown shapes degrade to nulls/"unknown"), returns typed snapshot with `s-maxage=60, stale-while-revalidate=300`; on failure returns a structured "unavailable" snapshot with `no-store` and HTTP 200. **[Confirmed-impl]**

Assessment: input validation is fine (`date` param sanitized to 8 digits); no auth needed (public data); no rate limiting (a public proxy of ESPN — abuse surface is trivial but nonzero, hardening only). Response metadata is good: source, endpoint, fetchedAt, feedDate, warnings, manual-team match counts. Known limitations: HTTP 200 for the error snapshot (defensible for a status-panel consumer, but unconventional); the `manualTeamMatches` counter suffers the same NY/NYK abbreviation mismatch as the refresh script, so it undercounts on game days (same fix applies).

---

## 12. Infrastructure and Operations

- **Environments:** local dev + Vercel production. No staging. No environment variables in use anywhere (`process.env` appears only for `REFRESH_SUMMARY_PATH` in the refresh script). No secrets in the repo (checked). **[Confirmed-impl]**
- **CI:** **none for code** — no workflow runs verify/build/lint on push or PR. The only workflow is the daily data refresh (which does run `pnpm verify`, ironically making the hard-coded assertions a deployment gate for data but nothing a gate for code).
- **Scheduled job status [Confirmed-impl via `gh run list` / `--log`]:** `refresh-data.yml` has run daily since ~June 3 (2 early failures June 3–4, success since June 5). Every run since June 9: "No new games detected." No `data-refresh` PR has ever been created (`gh pr list --state all` is empty). All June 5–8 config updates were manual commits.
- **Monitoring/alerting:** none. Job success is defined as "script didn't crash," which conceals total functional failure (this happened — 30+ green runs while production is wrong).
- **Recovery/rollback:** git revert of config commits is the mechanism; adequate for this design.
- **Branch topology oddity [Confirmed-impl]:** the default branch is `feature/setup`; `origin/main` diverged after the workflow commit and carries duplicate-content commits with different SHAs (`efc0eff` vs `4eb8872`). Which branch Vercel deploys from is **[Unknown]**. This will eventually bite; consolidate to `main`.

---

## 13. Testing and Validation

Commands run during this audit (all read-only; full transcript in §20):

| Command | Result |
|---|---|
| `corepack pnpm install --frozen-lockfile` | ✅ 6.1 s |
| `corepack pnpm verify` | ✅ "Model verification passed." |
| `corepack pnpm build` | ✅ compiles; 5 routes |
| `corepack pnpm lint` | ✅ 0 errors, 3 warnings (unused `_series`/`_game1HomeTeam` vars) |
| `tsx scripts/backtest/test-2024.ts` | ✅ 2024 sanity checks pass |
| Custom data audit (150 series / 834 games / 160 snapshots) | ✅ consistent except 7 implausible-MPG players |
| Independent metric recomputation from `predictions.json` | ✅ matches `results.json` and methodology page exactly |
| Bit-level reproduction of sampled backtest predictions from snapshots | ✅ identical to stored |
| Not run: `refresh-data` (writes files), scrapers (external writes), `run-backtest` (would overwrite predictions.json) | — |

Coverage assessment: `verify-model.ts` is a strong invariant suite for the *model engine* (bounds, monotonicity, termination, seeding, bracket sums, coverage warnings, scoreboard normalization fixtures). Critical gaps found at audit time, with 2026-07-12 status:
- **No tests at all for `scripts/refresh-data.ts`** — **[FIXED]**: `scripts/verify/refresh-checks.ts` now covers the NY/SA abbreviation scenario, snapshot-timestamp honesty and round-tripping (including midnight/noon edge cases), stale-game exclusion, and win capping. Regex round-trip tests for `applyUpdates` remain open.
- **Verifier conflates invariants with data assertions** — **[FIXED]**: split into `verify/invariants.ts`, `verify/refresh-checks.ts`, and `verify/data-snapshot.ts`; the refresh workflow runs only the first two.
- No test framework (bare `assert` scripts — unchanged); snapshot-poisoning guard **[FIXED]** (`mpg > 44` and `projectedMinutes > 40` anomalies in `validateSnapshots`); ESPN alias mapping now asserted in both `verify/invariants.ts` (normalizer level) and `verify/refresh-checks.ts` (matcher level).

Post-remediation validation (2026-07-12): `pnpm verify` / `verify:invariants` / `verify:refresh` / `verify:data` all pass; `pnpm build` passes; `pnpm lint` passes with the same 3 pre-existing warnings; `test-2024.ts` passes against the rebuilt data; the independent §9 data audit passes with zero implausible-minutes players; all regenerated metrics recompute exactly from `predictions.json`; `pnpm refresh-data` smoke-tested (0 active series, exits cleanly, touches nothing).

---

## 14. Security Assessment

No confirmed vulnerabilities. Findings, honestly graded:

- **Confirmed non-issues:** no secrets committed (searched); no user data collected; no auth to get wrong; API input sanitized; TypeScript strict; deps minimal and current (Next 16.1.5, React 19.2.4).
- **Hardening opportunities:** workflow grants `contents: write` + `pull-requests: write` (required for the PR flow; standard, but a compromised action could push — `peter-evans/create-pull-request` is pinned to `@v6` tag, not a SHA); `/api/live-scoreboard` is an unauthenticated proxy with no rate limit; `pnpm audit` not run in CI (no CI).
- **Compliance note (unverified concern):** BBRef scraping for the backtest — the scraper is polite (2 s delay, honest UA, cached) but BBRef's ToS restricts automated scraping; raw HTML is deliberately not committed. Acceptable for one-shot research use; re-fetching at scale may be blocked or disallowed. **[Unknown — legal question, not a code question]**

---

## 15. Known Issues and Technical Debt

**Confirmed defects (all verified this audit; items 1–6 FIXED 2026-07-12, see §0):**
1. **P0-1 — ESPN↔config abbreviation mismatch silently defeats the daily refresh.** ESPN scoreboard returns `NY`/`SA` (and generally `GS`, `NO`, `UTAH`, `PHX` variants for other franchises); config uses `NYK`/`SAS`. `computeUpdate` (`scripts/refresh-data.ts:227-238`) matches by abbreviation pair → zero matches → "No new games detected" → workflow green. Production has shown a finished Finals as live 2-1 for 34 days. Evidence: Actions logs (June 12 run retrieved Game 4 but ignored it; July 12 run: 34 days fetched, 2 games retrieved, none matched), direct ESPN probes showing Game 4 (NY 107–106 SA) and Game 5 (NY 94–90 @ SA, June 13 → **NYK won the title 4-1**), prod curl showing the June 8 snapshot.
2. **P0-2 — Self-blocking automation.** `verify-model.ts:283-297` asserts the exact current Finals score (`winsA === 1 && winsB === 2`) and Game-4-in-NY. The refresh workflow runs `pnpm verify` *after* rewriting the score, so any genuine update fails the workflow before the PR step. The pipeline can only ever succeed by changing nothing.
3. **P0-3 — Backtest snapshot poisoning** via the total-vs-per-game minutes heuristic (`scrape-bbref.ts:451`); six team-seasons corrupted, up to −1.6 margin points; published headline margin over elo_only (0.0013 Brier) is smaller than the plausible effect of the fix. Details §7.1.
4. **P0-4 (latent) — Fabricated refresh timestamp.** `refresh-data.ts:430` stamps `"${refreshDate} 11:00 PM PT"` for a run that executes at ~10:00 AM PT. After any merged refresh, games starting before 11 PM PT that same day (i.e., essentially all NBA games) are `<= snapshotUtc` and permanently skipped by subsequent runs. Never fired only because defects 1–2 prevented any merge.
5. **P1 — em-dash/hyphen regex mismatch** (`refresh-data.ts:282` uses `—`, `playoff-config.ts:1` uses `-`, byte-verified): header "Last updated" comment silently never updates, and unlike the series regexes this no-op doesn't throw.
6. **P1 — truncated historical homePattern → neutral-court late games** in 116/150 backtested series (§7.2).

**Likely defects / risks:** seed inference without NBA tiebreakers (§4); `PT_OFFSET_HOURS = -7` wrong outside PDT (documented but unguarded); ESPN feed structure drift ungoverned.

**Incomplete features / placeholders:** market odds (types + conversion function exist, `marketOdds: []`, explicitly labeled placeholder); live-to-manual reconciliation (deliberately absent); PHI/LAL placeholder teams and self-play first-round series (deliberate workaround, documented in config notes).

**Architectural debt:** series state stored inside a TypeScript source file and machine-edited by regex (the root enabler of defects 4–5 — move to JSON); default branch named `feature/setup` with a divergent `main`; backtest numbers duplicated into JSX; no CI.

**Analytical debt:** logistic scale uncalibrated (documented underconfidence); redundant baseline pair; no uncertainty intervals on displayed probabilities beyond prose.

**Documentation debt:** README still lists backtesting under "Future Roadmap" though it shipped; README's "Live Demo: TODO" though AGENTS.md has the URL; `PLAN.md` contains factual errors about 2024 seeds (harmless — the data itself is right).

---

## 16. Prioritized Improvement Plan

### P0 — Immediate blockers — **all five completed 2026-07-12 (§0); remaining step: commit + deploy**

| # | Problem | Action taken | Status | Validation performed |
|---|---|---|---|---|
| 1 | Production shows factually wrong, month-stale Finals state | Config updated to true final state (NYK champion 4-1, verified vs ESPN); "Playoffs complete" pill + empty state added | ✅ Fixed in working tree; **deploy pending** | `verify:data` asserts the completed state; build passes |
| 2 | Refresh matches games by raw ESPN abbreviation | `espn-abbreviations.ts` alias map applied on both sides of every comparison; one-team-match warning added to console + PR summary | ✅ Fixed | `verify:refresh` replays the exact NY/SA June scenario → wins 1-4 |
| 3 | Verifier hard-codes series state, blocking any refresh PR | Verifier split three ways; workflow runs invariants + refresh checks only | ✅ Fixed | All four verify entry points pass; workflow step updated |
| 4 | Fabricated "11:00 PM PT" snapshot timestamp drops same-day games | Actual run moment stamped (`ptSnapshotStamp`); em-dash regex fixed; header no-op warns; `main()` import-guarded | ✅ Fixed | `verify:refresh` round-trips the stamp and forbids future-dating |
| 5 | Published backtest built on poisoned snapshots (rebuild revealed 21 team-seasons, not 6) | `mpg = minutes / gamesPlayed` unconditionally; `mpg > 44` validator; BBRef re-fetched (3.5 s delay); snapshots rebuilt; backtest + report regenerated; UI numbers re-synced with a public correction note | ✅ Fixed | Validators pass; independent recomputation matches; Brier 0.1926 → 0.1905, edge over elo_only widened |

### P1 — Production readiness

| # | Problem | Action | Effort | Status |
|---|---|---|---|---|
| 1 | Silent staleness | Freshness check in workflow (fail/notify if snapshot older than N days during an active postseason) + staleness banner in UI | S | ✅ Done 2026-07-12 (§0.10) |
| 2 | No CI | GitHub Action: install, lint, verify, build on push/PR | S | ✅ Done 2026-07-12 (§0.9) |
| 3 | Regex-editing TS source | Move series state (and ideally team/player data) to JSON imported by config; refresh edits JSON with schema validation; make *all* replacement no-ops throw | M | Open (header no-op now warns; series-score no-ops already threw) |
| 4 | Truncated homePattern in backtest | Reconstruct 7-slot 2-2-1-1-1 pattern from Game 1 host; regenerate | S–M | ✅ Done 2026-07-12 (§0.6) |
| 5 | No tests for refresh-data | Extract pure functions; add fixture tests: abbreviation map, timestamp parsing incl. non-PDT dates, regex round-trip, win capping | M | Mostly done 2026-07-12 (`verify/refresh-checks.ts`); regex round-trip + non-PDT parsing tests still open |
| 6 | Raw-source reproducibility | Archive raw HTML (private storage or committed compressed) or document irreversibility and pin the normalized JSON as canonical | S–M | Open — note the raw cache is currently re-populated locally from the 2026-07-12 re-fetch (still gitignored) |
| 7 | Branch topology | Make `main` the default; retire `feature/setup`; confirm Vercel target | S | Open |

### P2 — High-value analytical/product improvements

1. UI reads backtest numbers from a generated artifact at build time (kills drift). — S — ✅ Done 2026-07-12 via `summary.json` (§0.11); narrative prose intentionally remains authored
2. Leave-one-season-out calibration of `logisticScale` (+ report both raw and calibrated). — M
3. Replace redundant `home_team` baseline with a fitted logistic-on-SRS-diff baseline. — S
4. Seed-inference hardening: cross-check inferred seeds against a known-seeds table per season. — S
5. Monte Carlo SE displayed next to probabilities; debounce/worker for client sims. — S–M
6. Auto-generate next-round series entries when a series completes (still PR-gated). — M
7. Provenance metadata objects for manual inputs (source, date, author) instead of prose. — M

### P3 — Longer-term

Historical injury data for a fairer player-layer backtest; market-odds comparison layer (analysis-only, per project stance); scenario save/export; possession-level or lineup analytics (premature at current data volume — do not start before P0/P1 complete); multi-season product framing (2027 playoffs onboarding path).

**Do not** reorder speculative analytics above the P0 data-integrity items; the project's credibility claim is honesty, and right now the deployed page is unintentionally dishonest.

---

## 17. Recommended Next 30 Days

Most of the original 30-day plan was completed during the 2026-07-12
remediation passes (§0): statistical corrections, pipeline fixes, verifier
split, CI, freshness alerting, and the summary.json UI wiring. What remains:

1. **Now:** confirm the deployed site reflects the completed Finals; confirm the first CI run and a manually triggered refresh run are green; archive the raw BBRef HTML while the local cache exists and commit its checksum manifest (§19.4).
2. **Week 1–2 — remaining pipeline hardening:** JSON migration for series state (retires the regex editing); regex round-trip and non-PDT timestamp tests; seed cross-check table; decide whether the daily cron pauses for the off-season (§19.2).
3. **Week 3–4 — analytics & product:** calibration experiment (leave-one-season-out on `logisticScale`, publish raw vs calibrated); Monte Carlo SE display; decide off-season presentation beyond the completed-state view (§19.1); provenance metadata design.

---

## 18. New Maintainer Guide

**Setup:** Node ≥ 20 (Node 24 in CI), `corepack enable`, `corepack pnpm install --frozen-lockfile`. No env vars, no database, no external accounts needed to run everything except the BBRef scraper.

**Commands:**
- `corepack pnpm dev` / `build` / `start` — Next.js app.
- `corepack pnpm verify` — full verification: invariants + refresh regression checks + current-snapshot assertions.
- `corepack pnpm verify:invariants` — generic model invariants only (what the refresh workflow runs).
- `corepack pnpm verify:refresh` — refresh-script regression fixtures (ESPN aliases, timestamp honesty, win capping).
- `corepack pnpm verify:data` — current-snapshot assertions; update `scripts/verify/data-snapshot.ts` in the same commit as any manual data change.
- `corepack pnpm lint` — ESLint.
- `corepack pnpm refresh-data` — ⚠️ **writes** to `src/lib/data/playoff-config.ts` and `refresh-summary.md`. With the 2026 bracket complete it exits early ("0 active series"), but treat as mutating.
- `tsx scripts/backtest/test-2024.ts` — data sanity test (read-only).
- `tsx scripts/backtest/run-backtest.ts` — ⚠️ overwrites `docs/backtest/predictions.json`.
- `tsx scripts/backtest/report.ts` — ⚠️ overwrites `docs/backtest/{results.json,methodology.md}`.
- `tsx scripts/backtest/build-snapshots.ts` — ⚠️ fetches BBRef (rate-limited, ToS-sensitive) and overwrites `data/historical/**`.

**Important files:** start with `AGENTS.md` (accurate; its hard rules — probabilities bounded, seeded RNG, scoreboard never feeds the model, no math in UI — are all genuinely enforced in code). Then `src/lib/model/probability.ts` (all formulas), `src/lib/data/playoff-config.ts` (all state), `scripts/verify-model.ts` (what "correct" means here), `docs/backtest/methodology.md` (analytical posture).

**Dangerous operations:** editing `playoff-config.ts` by hand (update `scripts/verify/data-snapshot.ts` in the same commit — this coupling is by design); running any backtest writer (regenerates published artifacts — remember to re-sync the UI's hard-coded numbers until P2-1 lands); merging a `data-refresh/auto` PR without reading the diff (regex edits).

**Safe first tasks:** regex round-trip tests for `applyUpdates`; the raw-HTML archive manifest (§19.4); the JSON migration for series state; the calibration experiment.

**Conventions:** TypeScript strict everywhere; model layer must stay pure (no React, no live-data imports — enforced by review, not tooling; consider an ESLint import rule); one-decimal probability display; every new model output needs a verify-script invariant (AGENTS.md rule, followed in practice).

---

## 19. Open Questions (need the owner, not the repo)

1. **Off-season product state.** The dashboard now truthfully shows the completed bracket (NYK champions, "Playoffs complete" pill, empty-state copy — added 2026-07-12). Still open: whether to go further — a "how the model did in 2026" retrospective (the manual-input season is a natural forward-test), an archive mode, or a 2027 pre-season state. Determines the next month of product work.
2. **Is the automated refresh worth keeping for 2027?** Its three defects are fixed and regression-tested (2026-07-12), and with no active series it now no-ops cleanly. Remaining decision: keep the daily cron running through the off-season (harmless but noisy in Actions history), pause the schedule until the 2027 playoffs, or retire it in favor of manual updates. Unmaintained automation is how the June failure happened — whoever keeps it should also add the P1-1 freshness alert.
3. **Which branch/deploy topology is intended?** `feature/setup` as default with a divergent `main` and an unknown Vercel linkage. Needs a decision and cleanup. The remediation work sits uncommitted on `feature/setup`.
4. **BBRef data policy.** The 2026-07-12 re-fetch of all 40 pages succeeded politely (3.5 s delay) and the raw HTML cache is populated locally but still gitignored. Decide now, while it exists: archive it (committed compressed or private storage) for reproducibility, or declare the normalized JSON canonical and accept that raw provenance is transient.
5. **README public URL** — "Live Demo: TODO" vs the working URL in AGENTS.md; is the URL meant to be public?

---

## 20. Evidence Appendix

**Commands run (all read-only w.r.t. the repo; `pnpm install` created `node_modules` only):**
- `corepack pnpm install --frozen-lockfile` → ✅
- `corepack pnpm verify` → ✅ "Model verification passed."
- `corepack pnpm build` → ✅ (Next 16.1.5, 5 routes)
- `corepack pnpm lint` → ✅ 0 errors / 3 warnings
- `tsx scripts/backtest/test-2024.ts` → ✅
- Custom audit script (scratchpad, not committed): validated all 150 series, 834 games, 160 snapshots; recomputed Brier/log-loss/accuracy for all 6 models from `predictions.json` → exact match with `results.json` and `methodology.md`; found the 7 implausible-MPG players; verified methodology round-level table (0.147/0.129 first round, −0.034 CSF delta, …) and bubble deltas (+0.030/+0.029/+0.035/+0.011/+0.039) to 4 decimals.
- Reproduction check: `playoffPulsePrediction` recomputed for `2024-east-r1-nyk-phi` (0.4347) and `2020-west-r1-lal-por` (0.7996) → bit-identical to stored predictions.
- Impact quantification: `playerMinuteWeightedImpact` with/without each mis-parsed player (deltas −0.80…−1.68 impact points; NYK'24 combined ≈ −1.6 margin points).
- `git log/branch/ls-remote` → branch topology; no `data-refresh` commits anywhere.
- `gh run list --workflow=refresh-data.yml` → daily runs, all "success" since 2026-06-05 (failures 06-03/06-04).
- `gh run view 29202797452 --log` (2026-07-12) → "34 day(s)… Retrieved 2 game(s)… No new games detected."
- `gh run view 27436627470 --log` (2026-06-12) → "4 day(s)… Retrieved 1 game(s)… No new games detected." (Game 4 had been played June 10.)
- `gh pr list --state all` → no PRs ever.
- `curl` ESPN scoreboard `?dates=20260610` → SA @ NY final, **NY 107–106** (abbreviations `NY`/`SA`); `?dates=20260613` → **NY 94–90 @ SA** → NYK won the Finals 4–1.
- `curl https://548-sable.vercel.app` → HTTP 200, "Last updated 2026-06-08 09:18 PM PT".
- `hexdump` of `playoff-config.ts:1` (hyphen 0x2D) vs `refresh-data.ts:282` (em-dash E2 80 94).

**Key formulas inspected:** `probability.ts` (all), `simulator.ts` (seeding, termination, game numbering), `bracket-simulator.ts` (future-round generation, coverage, sums), `metrics.ts` (all), `leakage-check.ts`, `baselines.ts`, `build-snapshots.ts` (normalizers/validators), `scrape-bbref.ts` (parsers, seed inference, minutes heuristic), `refresh-data.ts` (all).

**Remediation evidence (2026-07-12, appended after the fixes):**
- Pre-implementation scan: all 150 committed series conform to the 2-2-1-1-1 pattern (0 slot deviations) — justified the strict assertion in `fullHomePattern`.
- `tsx scripts/backtest/build-snapshots.ts` → exit 0; all 40 BBRef pages re-fetched; validators (including the new `mpg > 44` check) passed; `data/historical/series/*` and `games/*` byte-identical to committed versions; 9 of 10 snapshot files changed.
- Diff quantification vs `HEAD`: 22 players newly in a top-10 roster across 21 team-seasons (2016 POR; 2017 HOU; 2018 IND, NOP; 2019 DEN, IND, ORL, UTA; 2020 DAL, DEN, LAC; 2021 NYK, PHI, PHO; 2022 ATL, DEN, UTA; 2024 DEN, NYK; 2025 IND, MIN); 0 retained players had mpg changes.
- `tsx scripts/backtest/run-backtest.ts` → 900 predictions; `report.ts` → results.json + methodology.md regenerated; `test-2024.ts` passed.
- Independent recomputation from regenerated `predictions.json`: playoff_pulse 0.1905 / 0.5612 / 70.0%; elo_only 0.1926; net_rating_only 0.1952; higher_seed 0.2125; home_team 0.2152; coinflip 0.2500 — all match `results.json` exactly. Round table: FR +0.0157, CSF −0.0311, CF −0.0124, Finals −0.0087 (pp vs elo_only). Bubble deltas: pp +0.029, elo +0.031, nr +0.034, hs +0.011, ht +0.039.
- Re-run of the §9 data audit on rebuilt snapshots: zero implausible-MPG players; all consistency and leakage checks pass.
- `pnpm verify`, `verify:invariants`, `verify:refresh`, `verify:data` → all pass; `pnpm build` → passes (5 routes); `pnpm lint` → 0 errors, same 3 pre-existing warnings; `pnpm refresh-data` smoke test → "0 active series", no source files touched.
- Regression fixture replays the June failure: ESPN `NY`/`SA` Finals games against the `sas`/`nyk` series now produce wins 1-4; `ptSnapshotStamp(2026-07-12T17:52:12Z)` → "2026-07-12 10:52 AM PT", round-trips through `parseSnapshotTimestamp`, and can never post-date the run.

**Areas not fully inspected / limitations:** `design-reference/` (inert export — skimmed only); `docs/archive/legacy-CLAUDE.md` (read header — archived, superseded); full a11y and cross-browser behavior of the UI (not exercised in a browser); Vercel project configuration (no local `.vercel/`, deploy trigger unknown); GitHub repo settings (branch protection, default-branch rationale); BBRef re-fetch behavior today (deliberately not attempted); `pnpm audit` (not run — no lockfile-vulnerability scan performed); the two failed June 3–4 workflow runs' logs (not pulled — predate the success pattern). Seed correctness was spot-checked for 2024 only; other seasons' seeds rest on the (validated-for-2024) inference logic. No live game data existed during the audit window to exercise the in-progress scoreboard path end-to-end.
