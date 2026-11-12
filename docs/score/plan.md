# The 548 score: build plan

Started 2026-11-12. This is the working plan for replacing the Game Score based player number
with a player rating in the class of BPM, RAPM and EPM. The research behind it and the review
by a second model are summarised in section 1. Section 6 is the test the first release must
pass; its final wording is frozen in `docs/score/registration.md` before the test is run.

## 1. Why, and what was decided

Today the site shows "548 impact": Hollinger Game Score per minute above a replacement level,
decayed and shrunk, times expected minutes, times a fitted multiplier (`lostValue` in
`src/lib/season/injury-model.ts`). Game Score's weights were set by hand. A 29% two-point
shooter breaks even, defence is only steals and blocks, and the number is never negative. It is
a description of box-score production used as the cost of an absence.

The owner's decisions (2026-11-11):

- The 548 score becomes a **signed estimate of a player's effect on his team's scoring margin
  per 100 possessions against a league-average player**, and it should show impact beyond the
  box score. So the on-court layer (Stage 2) is part of the target, not optional.
- The published score uses the **same weights for every position**. A role-aware version is
  fitted beside it and the accuracy gap is published, whatever it is. The score is never tuned
  to move a particular player.
- Two numbers on the site: the signed **548 score** on player pages, and **548 impact** (points
  of margin a team loses when he sits) on injury pages. Until Stage 3, 548 impact stays the
  number the forecast really uses, from Game Score.
- Stage 1 goes on the site as an interim, labelled experimental and box-score only, **if its
  error is at least 10% lower than the current number's** on a held-out test of predicting team
  results. If it misses, it stays off the site and work continues on Stage 2.
- The test report also checks six groups: high-assist centres, high-rebound guards,
  inefficient volume scorers, defence-first players, stat accumulators and low-usage role
  players. These are reported, never tuned.
- The injury model keeps Game Score until one frozen candidate passes the project's registered
  test on future sealed forecasts (Stage 3). Nothing in Stages 1 and 2 changes a forecast.

## 2. Stages

1. **Foundation.** ESPN game summaries for 2010-11 to 2025-26, lineups and possessions rebuilt
   from the plays, audited against the box score.
2. **Stage 1, the box model.** RAPM from the rebuilt lineups; a box model with common
   coefficients fitted to it within team; the pre-declared test; if it passes, the score on the
   site.
3. **Stage 2, the on-court layer.** RAPM shrunk toward the Stage 1 rating instead of toward
   zero, with offence and defence apart; its own pre-declared test against Stage 1; lineups
   stored for the live season.
4. **Stage 3, the injury model.** A registered candidate version only.

## 3. Rules for this work

- The score is not a forecast input. Nothing under `src/lib/season/` or `src/lib/model/` may
  import `src/lib/score/`. `src/lib/score/` may import types and pure helpers from
  `src/lib/season/`. A test enforces the first rule.
- `src/lib/score/` is pure: no fetch, no file access, no clock, no randomness without a seed.
  Scripts in `scripts/score/` do the reading, fetching and writing.
- No new package dependencies.
- Raw summaries and built games live under `data/historical/raw/score/` (ignored by Git).
  Committed: code, tests, `docs/score/` (plan, registration, audit and results as JSON) and the
  frozen coefficients.
- Nothing is selected, tuned or looked at on the test seasons before the registration is
  frozen. Tuning happens only on the training era (section 6).
- Every public sentence about the score follows `docs/claims-ledger.md`; the ledger gains an
  entry for the score before any page shows it.
- Player identity is ESPN's athlete ID, team identity ESPN's team ID, as in the live model.

## 4. Data contract

`src/lib/score/types.ts` defines `ScoreGame` (one finished game: full box lines per team,
stints or null, and a lineup audit) and `Stint` (ten players, seconds, possessions and points
per side, starting margin). `scripts/score/store.ts` reads and writes them:
`loadSummary(season, gameId)`, `saveScoreGames`, `loadScoreGames(season)`.

`scripts/score/fetch-summaries.ts` stores the raw summaries, trimmed to `boxscore`, `plays`,
`header` and `gameInfo`.

## 5. Method

### 5.1 Lineups and possessions

- Starters come from the box score. Substitution plays change the five. A period's opening
  five comes from ESPN's period-start substitutions where they exist (recent seasons), and is
  otherwise inferred: a player is on at the start of a period if he acts, or is substituted
  out, before he is substituted in. A player who plays a whole period without appearing in a
  play is resolved from box-score minutes and plus-minus where that is unambiguous.
- Free throws belong to the ten players on the floor when the foul was called.
- A possession ends on a made basket (after its free throw, if any), a defensive rebound, a
  turnover, the last made free throw of a trip, or the end of a period.
- Audit per game: five a side at every play; stint points equal the final score; each
  player's stint plus-minus within one point of the box score's and stint minutes within a
  small gap of box minutes. A game that fails is kept with `stints: null` and a reason, and is
  counted per season in `docs/score/lineup-audit.json`.

### 5.2 RAPM

- One row per stint and side on offence: points per 100 possessions, weighted by possessions.
  Each player has an offence column and a defence column; a home-offence column and a season
  intercept are not penalised. Ridge, with separate penalties for offence and defence chosen by
  cross-validation over games.
- Multi-season windows inside the training era give the box model its target.

### 5.3 The box model

- Per-100-possession rates from box lines, with on-court possessions estimated from team box
  totals and minutes share (so the live site, which has box lines, computes the same thing).
- rating = team net rating / 5 + sum over stats of coefficient × (the player's rate − his
  team's rate). The coefficients are the same for every position. They are identified from
  differences between teammates, and a team's players add up to its net rating.
- Stats: points, shot attempts, free-throw attempts, three-pointers, assists, turnovers,
  offensive and defensive rebounds, steals, blocks, fouls.
- The published coefficients come from a lineup regression: each stint's margin is explained
  by the two teams' net ratings plus the summed within-team deviations of the ten players on
  the floor, with the stint's own game left out of every rate. This fits the weights
  directly to lineup results on their own scale. A regression on multi-season RAPM totals is
  reported beside it as a cross-check.
- A role-aware variant adds a few regularised position interactions. It is a comparison only.
- Time: a player's rating on a date combines his (team, season) pieces to that date, older
  seasons weighted down and small samples shrunk toward a replacement value. The three
  parameters are chosen in the training era on in-season game predictions, because the site
  shows the rating on a date.

## 6. The Stage 1 test (frozen in `docs/score/registration.md` before it runs)

- **Training era:** seasons to 2019-20. Coefficients, penalties, decay and every other choice
  come from here.
- **Test:** the six seasons 2020-21 to 2025-26. For each team-season, the prediction is the
  minutes-weighted sum of its players' ratings at the end of the season before, using the
  minutes they actually played in the test season. A player with no rating or under 250
  minutes the season before takes that metric's replacement value. Each metric is mapped to
  net rating by a straight line fitted in the training era.
- **Endpoint:** root-mean-square error against the team's actual net rating per 100
  possessions, pooled over the 180 team-seasons.
- **Comparator:** the current number's rating part: Game Score per minute, decayed and shrunk
  exactly as production does, without the floor at replacement level (the stronger form). The
  floored production form is reported beside it.
- **Pass, three conditions, all required:** the new score's error is at most 0.90 times the
  comparator's (the owner's bar); it is lower than the same rating with every box-score weight
  set to zero (team quality alone); and it is lower than last season's team net rating as a
  predictor. The last two were added before any test data was read, because the score carries
  team quality and the comparator does not.
- **Reported, not gating:** bootstrap intervals; the floored comparator; the all-zero
  baseline; the role-aware variant; the cross-check; Game Score inside the same team frame
  and Game Score plus a team term; a game-level check with ratings frozen before each game;
  the six owner checks.

## 7. Who builds what

The lead (Claude Fable) decides, reviews, commits and merges. Opus agents build. One Astra
consult at the final review if its limits allow.

| Area | Files |
|---|---|
| Lead | `docs/score/plan.md`, `docs/score/registration.md` (final wording), `src/lib/score/types.ts`, `scripts/score/store.ts`, `scripts/score/fetch-summaries.ts` |
| Lineups | `src/lib/score/lineups.ts`, `src/lib/score/possessions.ts`, `scripts/score/build-games.ts`, `tests/score-lineups*.test.ts`, `docs/score/lineup-audit.json` |
| Model | `src/lib/score/rapm.ts`, `src/lib/score/box-model.ts`, `src/lib/score/book.ts`, `scripts/score/fit-*.ts`, `scripts/score/evaluate-*.ts`, `tests/score-rapm*.test.ts`, `tests/score-box*.test.ts` |
| Site (after the test) | player index field, pages, method page, claims ledger, verifier checks |
