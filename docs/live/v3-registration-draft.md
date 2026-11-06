# Draft registration: live-2026.27-v3

Registered before running the regression check. Groundwork only: no production caller
opts in, v2 remains published and its frozen artifacts and exports retain their behavior.
The prospective record starts at v3's first seal; no earlier row belongs to v3.

## Frozen changes and analysis choices

1. H1: team-game absence ordinals continue within each Monte Carlo iteration through
scheduled regular games, unscheduled placeholders, play-in and every playoff round.
Placeholders retain the existing end-of-regular-season ordering. Observed games do not
consume future ordinals. The old postseason scalar remains the default v2 path.
2. H3: unreported inferred absences stop counting after more than ten missed team games,
or upon an appearance for another team. Exclusions report `no longer counted: out of the
rotation window` (or joined another team). Report-listed players retain report policy.
V3 tracks the true gap even after rotation evidence falls out; v2 tracking is unchanged.
3. H2: discrete next-game return hazards from regular-season absence spells on 2021-22,
2022-23, 2023-24 only; 2020-21 warms player values. Each missed game with an observed
next team game contributes a return/nonreturn observation. End-of-season, unavailable
box-score and lost-roster-follow-up endpoints are right-censored, never return events.
Frozen reason stems, long/short classes and buckets 0, 1, 2-3, 4-7, 8-15, 16-30, 31+
are retained. Cells below 30 observations pool with an adjacent bucket in the same
class (right to left, then first into next). Bucket zero has no missed-game observation
and borrows the neighboring pool: this is an explicit unsupported boundary, not a fit
of onset risk. An unidentifiable zero-hazard tail aborts fitting, rather than inventing
a finite return time. No class or bucket is selected using held-out outcomes.
4. Survival is the product of successive nonreturn hazards, conditional on k games
already missed. Expected further games is its sum (geometric tail after bucket 31+).
Inferred absences can return immediately. Report-selected absences use the frozen
status probability for next-game nonparticipation, followed by conditional hazards.
One duration per player per iteration is sampled by inverse survival with a separate
seeded RNG stream. This retains correlated consecutive absences and integrates nonlinear
season outcomes, rather than cutting off at a mean. Seals can use next-game expected
points; expectedGames remains available for summaries. No medical interpretation.
5. No refit of player values, status probabilities, rating updates, sigma, or uncertainty.
M7's causal identification, missing-box adjustments, calendar aging and lineup effects
are not solved here. Ratings remain injury-adjusted estimates intended to approximate
full strength. Unknown future injuries are not simulated.

## Pre-declared gate

(a) All new expiry, censoring, survival, seeded simulation, probability-bound and legacy
compatibility invariants pass. (b) Report development-season return diagnostics and
cell counts, with code SHA, input SHA-256 hashes and seasons in `v3-fit.json`.
(c) One regression check on 2024-25 and 2025-26: game-level Brier within ±0.002 of v2
on the identical qualifying final-point game set (pooled and per season reported).
T4-style realized-schedule reconstruction: 4,000 iterations at Dec 1, Feb 1 and Apr 1,
pooled across both seasons, playoff Brier no more than v1 +0.005 and win RMSE no more
than v1 +0.25, with forecast sums valid, exactly v2's registered tolerances/comparator.
Also report v2 at each checkpoint. These previously examined seasons are regression
checks only, never independent validation or a source of model selection. Failure
aborts promotion; no tuning or alternate candidate after looking.

## Compatibility and effect-size protocol

Reproduce the frozen v2 evaluation with output redirected to /tmp. Compare main and
this branch at LIVE_NOW=2026-11-06T12:00:00.000Z from the same pinned live-data tree and
identical cached network responses: state, projections and ledger must be byte-identical.
Never commit live data. On the pinned published current state, report largest absolute
playoff/title movements for H1 alone, H3 alone, H2 alone and combined, relative to v2,
with the same 20,000 iterations. These descriptive ablations cannot select parameters.

## Results

Pending. Appended only after the registration commit and execution of the frozen checks.
