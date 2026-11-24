# Registration: candidate model `live-2026.27-v5` (v4 plus the on-court observation)

Registered 2026-11-23 (Pacific), committed alone on top of dfa605d6 (the branch head before this commit, after the
data, engine, gate script and fit commits), before any gate number existed. It precedes
`docs/live/evaluation-v5-stage-a.json`.
v5 is a candidate under a registered development check only. It is not wired: v2 stays the published model and v4
the shadow, and wiring v5 at all is a separate decision of the owner's. No sentence here or anywhere says v5 beats
v4, v2, v1 or the market, or is more accurate.

## Disclosure (read first)

- **The residual study of 2026-11-23** (`docs/live/research/2026-11-23-residual-study.md`, copied unchanged with its
  machine-readable summary `docs/live/research/2026-11-23-summary.json`) looked for game-forecast accuracy beyond v4 on
  the open development seasons 2015-16 to 2023-24, with v4's Stage A game forecasts reproduced exactly. In order:
  1. **Twenty add-on candidates** (rest, travel, altitude, team home court, reaction speed, three-point luck, blowouts,
     contention, a v1 blend, team age) under one forward-chaining protocol: none showed a held-out gain whose interval
     excluded zero (sections 3 and 5). The market's advantage on spread games (0.0050 Brier) sat in the third of games
     where it and v4 disagree most (section 4).
  2. **Section 7's finding:** told who plays, v4 under-charges absences: the told residual rises +0.214 points
     (SE 0.089) per point of v4's absence charge, same sign in 7 of 9 seasons, and +0.580 (SE 0.190), 8 of 9, for
     absentees with 28+ expected minutes.
  3. **Three mechanisms were then tried, in this order:** capped expected minutes (section 7b): null; **the on-court
     observation (section 8): a small gain**; a minutes-as-evidence term in the box observation (section 9): null.
- **The research register** (`docs/live/research/README.md`) is the index of everything tried on the live game model, null results included; its 2026-11-23 entry lists this study's experiments.
- **The on-court result on these same seasons was seen before this registration.** Section 8, with s3 chosen per
  origin from {off, 80, 60, 45, 35, 25} by the same training rule as below (chosen: off, off, 45, 60, 35, 45, 60, 35,
  25 for 2015-16 to 2023-24), against v4: standard information set (10,749 games) Brier −1.11 × 10⁻⁴ (95% interval
  −1.80 to −0.42, 2,000-draw date bootstrap), log loss −2.47 × 10⁻⁴; report era (3,690) −3.28 × 10⁻⁴ (−4.86 to −1.64),
  better in 3 of 3; clean told-participation set −1.44 × 10⁻⁴; calibration on 2019-20 to 2023-24 slope 0.988,
  reliability 0.00022; games before December 1 −2.13 × 10⁻⁴; market gap on the 2,460 spread games 0.00500 → 0.00476;
  7a's 28+ coefficient 0.580 → 0.565. The study's spike code and this repository's v5 engine run the same
  observation on the same data (step 1 reproduces the study's files exactly), so at every origin where the fit below
  chooses the same s3 as the spike, G1's game forecasts are the forecasts already seen.
- **Stage A′ is therefore a registered reproduction on development seasons plus unseen season-level checks, not an
  untouched test.** G1 and G2 reproduce, under registered code and the extended grid, a result already read. G3 (season
  level) was never computed for the on-court observation by anyone before this registration.
- **The grid was extended before any frozen-set number existed.** The spike's grid was {off, 80, 60, 45, 35, 25} and
  its last origin chose 25, the lower edge. The registered grid adds two steps below, {off, 80, 60, 45, 35, 25, 18,
  13}, decided in the lead's brief before the fit ran. A choice on the new lower edge stands; there is no further
  extension.
- **No v5 code computes anything on the closed seasons.** No v5 fit, diagnostic or gate code computes, prints or
  stores a forecast, error, score, rating table or comparison for any game or team of 2024-25 or 2025-26
  (`scripts/live/v5/dev-data-v5.ts` refuses them, as does v4's `dev-data.ts`;
  `tests/roster-state-v5-isolation.test.ts`). The one exception is step 1's builder, which reads their raw files to
  write filter input; its audit gives counts and file hashes only.
- **One edit during the fit (type only).** While the fit jobs ran, `scripts/live/v5/fit-s3.ts` gained a type
  annotation (`new Set<number>(…)`) to satisfy the type checker; no behaviour changed. Jobs started before and after it
  ran semantically identical code; the provenance hash is of the final file.

## The model

**v4 unchanged** (`docs/live/registration-v4.md`: M1 to M6, S1, the frozen per-origin parameters of
`docs/live/v4-fit.json`), **plus observation 3**, the on-court plus/minus, in the same joint Kalman update as each
game's margin and box observations.

**Observation 3.** For a player p in a regular-season team-game with usable lines (team minutes ≥ 200) whose
plus/minus passes the five-man check (the side's plus/minus sum equals 5 × its final margin), with on-floor share
f = m_p / T between 0.15 and 0.90 (T the game's minutes, the team's line minutes ÷ 5; M the side's final margin,
uncapped; PM his plus/minus):

y = 48 × (PM / m_p − (M − PM) / (T − m_p)) = θ_p − Σ_{q≠p} (m_q / Σ_{q≠p} m_q) θ_q + N(0, s3² / (f (1 − f))),

the teammates q being every player with minutes in that team-game. One new parameter, s3; s3 off is v4 exactly.
**Known weakness:** a team's on/off observations within one game share stints and are treated as independent; s3
absorbs part of that dependence. Playoff and play-in games have no plus/minus input (the source covers the regular
season only).

**Code.** `src/lib/season/roster-state-v5.ts` is `roster-state.ts` byte for byte except one marked block in
`updateWithGame` (`tests/roster-state-v5.test.ts` asserts it); the block reads an optional `onCourt` input
(`{ s3, plusMinus }`) on the parameter object, so v4's parameters passed to v5 are v4. `src/lib/season/params-v5.ts`
holds the version, the grid, the input type and the frozen s3, and imports v4's frozen parameters. Season odds use
v4's simulator input unchanged (`buildV4Season` on v5's state).

## The fit

`docs/live/v5-fit.json` (`scripts/live/v5/fit-s3.ts`): every v4 parameter at its frozen per-origin value; for origin
S, s3 chosen from the grid by regular-season log loss on 2012-13 to S − 1 (v4's own scoring span); report seasons
before S forecast with v4's before-origin status table (the frozen table for the frozen set), as v4's fits were. Each
job replays only seasons before S: no held-out season is forecast or scored by the fit. The frozen set (origin 2025)
is trained on 2010-11 to 2023-24 and scored on 2012-13 to 2023-24.

| Origin (scored season) | off | 80 | 60 | 45 | 35 | 25 | 18 | 13 | Chosen |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 2015-16 | **0.588055** | 0.588083 | 0.588107 | 0.588160 | 0.588256 | 0.588570 | 0.589411 | 0.591574 | off |
| 2016-17 | **0.586252** | 0.586256 | 0.586263 | 0.586284 | 0.586336 | 0.586544 | 0.587197 | 0.589013 | off |
| 2017-18 | 0.593323 | 0.593310 | 0.593304 | **0.593300** | 0.593310 | 0.593412 | 0.593838 | 0.595207 | 45 |
| 2018-19 | 0.595676 | 0.595665 | **0.595661** | 0.595662 | 0.595681 | 0.595810 | 0.596305 | 0.597830 | 60 |
| 2019-20 | 0.596569 | 0.596548 | 0.596536 | 0.596522 | **0.596517** | 0.596581 | 0.596937 | 0.598185 | 35 |
| 2020-21 | 0.599039 | 0.599024 | 0.599016 | **0.599009** | 0.599014 | 0.599099 | 0.599481 | 0.600741 | 45 |
| 2021-22 | 0.602759 | 0.602751 | **0.602748** | 0.602749 | 0.602766 | 0.602874 | 0.603288 | 0.604573 | 60 |
| 2022-23 | 0.603877 | 0.603850 | 0.603833 | 0.603809 | **0.603787** | 0.603800 | 0.604033 | 0.605000 | 35 |
| 2023-24 | 0.606641 | 0.606606 | 0.606582 | 0.606545 | 0.606505 | **0.606474** | 0.606627 | 0.607450 | 25 |
| frozen (2010-11 to 2023-24) | 0.605350 | 0.605294 | 0.605255 | 0.605193 | 0.605121 | **0.605029** | 0.605126 | 0.605967 | 25 |

Training log loss, regular seasons 2012-13 to S − 1 (bold: chosen). The column "off" equals v4's own training loss at every origin (for example 0.588055 at 2015-16 and 0.605350 for the frozen set, the `fit log loss` of registration-v4's table). **No origin chose 18 or 13**: the choices are those of the residual study's spike at every origin, and the frozen s3 is **25**. Each grid point's training loss equals the spike's to the last digit (54 shared grid points; maximum difference 0). Consequence, stated plainly: G1's and G2's game forecasts are exactly the forecasts the study already read (section 8 of the evidence record); only their 10,000-draw intervals and G3 are new.

The fit file's provenance hash of `params-v5.ts` is of the file as it was when the fit ran (s3 not yet set; the fit never reads it); the hash below is of the file with s3 = 25.

## Data (step 1)

`scripts/live/v5/build-player-pm.ts` writes `data/season/player-pm/{season}.json.gz` (2010-11 to 2025-26; game id →
team id → [athlete id, plus/minus]) from the 548 score's raw store (read-only, outside git): the ESPN summary's
box-score +/- when both sides' sums equal 5 × the final margin, else the built game's stints (548-score) when they
exist, were not rejected by their own audit and pass the same check, else the game is dropped. Regular season only.
For 2010-11 to 2023-24 the files reproduce the residual study's exactly (every game set equal; 325,277 player values
compared, 0 mismatching games). Audit (`docs/live/v5-player-pm-audit.json`):

| Season | Games | Box passes | Stints used | Dropped | Player-games | Written | Share |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2010-11 | 1,230 | 1,158 | 49 | 23 | 25,027 | 24,615 | 0.984 |
| 2011-12 | 990 | 931 | 42 | 17 | 20,669 | 20,358 | 0.985 |
| 2012-13 | 1,229 | 978 | 38 | 213 | 22,203 | 21,283 | 0.959 |
| 2013-14 | 1,230 | 998 | 60 | 172 | 22,128 | 22,007 | 0.995 |
| 2014-15 | 1,230 | 1,013 | 45 | 172 | 22,552 | 22,372 | 0.992 |
| 2015-16 | 1,230 | 966 | 33 | 231 | 22,663 | 21,217 | 0.936 |
| 2016-17 | 1,230 | 1,005 | 44 | 181 | 22,657 | 22,303 | 0.984 |
| 2017-18 | 1,230 | 1,035 | 26 | 169 | 22,605 | 22,518 | 0.996 |
| 2018-19 | 1,230 | 1,168 | 28 | 34 | 26,035 | 25,301 | 0.972 |
| 2019-20 | 1,059 | 1,031 | 25 | 3 | 22,317 | 22,275 | 0.998 |
| 2020-21 | 1,080 | 1,041 | 36 | 3 | 22,969 | 22,956 | 0.999 |
| 2021-22 | 1,230 | 1,203 | 27 | 0 | 25,955 | 25,986 | 1.001 |
| 2022-23 | 1,230 | 1,202 | 25 | 3 | 25,818 | 25,788 | 0.999 |
| 2023-24 | 1,230 | 1,192 | 36 | 2 | 26,283 | 26,298 | 1.001 |
| 2024-25 (closed) | 1,230 | 1,199 | 28 | 3 | | 26,188 | |
| 2025-26 (closed) | 1,230 | 1,183 | 25 | 22 | | 26,103 | |

"Player-games" counts players with minutes and a readable box-score +/-; "written" counts player-games in the output.
The share can exceed 1 where stints supply players whose box line has no readable +/-. The dropped games of 2012-13 to
2017-18 are mostly Chicago's and New Orleans's, whose box scores are zeros (their own sides have no v4 lines either).
Closed seasons: counts and hashes only.

## Stage A′ gates (run once, on the lead's go)

In one fresh throwaway clone of the registered head, with nothing else run first:

```
corepack pnpm install --frozen-lockfile
corepack pnpm exec vitest run tests/roster-state-v5.test.ts tests/roster-state-v5-isolation.test.ts tests/roster-state-v5-params.test.ts tests/roster-state.test.ts tests/roster-state-isolation.test.ts tests/roster-state-params.test.ts tests/v4-goldens.test.ts tests/season-simulator-golden.test.ts
corepack pnpm exec tsx scripts/live/v5/evaluate-stage-a.ts
```

The script writes `docs/live/evaluation-v5-stage-a.json`, refuses to run if it exists and exits non-zero on failure;
the output is committed unchanged, pass or fail. It first reproduces, as blocking checks, v4's registered per-season
Brier (Stage A's `reported.perSeason`), v4's A3 figures (slope 0.9867, reliability 0.000134 on 5,829 games) and v4's A5
pooled season numbers at each checkpoint with Stage A's seeds, iterations and checkpoint capture. Then, rolling origin
with each origin's s3 (each scored season S uses the s3 and the v4 parameters fitted before S; availability tables
leave S out, as in v4's Stage A):

- **G1 (hard).** Standard information set, 2015-16 to 2023-24 (the 10,749 games): pooled paired Brier v5 − v4 with the
  95% interval (10,000-draw bootstrap over game dates) wholly below zero; and on the 3,690 report-era games the pooled
  difference negative and negative in at least two of the three seasons.
- **G2 (hard).** Calibration on 2019-20 to 2023-24 in A3's form: slope within 0.93 to 1.07, grouped reliability
  (10 equal-count bins) ≤ 0.002.
- **G3 (hard, non-inferiority against v4 at season level; unseen).** 4,000 iterations, the seven seasons of v4's A5
  (2015-16 to 2018-19, 2021-22 to 2023-24), at Dec 1, Feb 1 and Apr 1 pooled: make-playoffs Brier ≤ v4 + 0.003 and win
  RMSE ≤ v4 + 0.15; opening-night win RMSE ≤ v4 + 0.15. v5's state goes through the same simulator input v4 uses.
- **G4.** The tests above green at the gate's commit.
- **Reported only:** the per-season table (Brier and log loss, v4 and v5); games before December 1; the
  told-participation set; 7a's pooled and tier coefficients (28+, 20 to 28, under 20) for v4 and v5; the market gap on
  the spread games (Stage A's conversion); s3 by origin.

Pass is G1 to G4 together. Nothing is refitted after a gate number is seen. A failure is committed as a failure and
stops for the lead.

## Stage B (registered now, read later)

If v5 is ever wired as a shadow (a separate decision of the owner's, not part of this work), it is read once, at 500
games with a scored v5 seal and a scored v2 seal, each on its own scoring order, under v4's B1 rule and wording: D =
mean over those games of (v5 Brier − v2 Brier), interval by 10,000-draw bootstrap over game dates; B1 passes if
D ≤ +0.004 and the interval's lower end is below zero, worded "not worse than v2 over 500 games". The paired
difference against v4 on the games both sealed is reported descriptively, with no rule attached. The 500-game rule is
per version and is not lowered.

## Wiring: not in scope

Nothing in the live job changes in this phase: no edit to `scripts/live/pipeline.ts`, the workflows,
`scripts/live/v4/live-v4.ts`, the ledger rules, the site or `AGENTS.md`'s live-model paragraphs. A live v5 would also
need the live season's plus/minus (the job stores full box lines with plus/minus in `data/live/players`, which would
become a v5 input) and a warm state through 2024-25 and 2025-26; both belong to a later, separate plan.

## File hashes at registration (sha256)

v5's files:

- `src/lib/season/roster-state-v5.ts`: `ac81f2f0fe315c6a6acd26640debbf3ff368ea12324eaf0ac2a68db6eeec4d3d`
- `src/lib/season/params-v5.ts`: `7f5ffb41dfc1dce11ab0931af4957cfa1451cba3dd2095d2680192b89a60c548`
- `scripts/live/v5/build-player-pm.ts`: `fa6f750612aaf777555eab663b81a0a2c48f7598c611c12fb8559540b243f52a`
- `scripts/live/v5/dev-data-v5.ts`: `2ff9c240f64ff83e00ab9f7ec528c28d8d379a34838f96b5b54c106e94f8d07b`
- `scripts/live/v5/fit-s3.ts`: `01a2140bf02bdc14a650338b10b75d1742c54688e924c08c8b2fe5caa55dc381`
- `scripts/live/v5/evaluate-stage-a.ts`: `7286f4de7762dd3fa46cea083872d4ecf21004a332581a95bbd764309cf11e02`
- `tests/roster-state-v5.test.ts`: `edc61fde3df3ddf4a3be3de49ac556331cc8c63196bc6cc953bf07a2ef6ad391`
- `tests/roster-state-v5-isolation.test.ts`: `54e51451aabaecebd6a79e6f6e5ede4d619c2b1c778df2468378e3f0ce79e07e`
- `tests/roster-state-v5-params.test.ts`: `9f60ad0a053381da7de61c1300fa94f687d1ee6802222aac0f730e713ecee2b9`
- `docs/live/v5-fit.json`: `93e332540a04b4dce7bf55192978d98c65925673401cdb78384bb7202b2b9b1e`
- `docs/live/v5-player-pm-audit.json`: `9b5f58a6c80ba5f2e18b15a74914e6d1cde6571303eb341dc867206d2e3d5a34`

Evidence record (copied unchanged from the study's folder):

- `docs/live/research/README.md`: `59b3e99df0d0ed88aef9f612d2fb3e2defe28e3448122f4a256289da75516e43`
- `docs/live/research/2026-11-23-residual-study.md`: `d27b3c7ce9d45119303e8f7a0bfe482003e512e4f57268cba117f4f4a5b93ba0`
- `docs/live/research/2026-11-23-summary.json`: `8fe190ec0e3f707db6ff537b3951c2575e61e395bda52f1599bfd4ee340c7284`

v4's files v5 imports, as they are at this registration. Nine match the hashes in `docs/live/registration-v4.md`
exactly:

- `src/lib/season/roster-state.ts`: `a4464393ce5ea04205399a25e78a7081e77e3efa52c288909aae19a086194d57`
- `src/lib/season/minutes-v4.ts`: `a9949f4d926e0f050a4df9646a007ed6f3808d37606be23d30685106e817ec79`
- `src/lib/season/forecast-v4.ts`: `c038c96c0906b703994a485c4f4e7e48378c903ae04ae4d7f8ad240e392c3ac3`
- `src/lib/season/simulate.ts`: `bbd8c1dd5cf383863932cc75febb748873fa52fe9b530164f6c2e60e864916a7`
- `scripts/live/eval-metrics.ts`: `94cbce742de885e9157bba6d8a546cee596d3927f7eecb30f2ac3fec5602900e`
- `scripts/live/v4/dev-data.ts`: `70006194c95ccba2bc9aa9710fb4ef12ee8e55267f42bd5bb7d448559b3467f3`
- `scripts/live/v4/engine-run.ts`: `7299ac34e135d1dd7a5a7d3f093667bc0054772431f7ebf703f4e36f703ef718`
- `scripts/live/v4/references.ts`: `1d97d5e26536c93ae5cafe21dffc0e236f558683a47453adf1d84b6105bdf006`
- `docs/live/v4-fit.json`: `c1f1d868841d7b06fc5c216025dbc3e1bffae11db059afe63024363b7256d4a4`

Two differ from v4's registered hashes, because v4's own Phase C edited them after v4's registration (commits
62509c2f, 17d80ad3, 27c781b1 and 1ddcd48e: the shadow wiring and `V4_FIRST_ET_DATE`):

- `src/lib/season/availability-v4.ts`: `e2ed7f97a4607f022b9d41c033a5971ba79afe41a2702b21569360af5600ec1f` (registered `781bc7ebae085b20c75f7861d22090bf2f22dd862a9c9bb2f3e9a15d14bb5861`)
- `src/lib/season/params-v4.ts`: `a6fad540af24f3c47af108887c7b4ca7596d9913cb423997eaa92d089822367a` (registered `3025673ceeeba47737b85195b6948b57c2864ffa7e5eca98f59115616610831b`)

And one that v4's list does not contain because it was written after v4's registration, unchanged since v4's result
commit f36bf17a:

- `docs/live/evaluation-v4-stage-a.json`: `21f1a383c079ad6104909e8565dafea2a1b5db685778280959f2c2b5328507a6`

The gate's blocking reproductions (v4's per-season Brier, its A3 figures and its A5 pooled season numbers) are what show
that those edits did not change v4's forecasts or season odds: a difference in any of them stops the gate before G1.

The plus/minus files' hashes are in `docs/live/v5-player-pm-audit.json`.

## 2026-11-23, Stage A′ result: passed

Run once, on the lead's go, in a fresh throwaway clone of the registered head 5b7ec568, with nothing else run
first. The eight listed test files passed there (34 tests), then `evaluate-stage-a.ts` ran and exited 0. Its
output, `docs/live/evaluation-v5-stage-a.json` (sha256
`3c5eff7d63451444659ca76c2a6b315e9dc1ce59fd7d0fd4882c06f5dec2775e`), is copied here unchanged and frozen. The
executor was cut off by a usage limit after the run and before this section; the session lead copied the output
from the clone and wrote the section, changing no number.

This is a development check on seasons the residual study had seen. G1 and G2 reproduce, under registered code,
game forecasts already read before registration; only their 10,000-draw intervals and G3 are new. Nothing here
says v5 beats v4, v2, v1 or the market.

- **Reproductions, blocking: exact.** v4's per-season Brier, its A3 figures (slope 0.9867, reliability 0.000134)
  and its A5 pooled season numbers (opening 0.159488 / 8.347, Dec 1 0.133765 / 6.027, Feb 1 0.074897 / 3.455,
  Apr 1 0.031680 / 1.147).
- **G1, passed.** Standard information set, 10,749 games: Brier v4 0.212104, v5 0.211993; paired difference
  −0.000111, 95% interval −0.000182 to −0.000043 (10,000 draws over 1,438 dates); log loss 0.612151 and
  0.611905. Negative in 5 of 9 seasons, positive in 2 (2019-20 +0.000089, 2020-21 +0.000067), identical in the
  2 whose origin chose s3 off. Report era, 3,690 games: −0.000328, negative in 3 of 3 seasons (−0.000192,
  −0.000284, −0.000508).
- **G2, passed.** 5,829 games: slope 0.9879 (band 0.93 to 1.07), grouped reliability 0.000223 (limit 0.002);
  v4's are 0.9867 and 0.000134.
- **G3, passed (season level, not computed for this observation before registration).**

  | Checkpoint | Make-playoffs Brier v4 / v5 (limit) | Win RMSE v4 / v5 (limit) |
  |---|---|---|
  | Opening night | 0.1595 / 0.1581 (not gated) | 8.347 / 8.315 (8.497) |
  | Dec 1 | 0.1338 / 0.1331 (0.1368) | 6.027 / 6.018 (6.177) |
  | Feb 1 | 0.0749 / 0.0753 (0.0779) | 3.455 / 3.431 (3.605) |
  | Apr 1 | 0.0317 / 0.0314 (0.0347) | 1.147 / 1.146 (1.297) |

  210 team-seasons, 4,000 iterations. v5 is within every limit. It is a non-inferiority check: the differences
  are far inside what 210 team-seasons can resolve and no direction is claimed from them.
- **G4, passed.** The eight test files green at the gate's commit (34 tests).
- **Reported only.** s3 by origin: off, off, 45, 60, 35, 45, 60, 35, 25. Games before December 1 (2,467):
  v4 0.213504, v5 0.213292. Told-participation set (9,845): 0.210316 and 0.210172, difference −0.000144
  (−0.000226 to −0.000066). Section 7a's coefficients, v4 then v5: pooled 0.214 (SE 0.089) and 0.197 (0.088);
  28+ minutes 0.580 (0.190) and 0.565 (0.188); 20 to 28, 0.289 and 0.274; under 20, 0.149 and 0.105. The absence
  anomaly of section 7 is not explained by this observation. Spread games (2,460): market 0.212258, v4
  0.217260, v5 0.217023; the market stays ahead of both, by 0.0050 and 0.0048.

Pass is G1 to G4 together: **passed**. v5 is a registered candidate and nothing more: it is not wired, seals
nothing and changes no published number. Wiring it as a shadow is the owner's decision; its prospective rule is
Stage B above. `docs/live/research/README.md` gained one appended entry with this result, so its hash listed
above is the registration commit's.

## Amendment 1 (2026-11-23, after the Stage A′ result; before any wiring and any Stage B number)

From the outside review of this registration (gpt-6-astra, 2026-11-23). It changes wording only, and only for
a result that does not exist yet.

Stage B's rule B1 (D ≤ +0.004 and the interval's lower end below zero) can pass with, for example, D = +0.003
and an interval from −0.002 to +0.010. A model that much worse is compatible with such a pass, so the wording
"not worse than v2 over 500 games" would claim more than the rule shows. The rule itself is unchanged: it is
v4's screen, and v5 is held to the same one.

What changes for v5: a B1 pass is worded **"passed its registered screen against v2 over 500 games: not
clearly worse"**, and it is always printed with D and its interval. The words "not worse than v2" or
"non-inferior" may be used only if the interval's upper end is at or below +0.004. A B1 fail keeps its
meaning. v4's registration keeps its own wording; changing that is the owner's decision.

## Wiring as built (2026-11-24, before v5's first seal)

On the owner's decision of 2026-11-24 ("Should v5 seal as a second shadow beside v4?": yes), v5 is wired the way
v4 was (`docs/live/registration-v4.md`, "Wiring", "Phase C wiring as built" and "Astra's review of PR #37"). No
file whose hash is listed above changed (checked at the end of this section).

- **Rows.** From `V5_FIRST_ET_DATE` = 2026-11-25 each game gains v5 morning, reissued and final rows in v4's exact
  shape: `modelVersion` `live-2026.27-v5`, v1's reference probability, complete drivers, no `policyRevision`.
  v5 and v2 pair by (game, seal kind). Its record starts at its first seal; nothing is backfilled and no number
  on a game already played was computed for it.
- **Where it lives.** The registered files stay as registered, so v5's live constants are in a new file,
  `src/lib/season/params-v5-live.ts` (`V5_FIRST_ET_DATE`, `V5_LAST_ET_DATE`, `V5_WARM_SHA256`). The live modules
  are in `scripts/live/v5-shadow/` rather than `scripts/live/v5/`: the registered isolation test
  (`tests/roster-state-v5-isolation.test.ts`) fails for any file in `scripts/live/v5/` that names a data
  directory, and its hash is listed above, so the live modules sit beside it and have their own test
  (`tests/v5-shadow-isolation.test.ts`), which allows the warm-state module, its builder, the checkpoint loader
  and the check, each with its reason, and fails for any other file there that reads a data file. The
  development loader (`scripts/live/v5/dev-data-v5.ts`) still refuses 2024-25 and 2025-26.
- **Engine and inputs.** `scripts/live/v5-shadow/live-v5.ts` (`shadowV5`) is `shadowV4` with v5's engine
  (`roster-state-v5.ts`) and `V5_FROZEN` (v4's frozen parameters, s3 = 25), refreshing M5's scale after
  `advanceTo` as v4 does. It shares only `liveLines` with `live-v4.ts`; v4's code is unchanged. The live
  season's plus/minus comes from the stored player lines (`data/live/players/{season}/{etDate}.json`), players
  with minutes above zero: ESPN's summary box-score "+/-" column, the same column of the same summary that
  `build-player-pm.ts` reads for the historical files, so the sign is the same (his team's points minus its
  opponent's while he was on the floor). On live-data fa62bfd8, 509 of this season's 516 stored team-games pass
  the five-man check (a count of inputs).
- **Warm state.** `data/season/v5/warm-2026.bin.gz`: v5's engine replayed from 2010-11 through 2025-26 with
  observation 3 on (s3 = 25 throughout, plus/minus from `data/season/player-pm/{season}.json.gz`), by
  `scripts/live/v5-shadow/build-warm-checkpoint.ts` through `warm-state-v5.ts`, which returns a state and nothing
  else and holds the only reader of the closed seasons' plus/minus. Built twice: the same sha256 both times,
  `7683554d7b96f6a5fc3ca829df2f3fd1c0ff397a276ba59778593a7bb1290065`, pinned as `V5_WARM_SHA256`.
- **Guard.** The job runs v5 after v4 in its own guard. A v5 failure of any kind writes no v5 row, keeps the
  previous `shadow-v5.json` and sets `shadowV5Problem` in `health.json` (present only on failure;
  `shadowProblem` stays v4's); a v4 failure does not stop v5. Inside the guard the job runs the checks
  `verify:ledger` and `verify:live` run on v5 (`ledgerProblems`; `shadowV5FileProblems` and `v5ParamsProblems` in
  `scripts/live/v5-shadow/check.ts`), through the same functions, on exactly the ledger and the bytes it is about
  to write; on any problem v5 writes nothing that run (the lesson of PR #38). A dry run writes no v5 row and
  keeps the previous file.
- **Checks.** `verify-ledger` rejects a v5 seal outside its ET dates, without v1's reference, without a seal kind
  or with a `policyRevision`, and a v5 missed row outside its ET dates. `verify:live` checks s3 against
  `docs/live/v5-fit.json`, the shadow file's version, dates, s3 and sums, that its record counts no more games
  than v5 sealed, that the published state is v2's, and that no v5 key is in `state.json` or the projections.
  v1's and v2's paths, the site's day and month files and `verify:live`'s published rows exclude v5 rows as they
  exclude v4's. The watchdog reports a missing v5 seal under `shadow-v5-unsealed-{gameId}`, labelled as the
  second shadow model's, in its existing incident issue; its constants are kept equal to the params files by
  `tests/v5-shadow-wiring.test.ts`. While building this, v4's `shadow-unsealed-` key was found to be neither
  checked nor retired by `checkedKeys`, so an open one would have kept an incident open for good; both shadow
  keys are now checked and retired as v2's `unsealed-` key is.
- **Stop switch.** `V5_LAST_ET_DATE` (null now). Once v5 has sealed, its rows are in the append-only ledger, so
  setting the first date back to null or reverting the code would make the checks reject rows already written
  and block every push. Setting the last date stops v5: no v5 seal or missed row for a game after it,
  `verify-ledger` rejects a v5 seal after it, and the watchdog (`V5.lastEtDate`) expects none after it. `/record`
  then reads "Sealed from {first} to {last}, then stopped. Not the published forecast." with the record frozen at
  the games through the last date. Before the first seal, a plain revert is enough.
- **Shadow file.** `data/live/site/{season}/shadow-v5.json`, v4's shape plus `lastEtDate` and `s3`, listed in the
  manifest, labelled "In testing: model v5 (v4 plus an on-court observation). Not the published forecast."
  `sameGames` covers games with a scored seal from all four of v5, v4, v2 and v1, each on its own scored seal.
  `impact` is kept in v4's shape; `src/lib/view/impact-source.ts` is unchanged.
- **Site.** `getShadowV5` (`published.ts`) fails as `getShadowV4` does, never costing a page its snapshot.
  `/record` keeps v4's section as it was and adds v5's after it: scored games, Brier and log loss, the
  small-sample label under 500, and the same-games lines for v5, v4, v2 and v1 as plain numbers in that fixed
  order, with no difference column, colour, ordering by score or market line. `/how-it-works#roster-state` gains
  one paragraph. No other page mentions v5.
- **Proofs** (throwaway clones with no remote, live-data at c0df69ef, `LIVE_NOW` 2026-11-24T02:00:15.741Z, the
  network replayed from one recording, `main` at 9cde1410; logs kept outside the repository). Only bytes, row
  counts and exit codes were compared. (a) v5 off (first date null, and as committed): every file under
  `data/live` byte-identical to `main`'s run. (b) First date moved in the clone to 2026-11-23: the ledger minus
  v5's rows, `state.json`, the projections, `shadow-v4.json` and every other file byte-identical to `main`'s
  except the manifest and the new `shadow-v5.json`; 4 v5 rows (2 morning, 2 final, the kinds due);
  `verify:ledger` and `verify:live` exit 0. (c) v5 made to throw: identical to `main` except `health.json`'s
  `shadowV5Problem`; v1, v2 and v4 rows written; both verifies exit 0. (d) A title-odds sum corrupted just before
  the shared check: no v5 row and no v5 file, `shadowV5Problem` set; both verifies exit 0. (e) A second run on top
  of (b): no new ledger row, and no file differs from (b), as none differs between `main`'s two runs. (f) v4 made
  to throw: v5's rows and file written, `shadowProblem` set; both verifies exit 0. (g) The stop switch by unit
  tests (`tests/v5-shadow-wiring.test.ts`), and one replay on (b)'s result with the last date set to 2026-11-23:
  both verifies exit 0, and against (e) only `shadow-v5.json`'s `lastEtDate` and its manifest line differ.
  (h) `verify:routes` on a `main` build serving (b)'s data: passed; on this branch's build serving live-data's head
  fa62bfd8 (no v5 file): the one failure, "/api/live/health answered 200, not 503" with the data host down, is the
  same failure `main`'s build shows on that same data (it depends on how fresh the bundled copy is), and every
  other check passed in both; `main` on its own data passes. (i) v5's part of the run 7.9 s beside v4's 5.8 s;
  the job's wall time 12.0 s on `main` and 20.0 s with v5 sealing (8.9 s and 16.0 s on the second run).
- **Hash check of the files listed above**, at this section's commit: every listed file matches its listed hash
  except `docs/live/research/README.md`, the append-only register, which already differed at the base (its
  result entry) and gained one appended entry here. Nothing under `docs/live/v5-fit-parts/`,
  `data/season/player-pm/`, `scripts/live/v4/`, `scripts/live/v5/` or the frozen engine files changed.

## 2026-11-24, review of PR #44 and the lead's rulings (before v5's first seal)

Two reviews of the wiring as first built (a7795b67): the session lead's, and an outside one (gpt-6-astra). What
follows was fixed or ruled on in 31067f3d, before any v5 seal. No file whose hash is listed above changed.

- **A stored shadow file could block a push (fixed; found by both reviews).** If the stop switch is set while v5
  is failing, the run keeps the previous `shadow-v5.json`, whose `lastEtDate` no longer equals the constant, and
  `verify:live` rejects it, which would stop the push that carries v1's, v2's and v4's seals. Reproduced on
  a7795b67 in a clone: `verify:live` exits 1. A dry run keeps the file the same way. Now, whenever a run writes no
  v5 file, the job runs the same check on the stored one (`shadowV5FileOnDiskProblems` in
  `scripts/live/v5-shadow/check.ts`) against the ledger as the run leaves it, and removes a file that would fail;
  the note goes to `shadowV5Problem`. The record page then shows no v5 section until v5 writes a file again. So
  the "Guard" paragraph above reads: a v5 failure keeps the previous file unless that file would fail the check.
- **The shadow files were written outside any guard (fixed; outside review).** Both files were written after
  every model's rows had been appended, with nothing catching a failed write, so a shadow file that could not be
  written would have ended the run before health and the site files, and the push would have lost the seals. Both
  writes are now guarded. A failed v5 write falls through to the stored-file check above. A failed v4 write
  removes whatever is left at its path, which v4's check accepts (it was the same on `main` before this work).
- **The warm state forms closed-season predictions as filter state (ruled acceptable, as for v4; outside
  review).** `warmStateV5Through` calls the frozen engine's `warmState`, which replays 2024-25 and 2025-26 with
  `replayRosterState`, and that calls `forecastGame` for each game. This is the path ruled on for v4
  (`docs/live/registration-v4.md`, Amendment 1 ruling 2, and "Astra's review of PR #37"): M5's window needs each
  game's predicted components and outcome, which are kept in the checkpoint as filter state; the probability
  fields the shared function also computes are incidental and discarded. For v5 as for v4 they are never
  printed, stored, summarised, scored or compared, and no path leads from them into evaluation, model selection
  or reader-facing copy. The engine is frozen and is not edited. The prohibition stands on evaluating anything on
  those seasons; where this document or the builder's brief says no code "computes" a forecast for them, it is
  read with this exception, which v4's warm state has had since its first seal.
- **Clean in the outside review.** v4 is unchanged, and treating both shadow keys in the watchdog as v2's key is
  treated is correct and alters no other incident. The live path is the registered model: the engine, s3 = 25,
  the plus/minus column and sign, the scale refresh and the opening rosters. The stop switch's sealing range and
  the watchdog's filter agree. The reader-facing copy makes no superiority claim and discloses that the
  development check reused seasons already studied.
- **Disclosed.** In the proofs that moved the first date to 2026-11-23 inside a clone, the job's own log printed
  the probabilities v5 would have sealed for two games of that date, which had been played. Nothing was scored
  or compared, those rows exist only in throwaway clones, and v5's record starts with its first real seal.
- **Proofs after the fixes** (same method and recording; clones of 31067f3d, `main` at 9cde1410; logs and scripts
  kept outside the repository). In all ten runs the job, `verify:ledger` and `verify:live` exit 0. v5 off as
  committed: every file under `data/live` byte-identical to `main`'s. v5 on: the ledger minus v5's 4 rows and
  every other file identical to `main`'s except the manifest and `shadow-v5.json`; a second run changes nothing.
  The stop switch set while v5 throws, on top of that: the stored file is withdrawn and both verifies exit 0
  (exit 1 before the fix). v5 throws with no stored file: only `health.json` differs from `main`. v4 throws: v5's
  rows and file are written. A directory placed at v5's file path: v5's 4 rows are written, the file is not, and
  nothing else differs from `main` but `health.json`. The same at v4's path: v4's rows are written and its file
  withdrawn, with v5 unaffected.
