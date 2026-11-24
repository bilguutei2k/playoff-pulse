# Where is v4's remaining game-forecast error? Residual study, 2026-11-23

Research agent (Claude Opus 5.5) for the session lead. This is evidence only: nothing was registered, tuned, committed or pushed. Worktree `/Users/bilguutei/dev/548-research` (branch `research/next-gain` at e59b7593), untouched; every script and output is in `/Users/bilguutei/dev/548-research-out/`. No game, team or player of 2024-25 or 2025-26 was read, computed or stored: model data came only through `scripts/live/v4/dev-data.ts` (seasons up to 2023-24), and nothing under `data/live` was read.

## Headline

- **No candidate mechanism shows a held-out gain whose 95% interval excludes zero.** Seventeen candidate models (plus three for age) were tested under one forward-chaining protocol on 7,059 held-out games (2018-19 to 2023-24). The largest point gain is altitude (Denver and Utah at home): −1.9 × 10⁻⁴ Brier, interval (−3.9, +0.0). Every other candidate is within ±1.5 × 10⁻⁴ of zero or worse. Two (team-specific home court, and the age shares) are reliably *worse* held out.
- **The market gap is 0.0050 Brier (interval 0.0023 to 0.0078) on the 2,460 spread games, and 95% of it sits in the third of games where the market and v4 disagree most** (mean |gap| 0.10 in probability). There the market scores 0.2174 and v4 0.2317. In the other two thirds they are level.
- **The features I could build explain about 10% of the variance of the market − v4 disagreement** (R² 0.097). The largest single block is listed absences: the market moves further than v4 for the absences v4 itself charges (about 0.35 extra points per point v4 charges). Next come team age, v4's own confidence (the market is less extreme), contention after March 1 and the month. In-sample, v4's own residuals agree (v4 under-charges listed absences by about 0.4 points per point), but the effect is unstable across the three report seasons and does not survive the held-out test available.
- **Combined ceiling:** under the rule fixed before looking (a candidate counts if its Brier interval lies wholly below zero), **no candidate qualifies, so the ceiling this study supports is zero.** Every candidate together is clearly worse held out (+10.7 × 10⁻⁴, interval +1.3 to +20.3). A rule picked after seeing the results (altitude + previous meeting + three-point makes) gives −3.3 × 10⁻⁴ (−6.2, −0.6) against recalibrated v4 and −2.4 × 10⁻⁴ (−6.0, +1.2) against raw v4. That is an optimistic upper estimate, and it is still about a fifteenth of the market gap.

- **Spike (section 8):** adding each player's within-game on/off margin as an observation (one parameter s3, chosen per origin by training loss) lowers Brier by **−1.1 × 10⁻⁴ (−1.8, −0.4)** on the 10,749 games and **−3.3 (−4.9, −1.6)** in the report era. The star shortfall does not move (+0.58 → +0.57), and the market gap closes from 0.0050 to 0.0048.
- **Second mechanism (section 9):** a minutes-as-evidence term in the box observation gives nothing held out (−0.08 × 10⁻⁴, interval −0.59 to +0.41; βm chosen 0 at the last three origins), and the star shortfall stays (+0.58 → +0.56). Both mechanisms together: −1.18 (−2.02, −0.34) standard, star coefficient +0.55.
- **Follow-up (section 7):** told who plays, v4 under-charges absences: the told residual rises **+0.21 points (SE 0.09) per point of v4's absence charge**, same sign in 7 of 9 seasons, and **+0.58 (0.19), 8 of 9, for players with 28+ expected minutes**. A capped-minutes variant does not fix it (told −0.19 × 10⁻⁴, interval −0.51 to +0.14; report set +1.0, −1.9 to +4.0). Knowing participation recovers about a sixth of the market's edge in the largest-disagreement third (−23 of −131 × 10⁻⁴).

The plain reading: the 0.005 the market holds over v4 is not in schedule, travel, home court, reaction speed, shooting luck, blowouts, tanking or a v1 blend in any form this protocol can detect (its resolution for one feature is roughly ±1 to ±3 × 10⁻⁴, so the gap is 15 to 50 times larger than what it can see). It sits in a minority of games where the market knows something about the matchup that v4 does not, and the observable traces of that something are mostly absences (and, more weakly, roster changes, contention late in the season and altitude).

## 1. Reproduction check (passed exactly)

`gen-games.ts` replays v4 per scored season S from scratch with `docs/live/v4-fit.json`'s origin-S ratings, status tables before-origin for earlier report seasons and leave-one-out for S, reports from 2021-22 only, exactly as `evaluate-stage-a.ts`'s `replaySeason`. v1 from `references.v1GameRows(2024)`, v2 from `references.v2FinalRows()`, market `Φ(−spread / 13)` with Stage A's chosen scale 13 on the spread games inside v2's 3,690.

| Season | Games | v4 Brier (mine / Stage A) | v1 Brier (mine / Stage A) |
|---|---:|---|---|
| 2015-16 | 1,230 | 0.199269 / 0.199269 | 0.199003 / 0.199003 |
| 2016-17 | 1,230 | 0.216318 / 0.216318 | 0.217403 / 0.217403 |
| 2017-18 | 1,230 | 0.210247 / 0.210247 | 0.214173 / 0.214173 |
| 2018-19 | 1,230 | 0.207930 / 0.207930 | 0.212692 / 0.212692 |
| 2019-20 | 1,059 | 0.215311 / 0.215311 | 0.217842 / 0.217842 |
| 2020-21 | 1,080 | 0.222816 / 0.222816 | 0.227818 / 0.227818 |
| 2021-22 | 1,230 | 0.212974 / 0.212974 | 0.220062 / 0.220062 |
| 2022-23 | 1,230 | 0.221547 / 0.221547 | 0.227772 / 0.227772 |
| 2023-24 | 1,230 | 0.204276 / 0.204276 | 0.209852 / 0.209852 |

Market subset: 2,460 games, market 0.212258, v4 0.217260, v2 0.217809 (Stage A: identical). A2 set: v4 0.212932, v2 0.213927 on 3,690 (identical). Pooled v4 − v1 −0.0040013 on 10,749 (identical). The table is `/Users/bilguutei/dev/548-research-out/games.csv` (one row per game: id, season, ET date, tip, teams, neutral flag, v4 probability, expected margin, predictive SD = sqrt(E[σ² + v] + Var(μ)) over M5's mixture, c_t, plug-in probability, count of Q/D players, the points v4 charges each side for listed rows (2021-22 on), v1, v2 where it exists, final margin, outcome, spread and market probability).

Note: the 2,460 spread games are all of 2021-22 and 2022-23; none of 2023-24's games enter Stage A's market subset (the same filter as Stage A; I did not investigate why).

## 2. Protocol (stated once, applied to every candidate)

- Second stage: logistic `y ~ 1 + logit(p_v4) + features` (features standardised on the training rows). For held-out season S ∈ {2018-19, …, 2023-24} it is fitted on every scored season before S from 2015-16 (so 2018-19 is trained on three seasons, 2023-24 on eight) and scored on S. 7,059 held-out games.
- Primary comparison: the same model without the features ("recalibrated v4"), so the gain is the feature's alone. Raw v4 scores 0.213930 Brier / 0.616165 log loss on these games and recalibrated v4 0.214021 / 0.616423 (recalibration costs +0.9 × 10⁻⁴, interval −1.4 to +3.0: v4 is already calibrated). Gains against raw v4 are in `results-candidates.json` (`dBrierVsRaw`) and are the primary number plus about 0.9 × 10⁻⁴.
- Interval: 2,000-draw bootstrap over ET dates of the per-game differences, pooled over the six seasons (seed 548). "Seasons better" counts held-out seasons whose mean Brier difference is negative.
- In-sample direction, all nine seasons (10,749 games): (i) the coefficient of each feature in an ordinary least squares fit of v4's margin residual (final margin − v4's expected margin, home view) on the candidate's features, in points per unit, with heteroskedasticity-robust (HC1) SE; (ii) the logit coefficient beside logit(p_v4), with SE from the information matrix. Positive margin coefficient = the home team does better than v4 expects as the feature rises.
- Features are home-minus-away differences unless a side is named. Every feature uses only games of earlier ET dates (plus the published schedule: the season's last date).

## 3. Results by candidate

Units: Brier and log loss changes × 10⁻⁴ against recalibrated v4; negative is better.

| Candidate | Held-out ΔBrier ×10⁻⁴ (95% CI) | ΔLog loss ×10⁻⁴ (95% CI) | Seasons better (of 6) | In-sample: margin residual, points per unit (SE) | In-sample: logit coef (SE) |
|---|---|---|---|---|---|
| a1 rest days, 3-in-4, 4-in-6 (each side) | +1.2 (-2.7, +5.2) | +1.8 (-6.7, +10.5) | 2 | b2b_H +0.028 (0.696); r1_H -0.090 (0.588); r2_H +0.046 (0.643); b2b_A -0.324 (0.721); r1_A -0.464 (0.656); r2_A -0.503 (0.713); in4_H -0.268 (0.386); in4_A +0.595 (0.383); in6_H +0.040 (0.348); in6_A +0.426 (0.339) | b2b_H -0.0209 (0.1164); r1_H -0.0784 (0.0995); r2_H -0.0135 (0.1087); b2b_A -0.0273 (0.1228); r1_A -0.0746 (0.1110); r2_A -0.0951 (0.1201); in4_H -0.0380 (0.0635); in4_A +0.0500 (0.0646); in6_H +0.0849 (0.0573); in6_A +0.0296 (0.0568) |
| a2 rest difference (home minus away, 0..3) | -0.2 (-0.9, +0.4) | -0.3 (-1.7, +1.2) | 4 | restdiff +0.213 (0.136) | restdiff +0.0252 (0.0230) |
| b1 travel: distance, zones crossed E/W, trip and homestand number | +3.1 (-0.3, +6.6) | +7.0 (-0.7, +14.7) | 1 | dist_H +0.001 (0.310); dist_A -0.100 (0.250); tzE_H -0.304 (0.423); tzW_H +0.122 (0.418); tzE_A +0.183 (0.297); tzW_A +0.024 (0.306); trip_A +0.064 (0.101); stand_H -0.049 (0.125) | dist_H -0.0308 (0.0515); dist_A -0.0364 (0.0417); tzE_H +0.0108 (0.0701); tzW_H +0.0350 (0.0689); tzE_A -0.0094 (0.0498); tzW_A +0.0455 (0.0517); trip_A -0.0196 (0.0172); stand_H +0.0038 (0.0209) |
| b2 altitude (home DEN or UTA) | -1.9 (-3.9, +0.0) | -3.8 (-8.4, +0.6) | 5 | alt +1.816 (0.499) | alt +0.2305 (0.0876) |
| c team-specific home court (past home-minus-road residual) | +1.0 (+0.2, +1.8) | +2.1 (+0.4, +3.9) | 1 | hcx -0.023 (0.140) | hcx -0.0004 (0.0234) |
| d1 recent v4 error, last 5 (home minus away, standardized) | -0.0 (-0.6, +0.5) | +0.0 (-1.3, +1.2) | 3 | z5d +0.125 (0.195) | z5d -0.0302 (0.0330) |
| d2 recent v4 error, last 10 | +0.2 (-0.6, +1.0) | +0.5 (-1.2, +2.3) | 3 | z10d +0.379 (0.252) | z10d -0.0275 (0.0432) |
| d3 previous meeting's v4 error | -0.4 (-1.4, +0.5) | -0.9 (-3.0, +1.2) | 4 | prevmeet -0.288 (0.133) | prevmeet -0.0316 (0.0220) |
| e1 3PM luck, last 5 (points, net for minus against) | +0.3 (-0.4, +1.0) | +0.8 (-0.8, +2.4) | 3 | tp5d -0.001 (0.012) | tp5d -0.0010 (0.0020) |
| e2 3PM luck, last 10 | +0.3 (-0.3, +0.8) | +0.6 (-0.6, +1.9) | 2 | tp10d +0.012 (0.016) | tp10d -0.0009 (0.0027) |
| e3 3PM luck last 10, for and against separately | -0.9 (-2.7, +0.8) | -1.8 (-5.7, +2.0) | 4 | tpf10d +0.048 (0.022); tpa10d +0.033 (0.025) | tpf10d +0.0043 (0.0036); tpa10d +0.0075 (0.0041) |
| f1 blowout excess beyond 20, last 10 | +1.1 (-2.0, +4.5) | +2.9 (-4.1, +10.4) | 2 | bx20d +0.128 (0.056) | bx20d +0.0083 (0.0109) |
| f2 margin beyond v4's 30 cap, last 10 | +0.2 (-1.2, +1.6) | +0.4 (-2.8, +3.6) | 2 | bx30d +0.258 (0.130) | bx30d +0.0118 (0.0233) |
| g1 contention mismatch after Mar 1 | -0.4 (-2.6, +1.9) | +0.3 (-5.2, +6.4) | 2 | tank +1.042 (0.404) | tank +0.1560 (0.0807) |
| g2 contention mismatch, last 14 days | +0.0 (-0.9, +1.0) | +0.7 (-1.9, +3.5) | 4 | tank14 +0.818 (0.689) | tank14 +0.0654 (0.1330) |
| g3 last 14 days x v4 logit (confidence change) | +1.4 (-0.7, +3.5) | +2.7 (-2.3, +7.9) | 2 | last14x +0.021 (0.415); last14 -0.078 (0.464) | last14x -0.1017 (0.0836); last14 +0.0648 (0.0757) |
| h blend with v1 (v1 logit) | +1.4 (-0.2, +3.2) | +2.8 (-0.9, +6.9) | 1 | xv1 +0.191 (0.134) | xv1 -0.0089 (0.0705) |
| i1 team age at opening (min-weighted, home minus away) | +0.6 (-0.1, +1.4) | +1.2 (-0.5, +2.9) | 2 | age_d -0.083 (0.049) | age_d -0.0061 (0.0094) |
| i2 age shares: <=23 and >=32 (home minus away) | +1.2 (+0.4, +2.0) | +2.5 (+0.7, +4.4) | 1 | young_d -0.063 (0.565); old_d -1.141 (0.778) | young_d +0.0066 (0.1058); old_d -0.0258 (0.1293) |
| i3 age, first 20 games per team only (interaction) | +0.5 (-0.2, +1.3) | +1.3 (-0.4, +3.0) | 3 | age_d_early -0.079 (0.096); early +0.268 (0.292) | age_d_early -0.0020 (0.0175); early +0.0606 (0.0485) |

### Reading, candidate by candidate

- **a. Schedule: nothing beyond v4's fixed charge.** Rest dummies, 3-in-4 and 4-in-6 together lose held out (+1.2, 2 of 6 seasons); the rest difference alone is −0.2 (−0.9, +0.4). The 1.5-point back-to-back charge is about right: regressing v4's margin residual on (away b2b − home b2b) gives **+0.39 points (SE 0.24)** still missing, i.e. a total near 1.9 is not distinguishable from 1.5. Against one day of rest, an away back-to-back leaves +0.58 (0.31) points unexplained and a home back-to-back +0.08 (0.37), so if anything the away side's charge is light and the home side's right; neither is clear. The market's disagreement with v4 shows no rest term either (all |t| < 1.3).
- **b. Travel: nothing; altitude: the one marginal signal.** Distance, zones crossed in each direction, road-trip game number and homestand number together lose (+3.1, 1 of 6). Altitude is the strongest held-out result in the study: **−1.9 (−3.9, +0.0), log loss −3.8 (−8.4, +0.6), better in 5 of 6 seasons**, with Denver and Utah home games beating v4's margin by **+1.8 points (SE 0.50)** in-sample. The interval touches zero, so by the protocol it is not established; the market's disagreement leans the same way (+0.042 logit, SE 0.026, about 0.3 points). 6.6% of games carry the flag.
- **c. Team-specific home court: reliably worse.** A team's past home-minus-road residual (requiring 41 home and 41 road prior games in the table) does not predict: in-sample +0.00 points per point (SE 0.14), held out **+1.0 (+0.2, +1.8)**, worse. v4's single league home term is enough; its league-wide residual is +0.18 points (SE 0.13) in non-neutral games.
- **d. Reaction speed: clean null.** Mean standardized v4 residual over the last 5 games (−0.0), last 10 (+0.2) and the previous meeting (−0.4) carry nothing held out. In-sample the last-10 coefficient is +0.38 points per SD (0.25) and the previous meeting −0.29 (0.13) (a pair's surprise partly reverses, i.e. v4 may over-react slightly to a single meeting, about 0.3 points per SD; not held up). By month the last-10 coefficient is +0.65 (0.42) points in Oct-Nov, +0.61 (0.65) Dec, +0.17 (0.66) Jan, +0.23 (0.74) Feb, +0.14 (0.64) Mar and −0.37 (0.88) Apr+; logit coefficients all within 1.3 SE of zero. A faint early-season under-reaction, no reliable direction.
- **e. Three-point luck: null, and the sign is not reversion.** Points from three-point makes above the team's own 82-game baseline, for minus against, over the last 5 (+0.3) and 10 (+0.3) games do nothing held out. Split into for and against (−0.9, interval −2.7 to +0.8) both in-sample coefficients are *positive*: a team that recently made more threes than usual keeps beating v4 slightly (+0.05 points per point, SE 0.02), so recent hot shooting is partly real rather than reverting. See "Could not do" for why this is makes, not percentages.
- **f. Blowouts: null held out.** The signed excess beyond ±20 in the last 10 games is +0.13 points per point (0.06) in-sample (v4's capped update slightly under-weights blowouts), and the excess beyond v4's ±30 cap +0.26 (0.13), but neither gains held out (+1.1, +0.2).
- **g. Season phase and tanking: a real in-sample effect that the held-out test cannot resolve.** After March 1, the team in contention beats v4 against one out of it by **+1.04 points (SE 0.40)** in-sample (logit +0.156, SE 0.081); the market's disagreement shows the same lean (+0.178 logit, SE 0.028, about 1.2 points). Held out it is −0.4 (−2.6, +1.9) with log loss +0.3: only about 8% of games carry the flag, and the six-season test cannot see an effect of this size. Restricted to the last 14 days it is +0.0; a change of v4's confidence in the last 14 days +1.4 (worse).
- **h. v1 blend: nothing.** Adding v1's logit loses (+1.4, 1 of 6); its logit coefficient beside v4's is −0.01 (0.07).
- **i. Age.** **Null, and the share version is worse.** Birth dates came for all 1,709 players in the 2010-11 to 2023-24 lines (ESPN's athlete endpoint, one request at a time, cached; no refusals). Minutes-weighted team age at opening ranges from 22.5 to 31.8 years. Age difference: held out +0.6 (−0.1, +1.4), 2 of 6 seasons; in-sample −0.08 points per year (SE 0.05), so older teams do very slightly worse than v4 expects, not significant. Shares of minutes from players 23 or younger and 32 or older: **+1.2 (+0.4, +2.0), worse**, 1 of 6; in-sample young −0.06 (0.57), old −1.14 (0.78) points per unit share. Restricted to games before each team's 20th (where the brief's hypothesis is sharpest): +0.5 (−0.2, +1.4), in-sample −0.08 (0.10) points per year. v4's age-blind between-season regression leaves no age signal that this test can see.

## 4. What the market knows (2,460 spread games, 2021-22 and 2022-23)

Market − v4 Brier advantage: **0.0050 (interval 0.0023 to 0.0078)**; positive in both seasons (0.0046, 0.0054). Fitted jointly, `y ~ logit(market) + logit(v4)` gives the market 1.03 (SE 0.14) and v4 −0.03 (0.15): on these games the market contains everything v4 knows.

**Where the advantage lives.**

| Split | Games | Market | v4 | Advantage × 10⁻³ (95% CI) | Share of total |
|---|---:|---:|---:|---|---:|
| Smallest third of |market − v4| (mean 0.013) | 820 | 0.2067 | 0.2071 | +0.4 (−0.5, +1.4) | 3% |
| Middle third (mean 0.042) | 820 | 0.2127 | 0.2131 | +0.4 (−2.5, +3.0) | 2% |
| **Largest third (mean 0.102)** | 820 | 0.2174 | 0.2317 | **+14.3 (+7.2, +21.8)** | **95%** |
| Oct-Nov | 642 | 0.2148 | 0.2174 | +2.6 (−2.5, +8.0) | 14% |
| Dec | 431 | 0.2280 | 0.2333 | +5.3 (−0.1, +11.3) | 18% |
| Jan | 453 | 0.2153 | 0.2185 | +3.3 (−3.0, +8.9) | 12% |
| Feb | 326 | 0.2042 | 0.2096 | +5.4 (−1.4, +12.1) | 14% |
| Mar | 458 | 0.2041 | 0.2100 | +6.0 (+0.3, +11.8) | 22% |
| Apr | 150 | 0.1895 | 0.2055 | +16.1 (−3.3, +36.1) | 20% |
| v4 charges > 0.5 pt for listed absences (either side) | 2,003 | 0.2112 | 0.2167 | +5.5 (+2.1, +8.8) | 89% |
| none or < 0.5 pt | 457 | 0.2169 | 0.2198 | +2.9 (−2.4, +8.2) | 11% |
| A side had a mid-season arrival within its last 10 games | 747 | 0.2028 | 0.2115 | +8.7 (+3.6, +13.7) | 53% |
| No recent arrival | 1,713 | 0.2164 | 0.2198 | +3.4 (+0.2, +6.8) | 47% |
| Either team has played < 20 games | 616 | 0.2173 | 0.2194 | +2.1 (−3.2, +7.2) | 11% |
| Both ≥ 20 games | 1,844 | 0.2106 | 0.2165 | +6.0 (+2.9, +9.2) | 89% |

In the largest-gap third the market's direction (relative to v4) is right 62% of the time against 53 to 54% in the other thirds. Those games look almost like the rest on what I measured: v4's absence charges 1.85 points against 1.65, a recent arrival 31% against 30%, a back-to-back 32% against 28%, Questionable or Doubtful players 1.22 per game against 0.89 (the clearest difference: games where who plays is undecided at the final report). The advantage is not an early-season effect (it is smaller before each team's 20th game) and grows late in the season (March and April carry 42% of it on 25% of the games).

**What explains the disagreement** (OLS of logit(market) − logit(v4) on every feature above plus v4's absence charges, games since each side's last mid-season arrival, month, team age and v4's own logit; HC1 SE; R² 0.097):

| Block | R² lost when dropped | R² alone | Main coefficients (logit, SE) |
|---|---:|---:|---|
| v4's listed-absence charges | 0.029 | 0.013 | home charge −0.057 (0.008), away +0.048 (0.008) per point |
| v4's own logit | 0.019 | 0.002 | −0.102 (0.014): the market is less extreme (at Stage A's scale 13) |
| Contention after Mar 1 / last 14 days | 0.015 | 0.005 | +0.178 (0.028) / −0.04 (0.06) |
| Month | 0.010 | 0.009 | Oct-Jan +0.09 to +0.12 against April (the market is more pro-home early) |
| Games since last arrival | 0.005 | 0.004 | away −0.0027 (0.0008) per game (home 0.0001, 0.0008) |
| Travel | 0.005 | 0.006 | home zones east +0.045 (0.022) |
| Blowouts | 0.006 | 0.005 | beyond 20 −0.026 (0.006), beyond 30 +0.049 (0.013) |
| Rest | 0.006 | 0.007 | none with |t| > 1.7: the market prices back-to-backs as v4 does |
| v1 − v4 logit | 0.009 | 0.000 | +0.133 (0.027): the market sits about an eighth of the way toward v1 |
| Recent v4 error | 0.003 | 0.003 | last 10 +0.059 (0.023) |
| Altitude | 0.001 | 0.002 | +0.042 (0.026) |
| 3PM luck, team home court | < 0.001 | < 0.001 | none |
| Team age (mean, ≤ 23 share, ≥ 32 share) | 0.019 | 0.013 | mean age −0.014 (0.006) per year, young share −0.146 (0.047), old share +0.249 (0.048) |

Reading: per point v4 charges a side for listed absences, the market moves a further 0.05 to 0.06 logit (about 0.35 points) the same way. v4's own residuals say the same in-sample: on 2021-22 to 2023-24 a point of v4's net absence charge leaves **−0.42 points (SE 0.13)** in the home team's residual (v4 charges roughly 70% of what the results show), but by season it is −0.72 (0.24), −0.03 (0.21) and −0.64 (0.25). A held-out check of scaling the charge (exploratory, outside the protocol: report seasons only, so 2022-23 is trained on one season and 2023-24 on two) is **worse**, +6.5 × 10⁻⁴ (−0.1, +12.8), because of the season in the middle. The tanking and altitude leans match the in-sample residuals. The age lean (the market rates teams with more minutes from players 32 or older higher, and younger ones lower, than v4) has no counterpart in v4's residuals (section 3, i; if anything older teams do slightly worse than v4 expects, the opposite lean), and neither do the roster-change and month leans, as far as the held-out test can see. About 90% of the disagreement is unexplained by anything measured here: it is whatever the market prices per matchup (news after the final report, lineup decisions, motivation, injuries not on the report) that leaves no trace in these features.

## 5. Combined ceiling

Rule fixed before any result was read: a candidate "holds up" if its held-out Brier interval lies wholly below zero. **None does** (altitude's upper end is +0.02 × 10⁻⁴). By that rule the combined ceiling is zero.

To give the lead an upper estimate anyway, two further models under the same protocol:

| Model | Features | ΔBrier × 10⁻⁴ vs recalibrated v4 (95% CI) | ΔLog loss × 10⁻⁴ (95% CI) | ΔBrier vs raw v4 (95% CI) | Seasons better |
|---|---|---|---|---|---:|
| Lenient rule, **chosen after seeing the results**: held-out Brier and log loss both negative and an in-sample |t| ≥ 2 | altitude, previous meeting, three-point makes for and against | −3.3 (−6.2, −0.6) | −6.5 (−13.0, −0.3) | −2.4 (−6.0, +1.2) | 4 of 6 |
| Every candidate at once (a2 left out: it is a linear combination of a1) | 38 columns | +10.7 (+1.3, +20.3) | +24.4 (+2.5, +46.4) | +11.6 (+2.2, +21.3) | 1 of 6 |

The lenient model is selected on the same held-out seasons it is scored on, so −3.3 is biased toward a gain; per season it is +0.2, −3.1, −5.8, +2.3, −8.6, −5.0. Even taken at face value it is about a fifteenth of the market's 50 × 10⁻⁴, and against raw v4 its interval includes zero. Putting everything in loses clearly: with these signal sizes the second stage fits noise faster than it finds signal. An upper estimate of what clean mechanisms for every candidate could deliver is **about 2 to 3 × 10⁻⁴ Brier, most of it altitude**, and none of it is established.

## 6. What I could not do, and every departure from the brief

1. **Three-point percentage and free-throw percentage.** The v4 player-line files hold points, FGA, FTA and 3PM (`V4_BOX_STATS`), not 3PA or FTM, and dev-data has no other loader with them. Candidate e uses three-point *makes* against the team's own 82-game baseline, in points (3 × makes), for and against; this mixes attempt volume with make luck, so it is a weaker test of the luck hypothesis than the brief asked. **Opponent free-throw percentage was not done.**
2. **The primary comparison is against recalibrated v4** (the same second stage without features), so the gain isolates the feature; gains against raw v4 are stored and differ by the recalibration's +0.9 × 10⁻⁴.
3. **Residual-based features (c, d) start in 2015-16**, the first season the rolling-origin table covers; earlier forecasts would be in-sample for the fits. Team home court needs 41 prior home and 41 prior road games, else 0 (a rule fixed before any result).
4. **Contention** was defined before any result was read: a team is out when it is 6 or more games behind the last postseason place of its conference (8th through 2019-20, 10th from 2020-21) at the start of the date; the definition was not varied.
5. **Venues.** Arena coordinates written down by hand (Detroit, Golden State and Sacramento moves dated; Lakers and Clippers share one arena; Toronto's 2020-21 home games placed in Tampa). Every game flagged neutral (the 2019-20 restart and a handful of international and Cup games, 110 regular-season games from 2012-13 to 2023-24) has an unknown venue: travel features are 0 for it, for each team's next game and for each team's season opener (2.4% of scored team-games together). Time zones use standard offsets (no daylight time; Phoenix is treated like Denver). Altitude counts Denver and Utah home games only.
6. **Age weights** are the minutes in each team's first five regular-season games (v4's own opening-roster rule, which uses who played in games 1 to 5; it reaches up to five games ahead for membership only). Age is at the season's first regular-season date. All 1,709 players had a date of birth; minutes coverage was complete.
7. **Roster change** is a player's first appearance for a team after appearing for another team earlier in the same season (from the lines; a traded player who has not yet played is not seen).
8. **Market subset** is Stage A's: spread games inside v2's 3,690, which are 2021-22 and 2022-23 only; the scale 13 was chosen by Stage A on these same games, so the market's number is mildly flattered. Section 4's regressions are in-sample with HC1 SE, not clustered by date.
9. **In-sample coefficients use all nine seasons**, including the held-out ones; they show direction only.
10. **The "lenient" ceiling rule in section 5 was chosen after seeing the candidate results** (disclosed there).
11. **Format peek.** Before writing the loaders I opened two open-season raw files directly with Python (2020-21 games, 2021-22 spreads) to see their format, outside dev-data. Both are open seasons; nothing closed was touched. All numbers come through dev-data.
12. One data quirk: Golden State has two games dated 2020-03-01 ET in the game list (rest −1); clipped to 0.

## 7. Follow-up (lead's request): does v4 convert an absence into too few points?

Same rules: rolling origin (origin-S ratings, Stage A's status tables), open seasons only, everything in the out folder (`told.ts`, `told_analysis.py`, `variant.ts`, `variant_analysis.py`; `results-told.json`, `results-variant.json`).

**Two "told" sets, and why.** Stage A's reported-only "told who plays" (`toldProbability` in `evaluate-stage-a.ts`) weights each player by **the minutes he actually played in that game** (w = 5 × minutes / team minutes). That is the same thing as 7c's "v4 with each player's actual minutes as weights": it carries game flow (starters rest in blowouts, foul trouble, overtime). So I report two sets:
- **Told, actual minutes** (Stage A's exactly; contaminated by game flow).
- **Told participation** (mine, the clean test): v4's own expected-minutes rule over exactly the players who played: each player's running average (12 if he has none), presence 1, rescaled to 240. Who played is known, and how long he played is not used. Who played is itself mildly affected by game flow (deep-bench players who enter only in garbage time count as playing), but only at their small averages.

Both use the same filter state, v4's c_t and the same single-component probability as Stage A's told. **Reproduction:** Stage A's told on 2021-22 to 2023-24: 3,547 games, Brier **0.211873**, exact. Over 2015-16 to 2023-24 both told sets exist on 9,845 games. The missing ones are games without usable lines on a side (Chicago and New Orleans 2012-13 to 2017-18) or with a played player not yet in the state, as in Stage A.

**A, the absence charge.** For each side, A = S_full − S_told, where S = Σ w_p θ_p over players (posterior means of the state before the game). w_full comes from `fullHealthTerms` (each member's raw expected minutes with listed players at presence 1 and unlisted absentees still fading, as M6 uses it), rescaled to 5. w_told comes from the told-participation weights (or the actual-minutes weights for the actual set). The team residual c_T and pseudo-player cancel. A is positive when the players who sat are worth more than their replacements' minutes. Mean |A| is 0.67 points per side (told participation) and 0.89 (actual minutes).

### 7a. Regression of the told residual on (A_away − A_home)

The told residual is the final margin minus the told expected margin, home view. OLS with HC1 SE.

| Season | Told participation: coefficient (SE) | Actual minutes: coefficient (SE) |
|---|---|---|
| 2015-16 | +0.43 (0.33) | +0.04 (0.27) |
| 2016-17 | +0.06 (0.42) | −0.20 (0.34) |
| 2017-18 | +0.30 (0.44) | −0.06 (0.36) |
| 2018-19 | −0.49 (0.33) | −0.65 (0.28) |
| 2019-20 | −0.11 (0.34) | −0.20 (0.28) |
| 2020-21 | +0.38 (0.28) | −0.01 (0.24) |
| 2021-22 | +0.46 (0.22) | +0.27 (0.21) |
| 2022-23 | +0.07 (0.18) | −0.01 (0.16) |
| 2023-24 | +0.34 (0.21) | +0.11 (0.19) |
| **Pooled (9,845)** | **+0.214 (0.089)**, same sign in **7 of 9** | −0.008 (0.078), 6 of 9 negative |

With told participation, each point v4 says an absence costs turns into about 1.2 points in the result (t = 2.4, 7 of 9 seasons). That meets the lead's bar for 7b, with nothing to spare. With actual minutes the effect vanishes, as game flow predicts: in a blowout the winner's starters sit, which raises the winner's A and its residual together, biasing the coefficient down. The clean set is the right test, and garbage-time entries, its one trace of game flow, push the same way (down), so its coefficient is if anything biased toward zero.

**By tier of the absentee** (joint regression on three A differences, each built by removing only that tier's absentees from the full-health weights; tier = full-health expected minutes):

| Absentee's expected minutes | Coefficient (SE) | Same sign | Games with such an absence | SD of the difference |
|---|---|---:|---:|---:|
| ≥ 28 (stars) | **+0.58 (0.19)** | **8 of 9** | 20% | 0.74 |
| 20 to 28 | +0.29 (0.18) | 5 of 9 | 43% | 0.78 |
| < 20 (depth) | +0.15 (0.17) | 7 of 9 | 99.7% | 0.76 |

The shortfall is in stars. When a 28-minute player sits, the team loses about 1.6 times the points v4's state says he is worth over his replacements, consistently across seasons (2015-16 to 2023-24: +0.88, +0.54, +1.24, +0.63, +0.65, +0.57, +0.24, −0.04, +1.36). Depth absences are close to correctly charged.

### 7b. The capped-minutes variant: null

How it was injected: no repository file was edited. The filter's updates never read a forecast (they use each game's actual minutes), so the expected-minutes rule matters only at forecast time. Its only path back into the state is M5's scale window. `variant.ts` therefore runs the unchanged replay and, in its `onForecast` hook, recomputes each game's forecast outside the engine. It uses the engine's exported pieces (`minutesTerms`, `teamRows`, `availabilityConfigurations`, `estimateScale`, `mixtureProbability`, `gameOffsets`, the state's means and covariance) with the rescaling step swapped. The variant keeps its own M5 window (same rule: 3,000 regular games of earlier dates, 1 until 1,000) and is also scored at v4's own c_t. Check: with v4's rescaling, the reimplementation reproduces `forecast.homeWinProbability` on every game of all nine seasons (max difference 0).

The rule, one setting with no search: rescale to 240 as v4 does, cap each player at min(1.15 × running average, 40), give the excess to the uncapped active players in proportion to their running averages, and iterate; if everyone is capped and the sum is short of 240, lift the cap. Same parameters as v4, no refit.

| Information set | Games | v4 rule → variant Brier | ΔBrier × 10⁻⁴ (95% CI) | ΔLog loss × 10⁻⁴ (95% CI) | Seasons better | Games changed |
|---|---:|---|---|---|---:|---:|
| Told participation, 2015-16 to 2023-24 | 9,845 | 0.210316 → 0.210297 | −0.19 (−0.51, +0.14) | −0.41 (−1.13, +0.33) | 7 of 9 | 18% (mean \|Δp\| 0.0004) |
| Report, 2021-22 to 2023-24 (own c_t) | 3,690 | 0.212932 → 0.213033 | +1.00 (−1.90, +4.00) | +3.95 (−2.68, +11.04) | 1 of 3 | mean \|Δp\| 0.0031 |
| Report, 2021-22 to 2023-24 (v4's c_t) | 3,690 | 0.212932 → 0.213038 | +1.06 (−1.80, +4.05) | +4.16 (−2.42, +11.05) | 1 of 3 | 35% |
| Extra: no-report seasons 2015-16 to 2020-21 (own c_t) | 7,059 | 0.211671 → 0.211671 | +0.01 (−0.09, +0.11) | +0.01 (−0.25, +0.28) | 4 of 6 | mean \|Δp\| 0.00002 |

Per season, told: +1.2, +0.2, −0.1, −0.7, −0.3, −0.4, −0.2, −0.7, −0.5; report: +0.7, −1.0, +3.3. **The minutes-redistribution mechanism is not where 7a's shortfall comes from.** When v4 knows who plays, the cap rarely binds (a team missing one or two players scales the rest by about 10%, under the 15% cap), and the small told gain (7 of 9 seasons, interval includes zero) is far smaller than 7a's effect. Under the report set the variant is slightly worse. Since the shortfall sits in stars and not in how their minutes are reassigned, the next hypothesis is that the filter's θ for high-minute players is shrunk toward the mean. Stars would then be under-rated in absence (the charge) but not in presence, because their minutes are then on both sides of the comparison. **I did not test this.**

### 7c. What knowing participation recovers

Paired with v4's report-set forecast on the 9,845 games with both told sets (Brier; gain × 10⁻⁴ with 95% CI):

| Month | Games | v4 | Told participation (gain) | Actual minutes, contaminated bound (gain) |
|---|---:|---:|---|---|
| Oct-Nov | 2,160 | 0.2132 | 0.2114 (−18.3; −28.0, −8.6) | 0.2121 (−11.1; −24.3, +2.0) |
| Dec | 1,652 | 0.2181 | 0.2159 (−21.9; −35.9, −7.5) | 0.2158 (−23.2; −42.0, −4.2) |
| Jan | 1,857 | 0.2142 | 0.2131 (−11.0; −24.9, +3.3) | 0.2136 (−6.6; −23.6, +11.5) |
| Feb | 1,414 | 0.2090 | 0.2071 (−19.0; −35.7, −2.7) | 0.2072 (−17.6; −38.1, +2.2) |
| Mar | 1,753 | 0.2089 | 0.2060 (−28.5; −42.3, −15.1) | 0.2056 (−32.4; −51.3, −14.0) |
| Apr | 1,009 | 0.2097 | 0.2057 (−39.7; −66.9, −13.9) | 0.2051 (−45.6; −81.6, −12.8) |
| **Pooled** | **9,845** | **0.21248** | **0.21032 (−21.6; −27.5, −15.7)** | **0.21043 (−20.5; −28.3, −12.6)** |

For 2015-16 to 2020-21 v4 has no reports at all, so most of the pooled gain there is "knowing who plays" against "knowing nothing". On the report seasons the gain is smaller (Stage A: −10 × 10⁻⁴). The gain grows late in the season, as the market's advantage does (section 4), consistent with rest and shutdowns that no report anticipates. The actual-minutes bound is no better than told participation: weighting by actual minutes adds noise from game flow and no information.

**On the spread games**, thirds as in section 4 (restricted to the 2,362 of 2,460 with both told sets):

| Third of \|market − v4\| | Games | v4 | Market (market − v4) | Told participation (gain, CI) | Actual minutes (gain, CI) |
|---|---:|---:|---|---|---|
| Small | 794 | 0.2079 | 0.2075 (−3.6) | 0.2070 (−9.0; −23.1, +5.1) | 0.2082 (+2.7; −16.5, +21.6) |
| Middle | 794 | 0.2142 | 0.2139 (−2.9) | 0.2126 (−15.9; −30.6, −1.7) | 0.2128 (−14.7; −33.9, +6.2) |
| **Large** | 774 | 0.2306 | 0.2175 (**−130.9**) | 0.2283 (**−23.4**; −44.2, −2.4) | 0.2279 (−27.3; −60.7, +4.0) |
| All | 2,362 | 0.2175 | 0.2130 (−45.1) | 0.2159 (−16.0; −25.3, −6.2) | 0.2162 (−13.0; −27.9, +1.3) |

**Knowing participation does not recover the market's edge where it lives.** In the largest-disagreement third it recovers about 23 of 131 × 10⁻⁴ (about a sixth). Over all spread games it recovers 16 of 45 (about a third), much of that in the two thirds where the market has no edge (there, told v4 beats the market). Even given who plays, and even given the minutes each played, v4 stays about 0.012 Brier behind the market in that third. That agrees with the lead's split: most of the edge is game-specific, and it is not mostly lineup knowledge. Part of what remains is 7a's star shortfall (v4 under-charges a star's absence even when it knows he sits), but at +0.58 points per point on 20% of games that cannot reach 0.012 on the large third. The rest is not identified here.

## 8. Spike: v4 plus an on-court observation (lead's request)

**Status: a disclosed spike on development seasons, chosen because of section 7.** One observation form, one grid of its noise, no other variant, no second attempt. Nothing in the repository was edited. Code: `/Users/bilguutei/dev/548-research-out/pm_build.py`, `pm_audit.py`, `roster-state-spike.ts`, `spike-run.ts`, `spike_analysis.py`; outputs `pm-*.json`, `results-pm-audit.json`, `spike/run-*.json`, `results-spike.json`.

### 8.1 Data and audit

Source, read-only: `/Users/bilguutei/dev/548-score/data/historical/raw/score/`. Only the season files 2011 to 2024 were opened: `summaries/{season}/*.json.gz` and `games/{season}.json.gz`. A directory listing showed that 2025 and 2026 entries exist; none was opened. Per game, the plus/minus comes from **the ESPN summary's box score `+/-` when both teams' sums equal exactly 5 × the final margin**. Otherwise it comes from **the built game's stints** (548-score), when they exist, were not rejected by their own audit and pass the same check (each player's plus/minus is the sum over his stints of team points minus opponent points). If neither passes, the game is dropped. Players are matched to v4's lines by ESPN athlete id and game id. The summaries cover regular-season games only, so the observation never enters playoff games.

| Season | Games | Box passes | Stints used | Dropped | Player-games on sides with usable lines | With usable +/- | Of which from stints | Observations (0.15 ≤ f ≤ 0.90) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 2010-11 | 1,230 | 1,158 | 49 | 23 | 25,027 | 98.2% | 3.9% | 21,869 |
| 2011-12 | 990 | 931 | 42 | 17 | 20,669 | 98.3% | 4.0% | 18,114 |
| 2012-13 | 1,229 | 978 | 38 | 213 | 22,203 | 95.7% | 3.5% | 18,744 |
| 2013-14 | 1,230 | 998 | 60 | 172 | 22,128 | 99.2% | 5.3% | 19,533 |
| 2014-15 | 1,230 | 1,013 | 45 | 172 | 22,552 | 99.0% | 4.0% | 20,090 |
| 2015-16 | 1,230 | 966 | 33 | 231 | 22,663 | 93.5% | 3.0% | 19,002 |
| 2016-17 | 1,230 | 1,005 | 44 | 181 | 22,657 | 98.3% | 4.0% | 20,035 |
| 2017-18 | 1,230 | 1,035 | 26 | 169 | 22,605 | 99.5% | 2.3% | 20,293 |
| 2018-19 | 1,230 | 1,168 | 28 | 34 | 26,035 | 97.1% | 2.2% | 22,729 |
| 2019-20 | 1,059 | 1,031 | 25 | 3 | 22,317 | 99.7% | 2.3% | 20,102 |
| 2020-21 | 1,080 | 1,041 | 36 | 3 | 22,969 | 99.8% | 3.1% | 20,251 |
| 2021-22 | 1,230 | 1,203 | 27 | 0 | 25,955 | 100.0% | 2.1% | 23,003 |
| 2022-23 | 1,230 | 1,202 | 25 | 3 | 25,818 | 99.8% | 1.9% | 22,863 |
| 2023-24 | 1,230 | 1,192 | 36 | 2 | 26,283 | 99.8% | 2.7% | 22,835 |

The dropped games in 2012-13 to 2017-18 are mostly the Chicago and New Orleans games, whose box scores are zeros. Their own sides have no v4 lines at all, so they are not counted in the player-game denominator; their opponents' sides are, and are covered only where the stints pass. Athlete-id mismatches inside games that passed: 3 player-games, all in 2019-20.

### 8.2 The observation

For a player p in a regular-season team-game with usable lines and a passing plus/minus, with on-floor share f = m_p / T between 0.15 and 0.90: T is the game's minutes (the team's line minutes ÷ 5), M the team's final margin (uncapped) and PM his plus/minus. Then **y = 48 × (PM / m_p − (M − PM) / (T − m_p))**, observed as **θ_p − Σ_{q≠p} (m_q / Σ_{q≠p} m_q) θ_q + N(0, s3² / (f (1 − f)))**, with teammates q the players with minutes in that game. The observation enters the same joint Kalman update as that game's margin and box observations, in `roster-state-spike.ts`, a copy of `roster-state.ts` with the imports pointed at the worktree and one block added before `jointUpdate`; everything else is byte-identical. **Known weakness:** the on/off observations of a team's players in one game share stints and are treated as independent; s3 absorbs part of that. **Check:** with the observation off, the copy reproduces v4's probability exactly (max difference 0) on every game of all nine scored seasons, and origin 2015-16's training log loss equals the frozen fit's 0.588055.

**Fit:** every v4 parameter is at its frozen per-origin value. For each origin S, s3 ∈ {off, 80, 60, 45, 35, 25} is chosen by regular-season log loss on 2012-13 to S − 1, and the same replay gives S's held-out forecasts.

### 8.3 Chosen s3 by origin (training log loss, regular seasons 2012-13 to S − 1)

| Origin (scored season) | off | 80 | 60 | 45 | 35 | 25 | Chosen |
|---|---:|---:|---:|---:|---:|---:|---|
| 2015-16 | **0.588055** | 0.588083 | 0.588107 | 0.588160 | 0.588256 | 0.588570 | off |
| 2016-17 | **0.586252** | 0.586256 | 0.586263 | 0.586284 | 0.586336 | 0.586544 | off |
| 2017-18 | 0.593323 | 0.593310 | 0.593304 | **0.593300** | 0.593310 | 0.593412 | 45 |
| 2018-19 | 0.595676 | 0.595665 | **0.595661** | 0.595662 | 0.595681 | 0.595810 | 60 |
| 2019-20 | 0.596569 | 0.596548 | 0.596536 | 0.596522 | **0.596517** | 0.596581 | 35 |
| 2020-21 | 0.599039 | 0.599024 | 0.599016 | **0.599009** | 0.599014 | 0.599099 | 45 |
| 2021-22 | 0.602759 | 0.602751 | **0.602748** | 0.602749 | 0.602766 | 0.602874 | 60 |
| 2022-23 | 0.603877 | 0.603850 | 0.603833 | 0.603809 | **0.603787** | 0.603800 | 35 |
| 2023-24 | 0.606641 | 0.606606 | 0.606582 | 0.606545 | 0.606505 | **0.606474** | 25 |

The observation is switched off (off chosen) at origins 2015-16 and 2016-17, whose training seasons are 2012-13 to 2015-16, where the plus/minus coverage is worst. It switches on from 2017-18 and tightens as the training span grows (45, 60, 35, 45, 60, 35, 25). The smallest grid value is chosen only at the last origin (2023-24), not at most origins, so the grid was not extended. Training gains are small: at most 0.00017 log loss (origin 2023-24).

### 8.4 Results against v4 (rolling origin; 2,000-draw bootstrap over ET dates; changes × 10⁻⁴; per-season values in season order)

| Set | Games | Brier v4 → spike | ΔBrier (95% CI) | Log loss v4 → spike | ΔLog loss (95% CI) | Per season ΔBrier |
|---|---:|---|---|---|---|---|
| 1. Standard information set, 2015-16 to 2023-24 (headline) | 10,749 | 0.212104 → 0.211993 | **-1.11** (-1.80, -0.42) | 0.612151 → 0.611905 | -2.47 (-4.05, -0.92) | +0.0, +0.0, -0.3, -0.9, +0.9, +0.7, -1.9, -2.8, -5.1 |
| 2a. Report era, 2021-22 to 2023-24 | 3,690 | 0.212932 → 0.212604 | **-3.28** (-4.86, -1.64) | 0.613737 → 0.613017 | -7.19 (-10.77, -3.41) | -1.9, -2.8, -5.1 |
| 2b. Clean told participation (7a's set) | 9,845 | 0.210316 → 0.210172 | **-1.44** (-2.22, -0.68) | 0.608071 → 0.607754 | -3.16 (-4.94, -1.35) | +0.0, +0.0, +0.1, -1.3, -2.4, +0.2, -1.8, -1.7, -5.3 |
| 4b. Games before December 1 | 2,467 | 0.213504 → 0.213292 | **-2.13** (-3.55, -0.79) | 0.615486 → 0.615025 | -4.62 (-7.73, -1.66) | +0.0, +0.0, +1.2, -0.6, -5.5, -1.3, -3.1, -7.2 |
| 5a. Spread games | 2,460 | 0.217260 → 0.217023 | **-2.38** (-3.69, -1.21) | 0.624182 → 0.623680 | -5.02 (-8.10, -2.27) | -1.9, -2.8 |

1. **Headline:** −1.11 (−1.80, −0.42) Brier and −2.47 (−4.05, −0.92) log loss on the 10,749 games. Better in 5 seasons, worse in 2 (2019-20 +0.9, 2020-21 +0.7), identical in the 2 where the observation is off. Most of the gain is in the last three seasons, where the training span (and the chosen weight) is largest: −1.9, −2.8, −5.1.
2. **Report era:** −3.28 (−4.86, −1.64), better in 3 of 3. **Told participation:** −1.44 (−2.22, −0.68).
3. **7a's regression under the spike: the star shortfall does not fall.** Pooled +0.214 (0.089) → +0.197 (0.088), same sign 7 of 9. The 28+ tier goes +0.580 (0.190) → **+0.565 (0.187)**, same sign 8 of 9 (per season +0.88, +0.54, +1.20, +0.66, +0.71, +0.56, +0.24, -0.05, +1.24). The 20 to 28 tier goes +0.289 → +0.274, under 20 +0.149 → +0.105. Mean |A| per side 0.671 → 0.676. The on-court evidence improves forecasts a little, but it does not make v4 charge a star's absence more: whatever under-charges stars is not fixed by this observation at these weights.
4. **Calibration**, 2019-20 to 2023-24 (5,829 games, A3's form): slope v4 0.987 → spike 0.988, grouped reliability 0.00013 → 0.00022 (both far inside A3's 0.93 to 1.07 and 0.002; v4's reproduce Stage A's 0.987 and 0.00013). **Before December 1:** −2.13 (−3.55, −0.79).
5. **Market gap on the 2,460 spread games:** v4 0.00500 (0.0023, 0.0078) → spike **0.00476** (0.0021, 0.0075). That closes 0.00024 of 0.0050, about 5%. In the largest-disagreement third the gap goes 0.0143 → 0.0139; in the small and middle thirds 0.00041 → 0.00017 and 0.00035 → 0.00024.

### 8.5 Sanity: what changed in the ratings (end of 2023-24, origin 2023-24, s3 = 25, against v4 off)

Among the 267 players with 1,000+ regular-season minutes in 2023-24, the two rating sets correlate 0.990 (SD 1.70 → 1.77 points per 100). The change correlates +0.11 with minutes and +0.11 with the team's wins. The largest moves are under 0.9 points.

- **Up most (20):** Kris Murray (POR) -2.61 → -1.84; Aaron Gordon (DEN) +0.02 → +0.71; Toumani Camara (POR) -2.36 → -1.73; Nikola Jokic (DEN) +6.40 → +6.99; Isaiah Joe (OKC) -0.12 → +0.48; Dante Exum (DAL) +0.29 → +0.84; Michael Porter Jr. (DEN) +0.42 → +0.96; Isaiah Hartenstein (NY) +0.10 → +0.62; Brandin Podziemski (GS) -0.72 → -0.20; Immanuel Quickley (TOR) +1.64 → +2.16; Jose Alvarado (NO) +0.81 → +1.32; Kentavious Caldwell-Pope (DEN) -0.54 → -0.04; Bogdan Bogdanovic (ATL) +1.03 → +1.43; Darius Garland (CLE) +1.34 → +1.72; Brook Lopez (MIL) -0.08 → +0.30; Dereck Lively II (DAL) -0.72 → -0.35; Jusuf Nurkic (PHX) +0.88 → +1.26; OG Anunoby (NY) +0.30 → +0.64; Paul George (LAC) +2.89 → +3.22; Franz Wagner (ORL) +0.77 → +1.09.
- **Down most (20):** Peyton Watson (DEN) -1.52 → -2.38; Christian Braun (DEN) -1.43 → -2.25; Torrey Craig (CHI) -1.65 → -2.27; Paolo Banchero (ORL) +1.39 → +0.83; Scoot Henderson (POR) -1.38 → -1.92; Ayo Dosunmu (CHI) -1.08 → -1.59; Cason Wallace (OKC) -0.66 → -1.14; Tyus Jones (WSH) +2.22 → +1.77; Nikola Vucevic (CHI) +0.81 → +0.36; Patrick Williams (CHI) -1.43 → -1.85; Jabari Smith Jr. (HOU) -1.28 → -1.71; Bojan Bogdanovic (NY) -0.39 → -0.80; Killian Hayes (DET) -1.00 → -1.41; Amir Coffey (LAC) -1.52 → -1.94; RJ Barrett (TOR) -0.64 → -1.01; Jeff Green (HOU) -1.32 → -1.69; Bruce Brown (TOR) -1.08 → -1.45; Jaden Ivey (DET) -1.00 → -1.36; Bennedict Mathurin (IND) -1.84 → -2.20; Cedi Osman (SA) -0.52 → -0.88.

The pattern is partly the predicted kind. Denver's starters (Jokic, Gordon, Porter Jr., Caldwell-Pope) rise and Denver's bench (Watson, Braun) falls most of all; Oklahoma City's Joe rises and Wallace falls. But it is not uniformly "high-minute players on good teams up": two Portland rookies on a 21-win team (Murray, Camara) are among the top risers, and Banchero falls. The correlation with minutes and wins is weak (+0.11 each). The spread widens slightly. This was read to check the direction, not to tune anything.

### 8.6 Reading

A real but small gain. The on-court observation lowers held-out Brier by about 1 × 10⁻⁴ over 2015-16 to 2023-24 (interval excludes zero) and about 3 × 10⁻⁴ in the report era. Its log loss gain is consistent, it is calibrated and it is better before December 1. It is selected by training loss with one parameter, and it is off where the early plus/minus data is poor. It does **not** test the lead's mechanism positively. The star shortfall from section 7 barely moves (+0.58 → +0.565), and the market gap closes by about 5%. Teammate credit-sharing is at most a small part of why stars are under-charged; the remaining candidates (the filter's shrinkage of high-minute players, or replacements doing worse than their ratings when a star sits, i.e. an interaction the linear model cannot express) are untested. Disclosures: a spike on development seasons chosen because of section 7; one form and one grid, no second attempt; shared stints make each game's on/off observations dependent, which s3 absorbs; the plus/minus covers regular-season games only; intervals use 2,000 draws rather than Stage A's 10,000.

## 9. Second mechanism after section 7: minutes as evidence about a player (lead's request)

**Status: the second mechanism tried after section 7. The first was section 8's on/off observation.** A disclosed spike on development seasons: one form, one grid, no extension, no second attempt. Same harness as section 8 (`roster-state-spike.ts`, now with `SPIKE.betaM`; section 8's version is kept as `spike/roster-state-spike.section8.ts`), same rules, nothing in the repository edited. Outputs: `spike/run-*-bm*.json`, `results-spike9.json`, `spike9_analysis.py`.

**One-line answer: βm is chosen 0 at the last three origins and is small elsewhere, and the 28+ coefficient does not fall (+0.580 → +0.562 with the minutes term alone). In this form, minutes as evidence is not why stars are under-charged.**

**The change.** In observation 2 only (box deviation; eligibility unchanged: minutes ≥ 5, full lines), the observed value becomes Σ_k β_k (x_pk − x̄_Tk) + βm × (m_p − m̄_T) / 10. Here m_p = minutes × 48 / game minutes (game minutes = team line minutes / 5). m̄_T = Σ_q (minutes_q / team minutes) × m_q over every player with minutes in that team-game, including those under 5. These are the weights x̄_Tk already uses: v4's x̄_Tk = 100 × team total / (5 × game possessions), which equals the mean of the players' per-100 rates weighted by minutes / team minutes. Noise unchanged (sBox² × 30 / minutes). **Check:** with βm = 0 the copy reproduces v4 exactly on all 10,749 games (max difference 0), and each origin's βm = 0 training loss equals v4's.

### 9.1 Chosen βm by origin (training log loss, 2012-13 to S − 1)

| Origin | 0 | 0.25 | 0.5 | 0.75 | 1.0 | 1.5 | Chosen |
|---|---:|---:|---:|---:|---:|---:|---|
| 2015-16 | 0.588055 | **0.588037** | 0.588052 | 0.588102 | 0.588185 | 0.588447 | 0.25 |
| 2016-17 | 0.586252 | 0.586206 | **0.586184** | 0.586187 | 0.586215 | 0.586341 | 0.5 |
| 2017-18 | 0.593323 | 0.593257 | 0.593217 | **0.593202** | 0.593213 | 0.593308 | 0.75 |
| 2018-19 | 0.595676 | 0.595630 | **0.595612** | 0.595620 | 0.595655 | 0.595800 | 0.5 |
| 2019-20 | 0.596569 | **0.596562** | 0.596587 | 0.596642 | 0.596726 | 0.596981 | 0.25 |
| 2020-21 | **0.599039** | 0.599048 | 0.599087 | 0.599155 | 0.599251 | 0.599526 | 0 |
| 2021-22 | 0.602759 | **0.602743** | 0.602756 | 0.602796 | 0.602864 | 0.603078 | 0.25 |
| 2022-23 | **0.603877** | 0.603890 | 0.603940 | 0.604024 | 0.604143 | 0.604475 | 0 |
| 2023-24 | **0.606641** | 0.606646 | 0.606685 | 0.606756 | 0.606859 | 0.607154 | 0 |

βm is nonzero at 6 of 9 origins (0.25 to 0.75), never at the grid's top, and 0 at the last three. The training gains are at most 0.00012.

### 9.2 Minutes term alone against v4 (rolling origin; 2,000-draw date bootstrap; × 10⁻⁴)

1. **Standard set (10,749):** Brier -0.08 (-0.59, +0.41), log loss -0.22 (-1.42, +0.90); better in 3, worse in 3, identical in 3 seasons (per season +0.5, -0.3, -0.7, +0.2, +0.5, +0.0, -0.9, +0.0, +0.0). **Report era (3,690):** -0.29 (-0.63, +0.08). **Told participation:** -0.51 (-0.99, -0.03).
2. **7a under the minutes term:** pooled +0.214 → +0.199 (0.088), same sign 7 of 9. **28+ tier +0.580 → +0.562 (0.185)**, same sign 8 of 9; 20 to 28 +0.289 → +0.274; under 20 +0.149 → +0.122. It does not fall materially.
3. **Calibration** (2019-20 to 2023-24): slope 0.987, reliability 0.00018 (v4 0.987, 0.00013). **Before Dec 1:** -0.72 (-1.78, +0.37). **Market gap:** 0.00500 → 0.00496; largest third 0.0143 → 0.0142.

### 9.3 The 2 × 2 (each parameter at the value chosen alone; no joint search)

| Cell | Standard ΔBrier (95% CI) | Standard ΔLog loss | Report era ΔBrier | Told ΔBrier | 28+ coefficient (SE), same sign |
|---|---|---|---|---|---|
| v4 | 0 | 0 | 0 | 0 | +0.580 (0.190), 8 of 9 |
| On/off alone (section 8's s3) | -1.11 (-1.80, -0.42) | -2.47 (-4.05, -0.92) | -3.28 (-4.86, -1.64) | -1.44 (-2.22, -0.68) | +0.565 (0.187), 8 of 9 |
| Minutes term alone (βm above) | -0.08 (-0.59, +0.41) | -0.22 (-1.42, +0.90) | -0.29 (-0.63, +0.08) | -0.51 (-0.99, -0.03) | +0.562 (0.185), 8 of 9 |
| Both | -1.18 (-2.02, -0.34) | -2.66 (-4.63, -0.75) | -3.56 (-5.24, -1.90) | -1.92 (-2.88, -1.00) | +0.548 (0.183), 8 of 9 |

Both together: better in 6, worse in 3 seasons (per season +0.5, -0.3, -0.9, -0.7, +1.4, +0.7, -2.8, -2.8, -5.1); calibration 0.988 / 0.00024; before Dec 1 -2.81 (-4.53, -1.02); market gap 0.00472 (largest third 0.0138). The minutes term adds −0.07 standard and −0.28 report era on top of on/off, inside every interval. All of the gain in the 2 × 2 is section 8's.

### 9.4 Sanity: ratings

At origin 2023-24 the chosen βm is 0, so **the chosen variant's end-of-2023-24 ratings are identical to v4's** (correlation 1). To show what the term does, the run at βm = 0.25 for that origin (the value chosen at three other origins; labelled illustration, not the chosen model), among the 267 players with 1,000+ minutes: correlation with v4 0.9996; correlation of the change with minutes per game **+0.90**; SD 1.70 → 1.73.
- **Up most (10):** Paolo Banchero 35.0 min, +1.39 → +1.55; Luka Doncic 37.5 min, +7.04 → +7.21; DeMar DeRozan 37.9 min, +2.02 → +2.18; Anthony Edwards 35.1 min, +1.81 → +1.96; Shai Gilgeous-Alexander 34.1 min, +4.42 → +4.57; Mikal Bridges 34.8 min, +0.43 → +0.58; Jayson Tatum 35.8 min, +3.18 → +3.33; Tyrese Maxey 37.5 min, +1.70 → +1.84; De'Aaron Fox 35.9 min, +2.75 → +2.88; Domantas Sabonis 35.7 min, +2.78 → +2.92.
- **Down most (10):** Obi Toppin 21.1 min, -0.15 → -0.24; Drew Eubanks 15.5 min, -1.61 → -1.69; Aaron Holiday 16.3 min, -0.30 → -0.37; Duop Reath 17.9 min, -0.45 → -0.53; Paul Reed 19.4 min, -0.25 → -0.32; Christian Braun 20.2 min, -1.43 → -1.49; Jevon Carter 13.9 min, -0.57 → -0.64; Peyton Watson 18.6 min, -1.52 → -1.58; Isaiah Joe 18.5 min, -0.12 → -0.18; Moritz Wagner 17.7 min, -0.09 → -0.16.

The mechanism moves ratings exactly the predicted way (high-minute stars up, bench players down, almost perfectly ordered by minutes), but by about 0.15 points at the most for βm = 0.25. Training loss does not want more.

### 9.5 Season-level sanity, not a gate: opening-night team strength (full-health sum plus team residual), best cell ("both") against v4

2021-22: correlation 0.9999, mean absolute difference 0.125 points (team SD 3.79); 2022-23: correlation 0.9997, mean absolute difference 0.099 points (team SD 3.93); 2023-24: correlation 0.9986, mean absolute difference 0.148 points (team SD 3.38). Team totals barely move.

### 9.6 Reading, both mechanisms

Two mechanisms were tried after section 7's finding that a star's absence is under-charged by about 0.58 points per point charged (8 of 9 seasons):
1. **On/off evidence (section 8):** a small, real forecast gain (−1.1 × 10⁻⁴ standard, −3.3 report era), with the 28+ coefficient +0.580 → +0.565.
2. **Minutes as evidence (section 9):** no forecast gain (−0.08, interval −0.59 to +0.41), βm 0 at the last three origins, and the 28+ coefficient +0.580 → +0.562.

Together: −1.18 standard, −3.56 report era, 28+ +0.548. Neither mechanism, nor both, explains the star shortfall. Section 8's gain stands on its own. What remains untested: the filter's shrinkage of high-minute players (their prior and process noise are the same as anyone's), and non-additive effects of a star's absence on the players who replace him, which v4's linear sum cannot express. Disclosures as in section 8: development seasons, chosen because of section 7; one form, one grid; 2,000-draw intervals.

## 10. Closing description: is the star shortfall about the player or the night?

A description only: no mechanism, no correction, no held-out test. Data: 7a's clean told-participation set (9,845 games), 28+ tier only (absentees with full-health expected minutes of 28 or more), 2,281 such absences. Same OLS of the told residual, HC1 SE, per-season signs. Code `told10.ts` (7a's replay plus the split), `sec10.py`, output `results-sec10.json`. **Absence length** is the minutes layer's own `missed` counter: team games with usable lines since the player's last appearance for his team, before this game (0 = this is the first game missed).

**A structural limit, read first.** An absence of two or more games can stay in the 28+ tier only when it is on a report. Without a report row, M2 halves an absent player's presence for each team game missed, so after one missed game his full-health expected minutes fall below 28. Report rows exist from 2021-22 only, so every 28+ absence in 2015-16 to 2020-21 is a first game missed. Star absences by season (first / 2 to 4 / 5+): 2015-16 212/0/0; 2016-17 229/0/0; 2017-18 209/0/0; 2018-19 261/0/0; 2019-20 269/0/0; 2020-21 375/0/0; 2021-22 145/64/26; 2022-23 208/57/14; 2023-24 151/54/7.

### Absence length (joint regression on the three cells)

| Cell | Coefficient (SE) | Same sign as pooled | Share of 28+ absences | Per season |
|---|---|---|---:|---|
| first game missed | +0.534 (0.200) | 8 of 9 | 90.3% | 2015-16 +0.86, 2016-17 +0.60, 2017-18 +1.24, 2018-19 +0.64, 2019-20 +0.64, 2020-21 +0.57, 2021-22 +0.16, 2022-23 -0.16, 2023-24 +1.12 |
| 2 to 4 games | +1.000 (0.689) | 3 of 3 | 7.7% | 2021-22 +0.01, 2022-23 +0.68, 2023-24 +2.05 |
| 5 or more | -0.191 (1.228) | 1 of 2 | 2.1% | 2021-22 +0.46, 2022-23 -0.19 |

With the 20 to 28 and under 20 tiers added as controls: +0.556 (0.200), +1.044 (0.691), -0.144 (1.233).

### Second night of a back-to-back (absent team's side) against not

| Cell | Coefficient (SE) | Same sign as pooled | Share of 28+ absences | Per season |
|---|---|---|---:|---|
| second night of a back-to-back | +0.647 (0.300) | 7 of 9 | 29.0% | 2015-16 -0.31, 2016-17 +1.48, 2017-18 +0.71, 2018-19 +1.31, 2019-20 +0.46, 2020-21 +0.89, 2021-22 +0.42, 2022-23 +0.94, 2023-24 -0.08 |
| not | +0.497 (0.240) | 6 of 9 | 71.0% | 2015-16 +2.04, 2016-17 -0.42, 2017-18 +1.36, 2018-19 +0.40, 2019-20 +0.76, 2020-21 +0.33, 2021-22 -0.02, 2022-23 -0.75, 2023-24 +1.83 |

### After March 1 against before

| Cell | Coefficient (SE) | Same sign as pooled | Share of 28+ absences | Per season |
|---|---|---|---:|---|
| after March 1 | +0.388 (0.285) | 8 of 9 | 38.2% | 2015-16 +0.02, 2016-17 +1.10, 2017-18 +1.19, 2018-19 +0.73, 2019-20 +1.24, 2020-21 +0.55, 2021-22 +0.23, 2022-23 -0.99, 2023-24 +1.33 |
| before | +0.721 (0.250) | 8 of 9 | 61.8% | 2015-16 +2.53, 2016-17 -0.23, 2017-18 +1.25, 2018-19 +0.57, 2019-20 +0.43, 2020-21 +0.62, 2021-22 +0.11, 2022-23 +0.59, 2023-24 +1.26 |

**Reading.** The shortfall is present on first games missed (+0.53, SE 0.20, 8 of 9 seasons), and that cell is 90% of the data. Longer absences exist only in the three report seasons: 2 to 4 games is +1.00 (0.69), 5 or more −0.19 (1.23), 47 absences. Those cannot separate player from night: their intervals cover zero and cover the first-game value. So this data cannot say whether the shortfall persists past the first night. Rest nights are not the whole story: the shortfall is about the same on the second night of a back-to-back (+0.65, 0.30) as on other nights (+0.50, 0.24), and it is not concentrated late in the season (after March 1 +0.39, 0.29; before +0.72, 0.25). What would settle it is more report seasons. The fading rule means history before 2021-22 only ever shows a star's first missed night.

## Files

All in `/Users/bilguutei/dev/548-research-out/`: `gen-games.ts` (task 1), `dump.ts` (dev-data export), `features.py`, `ages.py`, `fetch-ages.sh` and `espn-athletes/` (cached ESPN responses), `analysis.py` (protocol and candidates; `results-candidates.json`), `market.py` (`results-market.json`), `extras.py` (back-to-back, league residual, ceilings; `results-extras.json`), `absence.py` (`results-absence.json`), `check.py` (the reproduction), `games.csv`, `features.csv`, `features-age.csv`. Run the TypeScript from the worktree with `corepack pnpm exec tsx <path>`; the Python with `./venv/bin/python` in the out folder.

Machine-readable headline numbers (sections 3, 4, 7 to 10): `/Users/bilguutei/dev/548-research-out/summary.json` (built by `build_summary.py` from the results files; nothing new).
