# Live NBA forecast plan (draft for review)

Author: Claude Opus 5.5, 2026-11-01. Status: reviewed by Fable; Phase A and Phase B shipped. **Section 15 is the binding final decision and overrides anything above it where they differ.**

## 1. Goal

The owner's goal: a live prediction for every NBA game on the day, kept up to
date, plus playoff and champion predictions as well as individual games.

Done means all of the following are true on the production site, with no human
in the loop on a normal day:

1. **Today's games.** Every game on the current slate shows a pregame win
   probability for each team, expected margin, tip time, status and score. While
   a game is in progress it also shows an updated in-game estimate. After the
   final it shows the result against the sealed pregame number.
2. **Season forecast.** All 30 teams show current record, rating with
   uncertainty, projected wins with an interval, and the probability of a top-6
   seed, the play-in, the playoffs, each playoff round, the Finals and the title.
3. **Playoff mode.** From the play-in onward the same page uses the real bracket
   and live series scores, and each game shows its series win probability.
4. **Automatic updates.** Forecasts refresh after games finish, and failures stop
   publication and show a visible stale state rather than wrong numbers.
5. **Public record.** Every pregame forecast is sealed before tip in an
   append-only ledger and scored afterward, so this season builds the prospective
   track record the project has never had.

Not in v1: betting features or framing, a player-level model, user accounts or
notifications, other leagues.

## 2. What the current system can and cannot do

Verified in the 2026-10-31 audit and this review (`docs/` and code as cited):

- `playoffConfig` holds 8 teams and frozen 2026 rosters, with no season field.
  The whole product assumes a hand-entered 16-team bracket.
- `src/lib/model/bracket-simulator.ts` needs that bracket. It cannot go from
  standings to seeds, and has no play-in. It cannot be the season simulator.
- Reusable as is: `solveSeriesExactly`, `createSeededRandom`, `metrics.ts`,
  `regression.ts`, and the ESPN normalizer patterns.
- The current baseline failed its own retirement gate (Brier 0.1855 against
  0.1737 for SRS-only over 645 series), and no replacement is named.
- All evaluation data is playoff-only. Regular-season game prediction has no
  evidence at all today. `team-snapshots` covers playoff teams only, so 14 teams
  have no rating for 2025-26.
- The 2027 issuance blockers from the audit (timestamp conflict, challenger input
  mismatch, no scorer, no 2027 config path) all sit on the manual path this plan
  replaces.

## 3. Feasibility evidence gathered

All from read-only probes and a throwaway spike in `/tmp/pp-espn/spike`
(`fetch.mjs`, `eval.mjs`, `data/`). Nothing is in the repo yet.

**ESPN public endpoints** (unofficial, undocumented):

| Need | Endpoint | Finding |
|---|---|---|
| Full schedule and results | `teams/{id}/schedule?season=Y&seasontype=2,3,5` | Works back to at least season 2005. Season range queries on `scoreboard` return HTTP 400 |
| Today's slate, live state | `scoreboard?dates=YYYYMMDD` | Small payload, has `linescores`, and `odds` (DraftKings) on pregame events. `day.date` follows the US evening, not UTC |
| Standings cross-check | `standings?season=Y&level=2` | Has W-L, differential and `playoffSeed` |
| Injury report | `injuries` | 28 teams, each row with status and a timestamp. No history available |
| Team list | `teams` | 30 stable numeric IDs |

Edge cases found in real data:

- 2026-27 currently lists **80 games per team**: 1,200 total, 88 final and 1,112
  remaining. The other 2 per team are NBA Cup knockout slots, scheduled in December.
- The **Cup Championship** is `competition.type = CC`, regular-season type, neutral,
  and does not count toward standings. Past seasons show teams with 83-84 "regular
  season" events because of it. Cup quarterfinals and semifinals do count.
- **Play-in** is `season.type = 5` with descriptive notes. Season 2020's seeding
  games are also labeled type 5 (`WEST PLAY-IN - GAME 1`).
- **Neutral flags are incomplete.** International games are flagged, but the 2020
  bubble games are `neutral: false`, so bubble dates need a hard rule.
- 2020-21 had limited crowds, so home advantage differs.
- Postponed games and makeups appear with notes such as "Makeup from Jan 8".
- `cdn.nba.com` returned HTTP 403 from this machine, so there is **no verified
  second source**. ESPN is a single point of failure.

**Model spike.** Walk-forward over seasons 2023-2026, with 2022 as warm-up:

| Model | Regular season Brier (n=4,920) | Log loss | Accuracy | Oct-Nov Brier | Playoff Brier (n=335) |
|---|---:|---:|---:|---:|---:|
| Always the prior home-win rate | 0.2471 | 0.6874 | 55.6% | 0.2444 | 0.2447 |
| Elo with margin (538 style) | 0.2159 | 0.6217 | 65.7% | 0.2183 | 0.2279 |
| Season-to-date ridge SRS | 0.2156 | 0.6196 | 65.6% | 0.2174 | 0.2307 |
| State-space (Kalman) ratings | 0.2126 | 0.6131 | 66.2% | 0.2115 | 0.2291 |

Kalman reliability by probability bin tracked closely (for example 0.55 predicted
against 0.56 observed and 0.75 against 0.77, with a weak spot at 0.25 against
0.20). Residual margin SD was 13.9, above the 12.2 used in the spike, so `sigma`
was mis-set and is expected to change when fitted.

**Caveats on the spike:** parameters were hand-set and varied on this same window,
and no fit was done. This shows feasibility and is not evidence for a claim.
Seasons 2023-2026 have now informed the choice of model form, so they are not
clean for model selection. Only 2026-27 onward is truly untouched.

**Compute:** 10,000 iterations of 1,150 random draws took 127 ms in Node. Monte
Carlo cost is not a constraint.

## 4. Architecture

```
ESPN ─► GitHub Action, every 30 min (scripts/live/pipeline.ts)
          validate ► update game store ► ratings ► seal today's forecasts
          ► season Monte Carlo ► invariants ► commit data/live/** to main
                                                   │ (Vercel auto-deploys)
                                                   ▼
Browser ◄── /live (static shell, bundled state.json)
        ◄── /api/live/today (bundled sealed forecasts + ESPN scoreboard, cached 30 s)
                 └─ in-game estimate computed by a pure function at request time
```

Separation of concerns:

- **Slow path, in the Action:** ratings, sealed forecasts, season simulation. Only
  finalized, validated results enter it.
- **Fast path, in the route:** live scores and the in-game estimate. Live scores
  never change ratings or sealed numbers.

New modules:

```
src/lib/season/            pure engine: no React, no fetch, no live-data imports
  types.ts params.ts teams.ts ratings.ts game-forecast.ts in-game.ts
  schedule.ts standings.ts simulate.ts ledger.ts
src/lib/live-data/espn-season.ts   fetchers and strict validators
scripts/live/   ingest-history.ts fit-params.ts evaluate.ts pipeline.ts verify-ledger.ts
data/season/games/{season}.json    compact game store
data/live/      state.json  ledger/2026-27.jsonl  snapshots/2026-27/{date}.json
docs/live/      registration.md  evaluation.json
src/app/live/page.tsx   src/app/api/live/today   src/app/api/live/health
src/components/live/*
.github/workflows/live-forecast.yml
tests/season-*.test.ts
```

## 5. Rating and game model

State: a 30-team rating vector with a full covariance matrix, updated game by game
with a Kalman filter. Deterministic, closed-form, and replayable from the game store.

- Observation: `homeMargin = R_home - R_away + HCA*(not neutral) + restAdj + noise`,
  with noise `N(0, sigma^2)`.
- Time update: each team's variance grows by `q` per day.
- Season rollover: `R_new = rho * R_old`, with variance inflated toward `tau^2`.
- Pregame probability:
  `P(home) = Phi( mu / sqrt(sigma^2 + Var(R_home - R_away)) )`. Rating uncertainty
  therefore shrinks early-season forecasts automatically.
- Rest: back-to-back adjustment only in v1.
- Parameters: `sigma, q, rho, tau, HCA, b2b`, plus a playoff layer (`HCA_p`, and a
  spread multiplier only if it improves development-season log loss).

**Fit and freeze.** Development seasons 2005-2015 are used for fitting. Validation
seasons 2016-2026 are scored once with frozen parameters. Parameters, code hash and
dates go in `docs/live/registration.md` before validation runs. Candidates compared
on development seasons: Kalman, Elo-margin, season-to-date SRS. One primary is
chosen by development log loss. Rules: bubble dates treated as neutral, and season
2021 excluded from the HCA fit.

**Why state-space over Elo:** it gives uncertainty directly, which the season
simulator needs, and handled early season best in the spike.

**Known weakness:** off-season roster moves are invisible, so the first weeks rely
on last season's ratings shrunk toward average with wide uncertainty. No manual
adjustments in v1, because hand-set inputs are what the retirement gate penalized.

## 6. Season simulator

20,000 seeded iterations, seed derived from input hash, so identical inputs give
identical output.

1. **Team strength per iteration:** draw from `MVN(mean, cov)` by Cholesky, then add
   a drift term so uncertainty grows with time remaining. This correlates each
   team's results within a simulated season. Without it, title and playoff odds
   would be badly overconfident.
2. **Remaining regular season:** draw a margin for each game (needed for the point
   differential tiebreak) in date order.
3. **Unscheduled Cup slots:** teams short of 82 games get placeholder games against
   a league-average opponent at a neutral site. Schedule refresh replaces them with
   real games automatically. Cup Championship excluded.
4. **Seeding:** NBA tiebreakers in order: head-to-head, division leader, division
   record, conference record, record against playoff-eligible teams in own
   conference, then in the other conference, then point differential. Multi-team
   ties follow the multi-team order. Any simplification is documented.
5. **Play-in:** 7v8 winner takes 7, loser hosts or visits the 9v10 winner for 8.
6. **Playoffs:** 1v8, 4v5, 3v6, 2v7, best of 7 at 2-2-1-1-1 using playoff parameters.
   Home court goes to the better seed, and to the better record in the Finals.
7. **Phases, detected from data:** `regular-season`, `play-in`, `playoffs`,
   `complete`. Real results and observed series scores replace simulation as they
   occur. The observed first-round pairings override simulated seeds.

Outputs per team: projected wins (mean, p10, p90), seed distribution, and
probabilities for top-6, play-in, playoffs, conference semis, conference finals,
Finals and title.

## 7. In-game estimate

`P(home) = Phi( (m + mu*f) / (sigma_g*sqrt(f)) )`, where `m` is the current margin,
`mu` the sealed expected margin, and `f` the fraction of regulation remaining, with
a small floor and explicit overtime handling.

`sigma_g` is fitted from quarter-end margins (`linescores` on day scoreboards) on
development seasons where available, and validated at Q1, Q2 and Q3 ends. Only
end-of-quarter states can be validated, so mid-quarter values are interpolation and
the UI says so. It is labeled as an estimate, and the sealed pregame number remains
the record.

## 8. Automation and the ledger

**Workflow** `live-forecast.yml`, every 30 minutes at off-peak minutes (GitHub cron
can run late or skip). The job fetches results and today's slate, refreshes the full
schedule once daily, and commits only on a real change: new seals, new finals or a
schedule change. Expect about 5-15 commits per game day, each one a deploy.

**Fail closed.** Any of these stops publication, leaves the last good state, and
fails the job so GitHub emails the owner:

- schema validation failure
- our computed W-L disagrees with ESPN standings
- a game count, score or team ID that is impossible
- any invariant failure
- a season forecast sum check failing (title sums to 1, playoffs sum to 16)

Late score corrections are appended and picked up by the next deterministic replay.

**Sealing rule.** A date's forecasts use only games final before that date's first
tip (all finals through the previous ET date). The first run of the ET day seals
them, and any later run before tip seals games that appear late. Same-day early
results never change a later game's sealed number.

A game with no seal by tip is recorded as `missed`, is never backfilled, and is
counted publicly.

**Ledger row:** game ID, scheduled tip, issue time, model version, parameter hash,
ratings hash, home probability, expected margin, Actions run ID, previous-row hash.
Results append separately. `verify-ledger` checks the hash chain, and in CI checks
that no committed row changed.

**Captured for later study, not used by the model:**

- **Injury snapshot at seal:** this builds the timestamped availability data the
  project has never had, and it cannot be backfilled.
- **Market moneyline at seal:** used only for an aggregate comparison after a large
  sample, as the repo rule on market data allows. Not displayed per game.

**Keepalive.** Scheduled workflows are auto-disabled after 60 days of inactivity
(this happened on 2026-10-01). Data commits to `main` should prevent it, and the job
also calls the enable API monthly as protection during quiet stretches. `/api/live/health`
returns 503 when data is older than a threshold during an active slate, for an
external monitor.

**Retire the old path.** `refresh-data.yml` and `issue-forecast.yml` are removed and
`playoff-config.ts` stays frozen as the 2026 archive. Their code remains until the
replacement proves itself.

## 9. Validation gates

Declared before validation runs. Gates G1-G3 and S1-S3 must pass to go live.

**Game level, validation seasons 2016-2026, frozen parameters:**

- **G1.** Brier below the home-rate baseline, with a season-clustered paired 95%
  interval wholly below zero.
- **G2.** Not conclusively worse than either Elo-margin or season-to-date SRS (the
  paired interval must not sit wholly above zero).
- **G3.** Calibration slope in [0.90, 1.10] and grouped reliability at most 0.003.
- **G4.** Property tests: changing any future game leaves earlier forecasts
  byte-identical, and a full replay reproduces state exactly.

**Season level, at opening night, Dec 1, Feb 1 and Apr 1 of each validation season:**

- **S1.** Make-playoffs Brier beats a current-win-percentage logistic baseline at
  each checkpoint after opening night.
- **S2.** Make-playoffs reliability within 10 points per populated bin.
- **S3.** Win-total RMSE beats linear extrapolation at Dec 1 and later.
- **S4.** Our final seeding from real results matches actual seeds for at least 95%
  of team-seasons in 2022-2026, with every mismatch explained.
- **Title odds:** only 11 champions in the window, so reported descriptively and no
  skill claim is made.

**Playoffs:** series Brier reported against the SRS + home reference on matched
series. No improvement claim unless the interval excludes zero.

**On failure:** no retuning against validation seasons. The only allowed fix is to
re-fit the development-season parameters or the simulator uncertainty, and the
re-run is disclosed. If a game-level gate still fails, the site does not go live.

**Replay harness:** the pipeline runs with a frozen clock over past seasons, including
the 2026 play-in and playoffs, so April phase logic is tested now.

## 10. Rule and claim changes

The owner's goal directly conflicts with current `AGENTS.md`. These rules change, in
the same commit as the code that needs it:

- **Identity:** from a retrospective to a live forecasting system with an archived
  2026 retrospective.
- **"The scoreboard MUST NOT feed model inputs":** becomes: finalized results enter
  only through the validated pipeline, live scores reach only the in-game estimator,
  and `src/lib/model` and `src/lib/season` never import `live-data`.
- **"Model does not consume live data at runtime" and the PR gate on data:** replaced
  by automated, fail-closed publication for the live path.
- **Staying unchanged:** no betting framing, seeded randomness, bounded probabilities,
  one-decimal display, no official-data claims, no forecasting math in UI, invariants
  for new outputs.

`docs/claims-ledger.md` gains a live section: validation results are labeled
walk-forward, prospective results show N and are labeled small-sample until at least
500 games, and missed seals are counted. Methodology page gains a live section. The
page states plainly that the model does not account for injuries, and shows the
reported injury list beside each game for context.

## 11. UI

New `/live` route, added first in the navigation, using existing design tokens:

- **Today:** a card per game with teams, tip time in the viewer's zone, pregame
  probabilities, expected margin, live score and in-game estimate, final result,
  reported injuries. If no games today, shows the next slate date.
- **Season table:** East and West, sortable, with the outputs in section 6. Title-odds
  history begins at launch.
- **Playoff mode:** series scores and series win probabilities.
- **Record:** games sealed, scored, Brier, accuracy, baselines, and missed seals.
- **Freshness:** the "as of" time is always visible, and a banner appears when stale.
- The client polls `/api/live/today` every 60 s during live games and every 5 minutes
  otherwise. ESPN is called from the server with a 30 s cache, never from the browser.

## 12. Risks

| Risk | Handling |
|---|---|
| ESPN changes or blocks its endpoints (single source) | Strict validators fail closed. Site shows sealed numbers and a stale banner. Unofficial source is stated on the page. Second source is future work |
| GitHub cron is late or skipped | Early first seal leaves hours of margin. Missed seals recorded, never backfilled. Live scores do not depend on cron |
| Injured stars make forecasts look wrong | Visible caveat and displayed injury list. Availability data now collected for a future model |
| Early-season ratings are weak | Uncertainty widens intervals. Spike Oct-Nov Brier held up but is not clean evidence |
| Overconfident title odds | Correlated strength draws, drift, checkpoint reliability gates, descriptive reporting |
| Bot commits on `main` drift from owner's dirty checkout | Bot touches only `data/live/**`, so pulls will not conflict |
| Vercel Hobby limits (100 deploys per day) | At most 48 runs per day, and commits only on change |
| ESPN terms of use | Existing site already calls this endpoint. Low traffic, cached. Flagged for the owner |

## 13. Execution order

Work happens in a new worktree on `feature/live-forecasts` from `7a72d07`. The owner's
uncommitted redesign in the main checkout is not touched or shipped.

1. **Engine foundation:** teams map, types, validators, history backfill (seasons
   2005-2026), compact store, data audit.
2. **Ratings:** Kalman and comparators, property tests, fit on development seasons,
   freeze and commit registration.
3. **Validation:** walk-forward run once, gates G1-G4 recorded.
4. **Simulator:** standings, tiebreakers, play-in, playoffs, replay harness, gates
   S1-S4.
5. **In-game:** calibration and validation.
6. **Pipeline and ledger:** workflow, sealing, keepalive, dry runs against live ESPN.
7. **Site:** API routes, `/live`, methodology, claims ledger, `AGENTS.md`.
8. **Ship:** full `verify`, lint, build, merge to `main`, confirm first automated run,
   first seal and production page. Old workflows removed.

Later, before April and outside this build: seal `exact_srs_logit_plus_seed_v1` at
series start using SRS computed by this pipeline, which removes that audit blocker.

## 14. Decisions requested from the reviewer

- **D1. Rating engine:** state-space (recommended) or Elo-margin?
- **D2. Data delivery:** commit to `main` with a deploy per update (recommended: no
  runtime dependency, no secrets, keeps cron alive), or an orphan `live-data` branch
  served from GitHub Pages (no deploys, but unauthenticated `raw.githubusercontent.com`
  is rate limited, Pages caches for about 10 minutes, and the orphan branch needs its
  own `vercel.json` to stop failing previews), or Vercel Blob (needs an owner-created
  store and token)?
- **D3. In-game estimate in v1:** include (recommended, since "live" and "updated" are
  central to the goal), or defer?
- **D4. Injuries in v1:** display and capture only (recommended), or a model adjustment?
- **D5. Market odds capture at seal:** capture without per-game display (recommended),
  or leave out?
- **D6. Route and redesign:** ship `/live` with a nav link and leave `/` and the
  uncommitted redesign alone (recommended), or make `/` the live page now?
- **D7. Ship path:** merge to `main` and publish automatically once gates pass
  (recommended, since the owner asked for execution on the final decision), or stop at
  a PR for the owner?
- **D8. Gates:** are G1-G3 and S1-S4 the right bar, and is failing closed on a game-level
  failure right? Any threshold to change?
- **D9. Scope:** what should be cut or added for v1?

## 15. Final decision (Fable, binding)

Made after one review and one round of objections. Where a choice existed, this is it.

**Model and fit**

1. Kalman state-space with 31 states (30 teams plus home court with its own random
   walk). Margin cap fitted on development seasons 2005-2015. Frozen before validation.
   Validated parameters ship unchanged, with no refit on all history.
2. Playoff games update state through the same filter, with `HCA_p` as a delta on the
   home-court state and a spread multiplier only if it improves development log loss.
3. Per-season format registry. Bubble dates neutral. Mid-season parameter changes need a
   version bump, and the record is reported per version.

**Validation and ship rule** (pre-declared in `docs/live/registration.md`)

4. G1-G3 on 2016-2022. 2023-2026 reported separately, labeled "model form chosen with
   sight of these seasons". 2020 and 2021 excluded from S1-S3.
5. G1 and G4 are hard blockers. G2 is paired Brier with a season-clustered 95% interval
   not wholly above zero; failure after one disclosed refit ships with the deficit in the
   claims ledger. G3 reliability threshold 0.002; one permitted fix re-fits `sigma` alone
   on 2010-2015.
6. S4 at 100% on 2022-2026: seeds 1-6 against ESPN `playoffSeed`, seeds 7-10 against
   play-in game-1 pairings from notes. Tiebreak criteria 1-4 plus point differential;
   criteria 5-6 only if S4 forces them.
7. In-game validation at Q1, Q2 and Q3 ends on 2024-25 and 2025-26: reliability at most
   0.003, slope in [0.85, 1.15]. One refit of `sigma_g` on 2025 only, re-validated on 2026
   only. A second failure hides the in-game estimate.
8. Sum checks: title 1, playoffs 16, top-6 12, seeds 7-10 8.

**NBA rules**

9. 7v8 loser always hosts the 9v10 winner. Home court every round by better regular-season
   record with tiebreakers. Inside an iteration, a game uses `Phi(mu_draw / sigma)`.
   Placeholders count non-postponed scheduled plus final games. Matchups and phases key on
   type-5 notes, never date order.

**Sealing and data validation**

10. Seal window opens 06:00 ET. A run seals game G on ET date D when every game with ET date
    at or before D-1 is final or postponed, or when now is within 6 hours of G's tip; the
    second case sets `inputsIncomplete: true` with the missing IDs, reported separately. A
    non-final, non-postponed game 3 or more days old leaves the blocking set and standings,
    is flagged in `health.json`, and enters by replay if it later finalizes. Hard deadline
    is tip. No seal by tip is `missed`, never backfilled, counted publicly.
11. `/api/live/today` computes a provisional forecast for any unsealed game from the latest
    state (means, 31x31 covariance, last game dates), labeled "provisional, not sealed",
    never entered in the ledger or scored.
12. Drop `STATUS_POSTPONED` from finals and counts, reject 0-0 finals, read `requestedSeason`
    or per-event season on team schedules.
13. W-L cross-check, standings fetched first. Per team: equal games played with different
    wins is a hard failure. ESPN behind ours is allowed only if the gap is at most that
    team's finals dated D-1 or D, with the wins gap in [0, that count]. ESPN ahead of ours is
    allowed only if the gap is at most that team's unfinished, non-postponed games dated D-1
    or D. Anything else is a hard failure. Seeds 1-10 cross-checked against `playoffSeed` once
    every regular game is final and before any type-5 game starts.
14. Engine keys on ESPN numeric IDs. Repo-file joins use an alias map that fails closed.

**In-game**

15. `f = max(secondsRemaining/2880, 1/48)`, `P = Phi((m + mu*f) / (sigma_g*sqrt(f)))`, clamped to
    [0.005, 0.995] until final. In overtime, `m` is the current margin and
    `f = max(otSecondsRemaining/2880, 1/48)`. Store linescores going forward.

**Pipeline**

16. Commit `data/live/**` to `main` with `git pull --rebase` and one retry, only on real change.
    Weekly `data/live/heartbeat.json` commit. No enable-API call, no external-monitor
    requirement. `/api/live/health` stays.
17. Freshness copy says updates land typically within a few hours of the final. First
    production run by `workflow_dispatch`.
18. Ship by PR so `ci.yml` runs, self-merge when green, confirm first seal on production.
19. Until Phase B lands, the pipeline fails on any final or in-progress type-3 or type-5 game,
    and the regular-season simulator refuses to run once every regular game is final.

**Captured only**

20. Injury snapshot at seal: `teamId, athleteId, name, status, date`. Market capture at seal:
    moneyline and spread, no per-game display. No ledger hash chain; `verify-ledger` checks that
    no committed row changed.

**UI and repo**

21. `/live` with a nav link. `/` untouched. Live methodology under `/live`. Do not edit
    `src/app/methodology/page.tsx` or `src/app/layout.tsx`. Append `package.json` scripts at the
    end of the block. Minimal `Header.tsx` change. Tell the owner to stash, pull, pop and
    resolve Header.
22. Provisional, in-game, `inputsIncomplete` and missed states visibly labeled. One decimal.
    Stale banner.
23. `AGENTS.md` scoping changes in the same commit as the code. Claims-ledger live section with
    N, small-sample label below 500 games, missed and incomplete seals counted.

**Phases**

24. Phase A: engine, fit, game-level gates, regular-season simulator with play-in and bracket,
    ledger, pipeline, `/live` today and season table, in-game. Phase B, same engagement: phase
    detection, observed-bracket override, replay harness over the 2026 play-in and playoffs,
    playoff-mode UI, series win probabilities.

## Amendment 2026-11-01: UI redesign and per-game market reference (owner's decision)

On 2026-11-01 the owner decided to rebuild the site around the live forecast and to show market odds
beside the model's numbers for reference. This overrides "Not displayed per game" in section 9, the
display part of D5, and item 20 ("no per-game display"). Capture at seal is unchanged.

- **Routes.** `/` is the live forecast (was `/live`), `/odds` the full season forecast, `/how-it-works`
  the live methodology (was `/live/methodology`), and `/retrospective` the 2026 narrative (was `/`).
  `/live`, `/live/methodology` and `/case-study` redirect permanently. The rest of the 2026 archive keeps
  its URLs.
- **Market reference.** Each game shows the market's win probability as "Market" beside the model's
  number. `src/lib/season/market.ts` converts both American moneylines to implied probabilities and
  normalizes them to sum to 1, removing the vig. The slate view uses the live scoreboard line when present,
  else the line stored with the seal, else none. The provider is named in a legend and tooltip
  ("DraftKings line via ESPN, vig removed, for reference"), and the label is provider-agnostic so a
  prediction market can be added later. It is never a model input and never scored. No betting framing,
  no American odds, spreads or payouts on the page, and no claim about the model against the market until
  at least 500 scored games.
- **Freshness copy.** Item 17's "typically within a few hours of the final" is replaced on the pages by
  "Season odds update after games finish" plus the "Updated X ago" stamp from `generatedAt`;
  `/how-it-works` still explains that scheduled jobs can run hours late.

