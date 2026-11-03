# Claims Ledger

Generated: 2026-08-01. This ledger gates all public copy. A claim may appear
on the site only in the category listed here, with the required qualification
attached at the point of use. Sources: `docs/backtest/summary.json`,
`docs/backtest/significance.json`, `docs/backtest/research.json`,
`docs/backtest/availability.json`, `docs/backtest/input-audit.json`,
`docs/parameter-provenance.md`, and
`docs/point-in-time-implementation.md`.

## Data regimes (must be labeled at point of use)

| Regime | What it is | What it is not |
|---|---|---|
| 2026 final production state | Completed factual bracket (Knicks beat Spurs 4–1); terminal probabilities are accounting, not skill | Not a forecast track record |
| 2026 preserved scenario | Counterfactual reset using July roster assumptions | Not an issued Finals forecast |
| Frozen 2003–2025 reconstruction | The immutable pre-2026 record under `docs/backtest/frozen-2003-2025/` | Must never be regenerated |
| 2026 isolated holdout | Models fit only on 2003–2025; 85 games and 15 series scored separately | Not prospective candidate evidence: both challengers were registered after the postseason began |
| 1984–2026 reconstruction | Point-in-time forecasts built after the fact under leakage controls | Not contemporaneously issued predictions |
| 1987–2026 rolling origin | Models fitted only on prior seasons after a three-season initialization window | Temporally held out, but not a preregistered prospective track record |
| 2027+ prospective issuance | Immutable forecasts issued before a declared game start | No observations exist yet |
| Live model validation (2016-2022, 2023-2026) | Walk-forward reconstruction of regular-season games with frozen parameters; 2023-2026 informed the choice of model form | Not a prospective record |
| Live injury test (2024-25, 2025-26) | The registered, run-once test of the v2 injury adjustment against v1 on identical games; fitted on 2021-22 to 2023-24 | Not prospective: 2025-26 was seen when v1's form was chosen, and two seasons is thin |
| Live sealed ledger (2026-27 on) | Forecasts sealed before tip and scored afterward, per model version | The only prospective record; small-sample below 500 scored games |

## Supported (may be stated plainly)

1. The rating-only baseline displayed by the product scored **Brier 0.1855**
   on 645 reconstructed 1984–2026 playoff series. The baseline/overlay boundary
   was defined after historical results existed, so this is descriptive, not
   prospective evidence.
2. That baseline conclusively outperforms the naive baselines—coin flip
   (difference −0.064520), directional home-team (−0.018589), and directional
   higher-seed (−0.017950)—with paired 95% bootstrap intervals excluding zero
   under both series and season resampling.
3. The rating-only baseline conclusively trails the simple rating baselines:
   SRS-only by +0.011750 Brier and net-rating-only by +0.010242. Both paired
   season-clustered intervals are entirely above zero; the retirement gate fires.
4. The published Brier validates only the rating-only baseline. Player impact,
   projected minutes, injury status, and manual adjustment form a separate
   scenario overlay that defaults to zero, is always shown beside the baseline,
   and has no point-in-time historical validation.
   The live baseline executes the same probability path as the backtest, but
   current rating values remain manual inputs and are not individually certified
   by the aggregate historical score.
5. In rolling-origin evaluation (1987–2026, 3,160 games, 600 series), no
   richer feature set conclusively improved the game-level primary comparison
   against SRS + home court. The exploratory SRS-plus-player series interval is
   barely below zero, but its game interval crosses zero and its BPM proxy is
   not production-equivalent.
6. Rolling-origin forecasts remain overconfident: calibration slopes are
   approximately 0.94 (series) and 0.97 (games).
7. Nested game calibration changes Brier from 0.2161 to 0.2159 across 3,009
   predictions, but direct series-output calibration worsens Brier from 0.1769
   to 0.1785 across 570 series. The direct line is **CLOSED**.
8. A rolling prior-only climatology scores series Brier 0.2006 versus 0.1766
   for SRS + home. The difference is conclusive under season resampling.
9. Grouped Murphy decomposition attributes the reference model's advantage
   over climatology mainly to greater resolution. Components are equal-count
   grouped diagnostics with season-clustered intervals, not an exact
   observation-level identity.
10. The dynamic margin-update candidate and smooth rating-gap player-shrinkage
   candidate both have historical comparison intervals that include zero.
   Neither is promoted; both are frozen for first eligible evaluation in 2027.
11. All reconstructed inputs pass leakage assertions
    (`snapshot_as_of < forecastAsOf` and only prior games in each pregame
    state); raw predictions are committed as JSON.
12. Propagating nested game calibration through the exact series solver
    worsens the eligible point estimate from Brier 0.1769 to 0.1773. The
    candidate-minus-raw difference is +0.000392 with season-clustered interval
    [−0.000269, +0.001047]. The nested line is **CLOSED**.
13. The registered `exact_srs_logit_plus_seed_v1` primary challenger improves
    the matched historical point estimate from 0.1769 to 0.1735 (difference
    −0.0034), but its 95% interval [−0.0085, +0.0022] includes zero. It is not
    promoted.
14. The frozen ten-season training-window candidate improves historical game
    Brier by −0.000759 with a season-clustered 95% interval
    [−0.001425, −0.000128]. This is retrospective research, not prospective
    validation, and it is first promotion-eligible in 2027.
15. The frozen FiveThirtyEight mapping covers all 105 eligible series from
    2016–2022. Playoff Pulse scores Brier 0.1843 versus 0.1719 for
    FiveThirtyEight; the paired Playoff-Pulse-minus-538 difference is +0.0124
    with season-clustered 95% interval [−0.0010, +0.0253]. This is a model
    benchmark spanning CARM-Elo/CARMELO and RAPTOR eras, not a market benchmark.
16. Grouped Murphy reliability is 0.001454 Brier for games and 0.002696 for
    series. The predeclared 0.002 series threshold therefore triggered a
    rating-uncertainty candidate. It slightly improves series Brier by 0.000120
    with an interval crossing zero, but worsens grouped series reliability by
    +0.000831 to 0.003527; it remains research-only and is not promoted.

## Supported with qualification

| Claim | Required qualification |
|---|---|
| "Baseline Brier 0.1855 vs 0.1737 SRS-only" | The visible rating-only baseline is conclusively worse by +0.011750; the retirement gate fires and the score does not validate the overlay |
| "Traceable" | Define on first use: every probability links to the code, data snapshot, and evaluation artifact that produced it |
| Series accuracy 74.0% | Higher-seed baseline is 73.0%; Brier/log loss remain the primary proper scoring rules |
| Game calibration point estimate | A negligible game-only change (0.2161 → 0.2159); both direct and propagated series calibration lines are CLOSED |
| 2026 scenario lab results | Counterfactual under preserved July roster assumptions; not an issued forecast |
| Sensitivity reliability | Zero of ten grouped observed rates lie inside mean bands after baseline isolation; this is not individual probability-interval coverage |
| Historical injury effects | Not estimable: zero eligible point-in-time availability observations across 12,900 player-series opportunities |
| FiveThirtyEight comparison | Model benchmark on 105 matched 2016–2022 series; 538 has the better point estimate, while the paired season-clustered interval crosses zero |
| "Coherent game-to-series calibration helps" | Not permitted: the expanded point estimate worsens, its interval includes zero, and the line is CLOSED |
| Exact-SRS-plus-seed challenger helps | The pooled historical improvement is below the 0.005 threshold, its interval includes zero, its 2026 registration is contaminated, and the isolated 2026 result is low-powered |
| Ten-season training window helps | Historical game interval excludes zero; the candidate is frozen for a future 2027 check and is not promoted on retrospective evidence |
| 2026 isolated holdout | Baseline series Brier is 0.2195; both challengers are worse on point estimate, all paired intervals cross zero, and both registrations are `CONTAMINATED_2026`; the overlay is not scored |

## Research-only (never in production claims)

- Rolling-origin fitted models and calibration diagnostics.
- Rolling climatology and fitted seed baselines.
- Murphy Brier decomposition.
- Grouped sensitivity reliability diagnostic.
- Dynamic margin-update candidate.
- Rating-gap player-shrinkage candidate.
- Exact-SRS-logit-plus-seed primary challenger.
- Ten-season training-window challenger.
- Player/minutes/injury/manual scenario overlay.
- SRS rating-uncertainty candidate.

## Rejected or not promoted

- Automatic transfer of historical calibration to manual production inputs.
- Best-of-several candidate selection on a single evaluation period.
- Dynamic or shrinkage candidate promotion on pooled history through 2026.
- Primary or temporal-window challenger promotion on pooled history through
  2026 or on the contaminated single-season holdout.
- Inferring pregame availability from participation observed after the deadline.
- Direct series-output calibration and nested game calibration propagated
  through the exact solver. Both research lines are CLOSED, not deferred.

## Must not be claimed

- "Outperforms strong baselines."
- Any implication of a live or contemporaneous 2026 forecast track record.
- Any claim that historical BPM/SRS calibration validates subjective production
  ratings.
- Any claim that the published baseline Brier validates the scenario overlay.
- Official-NBA-data sourcing or betting utility.
- Validated individual coverage for sensitivity intervals.
- Measured historical injury benefit for the 2026 archive or its overlay. (The live v2
  injury test is governed by the live section below.)
- Prospective performance before 2027 observations exist.

## Not measured (open gaps)

- Performance on immutable, contemporaneously issued 2027+ forecasts.
- Historical injury/absence effects in the 2026 archive until sourced
  point-in-time coverage is material. (The live model's injury test is in the live
  section below.)
- Production-equivalent lagged-rotation effects: zero candidate or eligible
  timestamped player-game-log observations and zero completely covered series.
  Clause-level instrumentation records zero rejections for every clause; the
  240-minute, timestamp, and six-player rules did not eliminate anything
  because the required source rows do not exist.
- Individual latent-probability interval coverage, which is not identifiable
  from one binary series result.
- Timestamped no-vig market comparisons: the market contract remains at zero
  eligible observations. The separate FiveThirtyEight model benchmark has 105
  matched observations and does not satisfy the market contract.

## Mechanical content-selection rules

1. **Featured replay**: most recent completed NBA Finals in the reconstruction
   archive → 2026 San Antonio–New York.
2. **Featured failed series**: incorrect rolling-origin series forecast with
   the highest pregame favorite confidence.
3. **Worst-game examples**: descending Brier loss from
   `evidence.json → worstForecasts.game`, top N as computed.
4. **Failure narratives**: only inputs recorded in the pregame snapshot may be
   cited; no retrospective storylines.

## Live forecast (model `live-2026.27-v2`; `live-2026.27-v1` continues)

Sources: `docs/live/registration.md`, `docs/live/evaluation-games.json`,
`docs/live/evaluation-season.json`, `docs/live/injury-fit.json`,
`docs/live/evaluation-injury.json`, and `data/live/ledger/` (on the `live-data` branch since 2026-11-03; `main` keeps the rows up to that day). These claims appear on `/` (games and
track record), `/odds` (season forecast) and `/how-it-works` (methodology). v2 is v1 with the
injury adjustment; every rating parameter is shared, so the v1 claims below still describe the
rating model. Each version's sealed record is reported separately.

**May be stated plainly, with the numbers:**

- Walk-forward on 2016-2022 regular seasons, Brier is 0.2153 against 0.2458 for a prior
  home-win rate (paired interval -0.0353 to -0.0266, season-clustered), and it was better than
  Elo with margin (0.2165, interval -0.0023 to -0.0003) and season-to-date SRS (0.2207, interval
  -0.0070 to -0.0042).
- Regular-season 2023-2026 results must carry the label "model form chosen with sight of these
  seasons": Brier 0.2125.
- The tiebreak code reproduced all 100 actual seeds, 2021-22 to 2025-26.
- In-game estimates passed reliability and slope checks at Q1, Q2 and Q3 ends on 2025-26 games not
  used to fit them.
- v2 injury test, gated by `docs/live/evaluation-injury.json` (registered before any test-season
  number, run once): on 2,460 regular-season games in 2024-25 and 2025-26, Brier 0.2009 against
  0.2061 for v1 on the same games, a paired difference of -0.0051 with a 95% interval of -0.0081 to
  -0.0022 (bootstrap over 327 game dates), negative in each season (-0.0057 and -0.0046). Log loss
  0.5856 against 0.5991; calibration slope 0.875 against 0.886, within the registered 0.02. The
  season simulator stayed within its registered tolerances at Dec 1, Feb 1 and Apr 1. Every use
  must carry the two disclosures below about 2025-26 and the market.

**Required disclosures:**

- What v2 models and what it does not: listed players on the NBA injury report, by their
  expected absence weighted by status (a team that has not filed yet counts its current
  absences, chiefly players who missed its last game), with full-strength ratings, a final seal
  in the hour before tip, and return estimates in the season simulation from the survival table
  only. It does
  not simulate unknown future injuries, redistribute minutes, or model matchups. ESPN's return
  dates are stored and never used. v1 does not account for injuries, and any number from v1 must
  say so.
- The v2 test is conservative and thin: 2025-26 was among the seasons seen when v1's form was
  chosen, which favors v1, and only two test seasons exist. The sealed ledger is the real test.
- In the test, the market remained ahead on the 978 games with a stored ESPN spread (its timing
  unknown): market 0.1965, v2 0.2008, v1 0.2070.
- The test approximated live statuses from stored reports; the live season odds read the latest
  report every run.
- Game forecasts are mildly overconfident: v1's calibration slope was 0.860 on its gate seasons,
  outside the registered 0.90 to 1.10 range, and v2's was 0.875 on the test seasons. The permitted
  fix changed nothing. No further correction was tuned on test seasons.
- Midseason playoff odds failed the registered reliability check at opening night, Dec 1 and Feb 1,
  in small bins, and are not claimed to be well calibrated. On 2023-2026 they did not beat a
  win-percentage baseline on Dec 1 and Feb 1.
- In-game values between quarter ends, including the final minutes, are unvalidated interpolation.
- The ledger must always show missed seals, games with no final seal (scored on their morning
  seal, as reissued if it was) and seals with incomplete inputs, and seals made with a stale or
  missing injury report say so. A reissued morning seal shows its true time and keeps the original. Results below 500 scored games carry a small-sample label.

**Never claim:**

- Title-odds skill. Too few champions exist to measure it.
- A playoff edge over the SRS + home reference. Series Brier on 2016-2022 was 0.1837 against 0.1712,
  with the interval crossing zero.
- Any claim about either model against the market, including that v2 narrows a gap to it, until at
  least 500 scored games. By the owner's decision of 2026-11-01, the market's vig-free win
  probability is displayed per game as a reference only, labeled "Market" with its provider named;
  it is never a model input and is not scored.
- That v2 beats v1 prospectively, before the sealed ledger shows it on at least 500 scored games
  with the paired reference stored on each v2 seal.
- That the injury test is a prospective result, or that return estimates use reported return dates.
- Betting value of any kind, official NBA data, or any affiliation with the NBA. The injury report
  PDFs are the NBA's public documents, read unofficially.
