# Registration: injury model `live-2026.27-v3`

Registered 2026-11-20, before any number on 2024-25 or 2025-26 was computed with v3 code in
this run. The binding plan is `/Users/bilguutei/Desktop/548-reviews/2026-11-20-v3-plan.md`
(sections 0 to 3 and Amendment 1); the owner's answers are in `2026-11-20-v3-run.md` there.
This commit contains this file alone and precedes `docs/live/evaluation-injury-v3.json`.
v3 fixes the three defects of v2 confirmed by the 2026-11-05 review (H1, H2, H3) and
nothing else. No sentence here or anywhere says v3 beats v2, v1 or the market.

## What changes, and why

v3 changes only absences carried forward in time. Everything else is v2's, frozen (D7):
ratings, the replay's margin adjustment, player values (`INJURY_PARAMS`), status weights
(`INJURY_STATUS_TABLE`), sigma, the simulator's uncertainty scale 1.5, and every
report-covered side of every seal. So v3's `ratingsHash` equals v2's and one frozen replay
serves both. The engine is `src/lib/season/injury-v3.ts` (pure) plus the optional
`absenceSchedule` input of `src/lib/season/simulate.ts`, exclusive with v2's `absences`.

- **D1, gap counting.** v3 keeps its own gap counter beside v2's tracker, fed by an
  `onAbsences` hook (`gapHook`); v3 code never writes `tracker.missed`. A gap starts when
  v2's tracker first records the miss, grows by one for every later team game with a stored
  box score in which the player does not appear, and ends when he appears for that team or
  for another team, or the season rolls. A game without a box score changes nothing.
- **D2, expiry (H3).** A player in the gap map who is not on his team's latest report rows
  stops counting when his gap exceeds `ROTATION_GAMES` (10), or at once when his last team
  is another team. Published views list him as "No longer counted: out of the rotation
  window" while the gap is 11 to 20, then drop him; a player who joined another team is not
  listed. Report-listed players follow the report exactly as in v2.
  **Amendment 1:** a report marking a team NOT YET SUBMITTED carries no information. For the
  expiry test only, such a team's rows are its last filed rows of the current season, on
  seals and in the published state (`GapTracker.filedRows`/`unfiled`, `applyLatestWord`
  beside v2's `applyLatestReport`). Who counts as absent (v2's rule) and D4's S(1) keep
  reading the rows exactly as v2 does.
- **D3, hazard fit (H2).** The population and spells are v2's fit: regular-season games of
  2021-22 to 2023-24, with 2020-21 as warm-up, and a spell opens only for a player with
  positive lost value. The class is read per game from the final-point report row's reason,
  using the frozen stems. After each missed game (k games missed so far, k >= 1) there is one
  at-risk observation, resolved by the team's next regular-season game with a box score:
  returned, or not. Observations are right-censored, with none recorded, at the team's last
  regular-season game, at a next game with no box score (the rest of the spell is dropped),
  and when the player leaves the team's expected set without appearing (left the rotation,
  or appeared elsewhere). Censoring is never a return. Non-regular games (the Cup final)
  neither resolve nor break a spell. `h(class, bucket(k))` is returns over at-risk on buckets
  1, 2-3, 4-7, 8-15, 16-30 and 31+.
  - **Bucket 0 has no hazard,** and the engine throws if asked for it.
  - **Pooling:** a cell needs at least 100 at-risk observations and 5 returns, else it pools
    with the next shorter bucket of its class (the first bucket pools with the next longer).
    A tail hazard of zero aborts the fit.
  - **Classes** are used if long's pooled hazard is below short's. All three readings
    (first bucket, overall rate, every bucket) are computed, and the fit aborts if they
    disagree; else one table is used.
  - **Not done:** no monotone constraint, no smoothing, no new strata. The hazard is
    constant beyond 31.
- **D4, survival.** For an absence with k missed: S(1) is the frozen status weight if he is
  listed O, D or Q on the team's latest rows, else 1 − h(k); S(j) = S(j−1)·(1 − h(k+j−1)).
- **D5, sample in the simulator, integrate elsewhere.** Each simulation iteration draws one
  duration per absent player by inverse survival: he misses the team's next D games, with
  D = #{j : S(j) > u}. The uniform comes from his own stream,
  `createSeededRandom("v3-return:" + season + ":" + asOfEtDate + ":" + athleteId)`, one
  draw per iteration. Game randomness is never consumed, a run is deterministic, and adding
  one player never changes another's draws. Seals for unfiled sides, projections and
  displayed charges use the expectation points·S(j). "Expected games" is the sum of S(j)
  over the team's remaining regular-season games.
- **D6, schedule (H1).** A per-iteration team-game ordinal runs through:
  1. pending regular games, in the simulator's order;
  2. unscheduled placeholders (now charged);
  3. each play-in game;
  4. every game of every series.

  Observed postseason games consume no ordinal. v2's `absences` input and its code path are
  unchanged, and passing both inputs throws.
- **D7, not changed.** As above. M7 is not addressed and stays disclosed: no causal
  identification, unadjusted margins before a box score arrives, no calendar aging, a
  plug-in probit.
- **D8, v2 policy carried into v3.** All of v2's revisions 1 to 3 are v3's registered base
  policy:
  - the half-slate report gate;
  - reissued morning seals;
  - unfiled sides from current absences, now under D2 (amended) and D4;
  - complete driver lists;
  - next-slate reports;
  - projections with the injury term;
  - the scoring order: final, else reissued, else morning.

  v3 rows store no `policyRevision`, and no revision is appended to v2's table.

Wiring (Phase D, not in this commit's scope):
- **W1, references.** v1's morning rows and v2's morning, reissued and final rows continue
  exactly as today. v3 adds its own rows in the v2 shape, each with
  `referenceModelVersion` v1.
- **W2, cutover.** One constant, `V3_FIRST_ET_DATE`, in a new `params-v3.ts`; before it the
  job is byte-identical to `main`, and from it v3 is published. `state.referenceModelVersion`
  stays v1, with an additive `referenceModelVersions: [v2, v1]`.
- **W3, checks.**
  - `verify-ledger` rejects a v3 seal before the cutover, a v3 seal without the v1
    reference, and a v3 `policyRevision`.
  - The watchdog's missing-seal check covers v2 and v3.
  - `verify:live` requires records for the published version and every reference, and
    checks the v3 hazards against the fit file.

  The 500-scored-games gate is per version and starts from zero for v3.

## The frozen fit

`docs/live/v3-fit.json` (sha256 `2b8afab01a31002a4285b900f488eec5f1d145cfac02a74571f7f18bf58eeaf6`)
was written by `scripts/live/fit-injury-v3.ts` at commit 187145963827dc88d42c0f1253162223beb48775,
with a clean tree for code. The provenance block holds the sha256 of every code file and every
data file read.

| Hazard | 1 | 2-3 | 4-7 | 8-15 | 16-30 | 31+ |
|---|---:|---:|---:|---:|---:|---:|
| Long | 0.3471 | 0.0597 | 0.0255 | 0.0244 | 0.0251 | 0.0124 |
| Short | 0.4315 | 0.2901 | 0.1815 | 0.0988 | 0.0555 | 0.0225 |

- **Population:** 36,265 at-risk observations, 8,539 returns, 9,752 spells.
- **At-risk by bucket:** long 170 / 268 / 471 / 860 / 997 / 1,213; short 9,347 / 8,576 /
  7,260 / 4,323 / 1,893 / 887. No cell pooled.
- **Classes used:** all three readings of the class rule agree.
- **Censored, by cause:** 542 at season end, 415 left the rotation, 256 appeared elsewhere,
  0 for a missing box score.
- **Ignored continuations:** 1,027 absent entries whose v2 count was already above zero with
  no open spell, the rest of a dropped spell.
- **Cup final:** 28 continuing observations crossed the 2023 Cup final, where v2's count
  includes that game; per D3 it is ignored.
- **The fit was run three times on the same data,** with identical numbers each time: once
  for the first fit, then after the population module gained spell output, then after
  Amendment 1. Only the provenance hashes changed.

**Data read, disclosed.** The fit, the diagnostics and the gate's smoke mode load:
- games through 2023-24;
- box scores for 2020-21 to 2023-24;
- reports for 2021-22 to 2023-24.

The name index also reads the 2024-25 and 2025-26 box-score files for identity only, exactly
as v2's fit does (accepted in Amendment 1). The 2026-11-06 caveat applies: later identity
data can make an ambiguous name unique, so this is a measured absence of effect, not a
guarantee.

## Development diagnostics (2021-22 to 2023-24; report only)

The outputs were kept outside the repository, and `scripts/live/diagnose-injury-v3.ts`
reproduces them.

**Calibration of S(j)** (unlisted form) on the hazard population. A state's outcome at j is
known unless its spell is censored before j. That conditioning biases the observed share
downward for larger j, because censoring is informative.

| Class, j | 1 | 2 | 5 | 10 |
|---|---|---|---|---|
| Short, observed / predicted | 0.740 / 0.740 | 0.594 / 0.597 | 0.364 / 0.375 | 0.189 / 0.234 |
| Long, observed / predicted | 0.963 / 0.963 | 0.937 / 0.941 | 0.869 / 0.882 | 0.757 / 0.796 |

These are in-sample. Leave-one-season-out, with hazards refitted on the other two seasons,
S(10) short is 0.210 / 0.242, 0.178 / 0.231 and 0.178 / 0.226. Long is 0.804 / 0.786,
0.655 / 0.814 and 0.804 / 0.780. 2022-23's long spells are the least well predicted.

**The gate in smoke mode** on the three development seasons, with the final design:
- **c1:** 3,690 games, v3 minus v2 exactly 0.
- **c2 (T4):** passes at every checkpoint, against v1 + 0.005 and v1 + 0.25:

  | Checkpoint | Make-playoffs Brier v1 / v2 / v3 | Win RMSE v1 / v2 / v3 |
  |---|---|---|
  | Dec 1 | 0.1504 / 0.1429 / 0.1437 | 6.56 / 6.50 / 6.44 |
  | Feb 1 | 0.1021 / 0.0958 / 0.0932 | 3.71 / 3.76 / 3.70 |
  | Apr 1 | 0.0482 / 0.0410 / 0.0418 | 1.09 / 1.07 / 1.05 |

- **c3:** 1,061 games, v2 0.21271, v3 0.21344, a difference of +0.00073 against the 0.004
  tolerance.

**A permitted design iteration, disclosed.** As first written, v3 failed c3 on the
development seasons: 0.21686, or +0.00415 on 1,061 games. The cause was the mechanism. Under
D8 an unfiled team's empty report became its latest word, so D2 treated every listed
long-term absentee as unreported and expired him once his gap passed ten. That halved the
unfiled sides' mean charge, from 3.36 points under v2 to 1.67. Two alternatives were measured:

| Alternative | c3 difference |
|---|---|
| Expiry off on these sides | +0.00042 |
| Keep the last filed rows (the executor's proposal) | +0.00056 |

The registered fix is Amendment 1, narrower than the second alternative: only the expiry
test reads the last filed rows. Measured once, it gives +0.00073. It was chosen on
mechanism, because NOT YET SUBMITTED is not "nobody listed", not on the smaller number. The
c3 threshold and the gate are unchanged. No test-season number had been seen.

## Sizes on the published state (report only)

The state is `live-data` at 5ba23c22, generated 2026-11-21T07:40Z for slate 2026-11-20. It
ran in a throwaway clone, offline, at 100,000 iterations (`scripts/live/v3-sizes.ts`). v2
reproduced the published forecast exactly, and v3 with every switch off equals v2 bit for
bit. Changes are against v2, in percentage points:

| Run | Mean absolute change, playoff / title | Largest playoff movements | Largest title movements |
|---|---|---|---|
| Expiry alone | 0.11 / 0.05 | DAL −0.4, GS +0.4 | at most 0.2 |
| Hazards alone | 1.37 / 0.26 | GS −9.7, TOR −3.7, LAL +3.3, DEN +3.2, DAL +3.0 | OKC −1.9, HOU +0.8, NY +0.7 |
| Postseason schedule alone | 0 / 0 | none | none |
| All three | 1.39 / 0.23 | GS −9.8, TOR −3.9, LAL +3.5, DEN +3.3, DAL +3.0 | OKC −1.4, HOU +0.8, MIN −0.7, POR −0.6, DEN +0.5 |

- **Postseason schedule:** in November every absence ends long before the postseason, so it
  changes nothing today.
- **Expiry:** two players move to "no longer counted": Ben Saraf (BKN, 12 games) and Chris
  Manon (LAL, 11).
- **Unfiled-side seal terms** for the 2026-11-21 games, from the 02:30 report: NO 3.88 points
  under v2 against 3.02 under v3, and SAC 2.92 against 2.21.

## The gate (Phase C; abort-only; run once, on the lead's go)

This is the **second v3-family look** at 2024-25 and 2025-26 (see the disclosure).

1. **v2 reproduces.** Run `corepack pnpm exec tsx scripts/live/evaluate-injury.ts`, then
   `git diff --exit-code docs/live/evaluation-injury.json`. Then
   `corepack pnpm exec tsx scripts/live/evaluate-unfiled.ts` must print 745 games, 0.2199
   under the old rule and 0.2093 under revision 2. Any difference is blocking.
2. **Gate.** Run `corepack pnpm exec tsx scripts/live/evaluate-injury-v3.ts`. It writes
   `docs/live/evaluation-injury-v3.json`, exits non-zero on failure, and refuses to run once
   that file exists. It passes only if all of the following hold:
   - **(c1)** On the registered final-point set (2,460 qualifying games), v3 Brier minus v2
     Brier is within ±0.002. A difference above 1e-9 is a blocking bug even inside the
     tolerance.
   - **(c2)** T4 as registered for v2: 4,000 iterations at Dec 1, Feb 1 and Apr 1, both
     seasons pooled. v3's make-playoffs Brier must be at most v1 + 0.005 and its win RMSE at
     most v1 + 0.25 at every checkpoint, with forecast sums valid. The script's v1 and v2
     values must equal `docs/live/evaluation-injury.json` exactly:
     - v1: 0.112454, 0.091687, 0.054426 and 7.137, 4.384, 1.182;
     - v2: 0.116216, 0.08685, 0.058696 and 7.275, 4.527, 1.128.

     The limits are therefore about 0.1175, 0.0967 and 0.0594, and 7.39, 4.63 and 1.43.
   - **(c3)** On the regular-season games with a team NOT YET SUBMITTED at the morning
     point, v3's morning Brier must be at most v2's + 0.004. v2 must reproduce the registered
     745 games and 0.2093.

   A fail stops the run for the owner. A pass is appended here, and the JSON is frozen.
3. **Byte-identical with v3 off.** On `main` and the branch, with the same `data/live`, a
   pinned `LIVE_NOW` and replayed network responses, `state.json`, the projections and the
   ledger must be identical.

**File hashes at registration (sha256):**
- `scripts/live/evaluate-injury-v3.ts`: `94cc7ae0dd9481f7149a3d27a98c72821cf030477f15b6a645dfa80186a1622e`
- `src/lib/season/injury-v3.ts`: `c9175827e43c49b05cb6ed21ffc7b708c1745e034f438d82aa182e79e7a8b54a`
- `src/lib/season/simulate.ts`: `4f8a194d1dbfccd2887276448a7f1c84333f810c971e02052f93bbbd91fb7512`
- `src/lib/season/injury-model.ts`: `cd666605d19bebacce77baf8490bbf30fddedf7260dc25f91e634627533e248e`
- `src/lib/season/live-injury.ts`: `5148f44702295a3ee7869e4033925feb4affea72b462d1ee9c762a9e5b2e816f`
- `src/lib/season/availability.ts`: `749e93c14c0affa92a1dfbdfdd5410fc0c59bda0b613c1f947a6a33592e9b0b6`
- `src/lib/season/params.ts`: `9b10955bfa0bccd856880ceff1a87c5cbad0e018c85da3ab47f28bd77f0c3a39`
- `scripts/live/v3-hazard-data.ts`: `9d5a85c726b855c47f7d38a1326a800760b2b837d956588bc14662bad6645c87`
- `scripts/live/fit-injury-v3.ts`: `ed5f4830200d4d294fe8b9bd0f1de6e5beab4078d4cd519107aeb56d559ccb2b`
- `scripts/live/availability-store.ts`: `4d7d1c199821e17e908cae212b36bf4b6f2b0256f873d26105b3b69c921f5f5e`
- `scripts/live/eval-metrics.ts`: `94cbce742de885e9157bba6d8a546cee596d3927f7eecb30f2ac3fec5602900e`
- `scripts/live/game-store.ts`: `e4b5d4bd9eb18e1655fda14999c469355eb5e545c07a94c0f5e42477b76460ae`
- `docs/live/v3-fit.json`: `2b8afab01a31002a4285b900f488eec5f1d145cfac02a74571f7f18bf58eeaf6`

Invariants (`scripts/verify/v3-invariants.ts`, run by `verify:live` and
`tests/injury-v3-invariants.test.ts`) and the golden simulator hashes
(`tests/season-simulator-golden.test.ts`) must pass at the gate's commit.

## Disclosure: the earlier look at the test seasons

The groundwork branch `origin/feat/v3-groundwork` (Codex, 2026-11-05) did look at the test
seasons. Its session log shows the following, in a clone at `/tmp/pp-cx-b1`:

- At 01:53Z it committed its own draft registration (ecee018f), unreviewed.
- At 01:58Z it ran its `scripts/live/evaluate-injury-v3.ts` once on 2024-25 and 2025-26.
  The process exited 2, and the visible tail of its output reads `"passed": false` overall.
  The Apr 1 checkpoint shows `passed: true` (v3 make-playoffs Brier 0.0555, win RMSE 1.139;
  v2 0.0587, 1.128). The rest of the output was never printed, and the file is gone.
- It also ran a copy of the v2 evaluation, which reproduces known v2 numbers only.
- Its committed `v3-fit.json` used development seasons only.

So a v3 candidate's regression check has been run once on the test seasons and did not pass.
Which condition failed is unknown; the most likely is a Dec 1 or Feb 1 simulator checkpoint.

The consequences are three:
- This run's gate is the second v3-family look at those seasons, disclosed and abort-only.
  The owner accepted this on 2026-11-20.
- A simulator check on the development seasons was added before registration (above).
- No choice here was tuned to that output. Nobody re-ran groundwork code on the test seasons
  or tried to learn which condition failed, and none of the groundwork code, fit or gate
  script is used here.

2024-25 and 2025-26 were also seen when v1's form was chosen, and v2's test and the
745-game unfiled comparison used them; they are not an untouched holdout. Two test seasons
is thin; the sealed ledger remains the real test.

## Known limitations that stay

M7 as above:
- hazards pool listed and unlisted players;
- censoring is informative, so return chances for unlisted players are probably understated;
- the tail hazard is constant;
- sampling adds a little day-to-day noise to season odds.

## The record

The v3 record starts at v3's first seal, prospectively, from `V3_FIRST_ET_DATE`. Nothing is
backfilled. It is labeled small-sample below 500 scored v3 games, and v2 keeps sealing as a
reference beside v1.

## 2026-11-21, gate result: did not pass

Phase C was run once, on the lead's go, in a fresh throwaway clone of the registered head
4577de697dbc552b64ec16b9b94606d7399b4c06. The output is
`docs/live/evaluation-injury-v3.json`, copied unchanged and frozen.

- **C1, v2 reproduces: passed.** `evaluate-injury.ts` rewrote
  `docs/live/evaluation-injury.json` byte-identically. `evaluate-unfiled.ts` gave 745 games,
  0.2199 under the old rule and 0.2093 under revision 2.
- **c1: passed.** 2,460 games; v2 0.200907 and v3 0.200907; difference exactly 0, and the
  largest per-game difference was 0.
- **c2 (T4): FAILED at Dec 1.** v1 and v2 reproduced the frozen values exactly.

  | Checkpoint | Make-playoffs Brier v1 / v2 / v3 | Brier limit | Win RMSE v1 / v2 / v3 | RMSE limit | Result |
  |---|---|---|---|---|---|
  | Dec 1 | 0.112454 / 0.116216 / **0.118760** | 0.117454 | 7.137 / 7.275 / 7.235 | 7.387 | Fails, Brier by 0.0013 |
  | Feb 1 | 0.091687 / 0.086850 / 0.084686 | 0.096687 | 4.384 / 4.527 / 4.359 | 4.634 | Passes |
  | Apr 1 | 0.054426 / 0.058696 / 0.056174 | 0.059426 | 1.182 / 1.128 / 1.141 | 1.432 | Passes |

- **c3: passed.** 745 games; v2 morning 0.209336, v3 0.209575, a difference of +0.000239
  against the 0.004 tolerance.
- **C3, byte-identical with v3 off: not run.** The run stopped at the failed gate.

The candidate does not pass. Per the registration, this stops the run for the owner.
Nothing is refit or changed after this number. v2 remains the published model, unchanged.
This was the second v3-family look at 2024-25 and 2025-26.

Named limitation (Amendment 2), recorded here as the plan asks: the long class pools
season-ending repairs with shorter tears. For example, a "Right Oblique Tear" at k=4 reads
as most of a season. A class refinement, fitted on development seasons and registered
separately, is a candidate for a future version.
