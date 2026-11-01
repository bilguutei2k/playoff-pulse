# Live model registration

Model version: `live-2026.27-v1`. Registered 2026-11-01, before any validation
season was scored. The commit that adds this file precedes every validation
result in `docs/live/evaluation.json`.

## Frozen parameters

From `scripts/live/fit-params.ts`, using seasons 2005-2015 only (2005 is warm-up
and unscored). Full output: `docs/live/development-fit.json`.

| Parameter | Value | Meaning |
|---|---:|---|
| `sigma` | 10.5 | Game-margin noise SD |
| `q` | 0.05 | Daily team-rating variance |
| `qHca` | 0.0002 | Daily home-court variance (set, not fitted; see below) |
| `rho` | 0.85 | Season-to-season rating carryover |
| `tau` | 4.5 | Long-run SD of team strength |
| `hca0` | 1 | Starting home-court state; learned within weeks |
| `hcaVar0` | 1 | Starting home-court variance |
| `b2b` | 1.5 | Points against a team on a back-to-back |
| `marginCap` | 30 | Margins clipped to this before updating |
| `hcaPlayoffDelta` | 1.5 | Added home-court points in playoff games |
| `playoffSpread` | 1.1 | Multiplier on rating difference in playoff games |

`qHca` is set rather than fitted. Development seasons have too little home-court
drift to identify it, and the fit prefers about zero, which would freeze the state
for later seasons. Development log loss is 0.594511 at the chosen 0.0002 and
0.594523 at zero, so the choice has no development cost.

These exact parameters ship. There is no refit on all history. The only permitted
refits are the disclosed ones in the ship rule below. Any mid-season parameter
change requires a new version, and the public record is reported per version.

## Candidate selection

On development regular seasons (n = 12,059), by log loss: Kalman 0.594511, Elo with
margin 0.597729, season-to-date SRS 0.603238, prior home-win rate 0.674843. Kalman is
the primary.

**Disclosure:** a spike on seasons 2023-2026 informed the choice of model form before
this registration, using hand-set parameters. Those seasons are therefore reported
separately and are not part of the gates. Only 2026-27 onward is fully untouched.

## Validation design

- **Gate seasons:** 2016-2022, scored once with frozen parameters.
- **Reported separately:** 2023-2026, labeled "model form chosen with sight of these
  seasons".
- Ratings stay walk-forward: every prediction uses only earlier games.
- Bubble dates (2020-07-30 to 2020-10-12) are treated as neutral.

## Gates

**Game level, gate seasons, regular season:**

- **G1.** Brier below the prior home-win-rate baseline, with a season-clustered
  paired 95% interval wholly below zero.
- **G2.** Paired Kalman-minus-comparator Brier against Elo-margin and season-to-date
  SRS, with a season-clustered 95% interval not wholly above zero.
- **G3.** Calibration slope in [0.90, 1.10] and grouped reliability at most 0.002.
- **G4.** Property tests: changing a future game leaves every earlier forecast
  byte-identical, and a replay reproduces state exactly.

**Season level, at opening night, Dec 1, Feb 1 and Apr 1. Gate seasons exclude the
irregular 2020 and 2021, leaving 2016-2019 and 2022:**

- **S1.** Make-playoffs Brier beats a current-win-percentage logistic baseline, fitted
  on development seasons, at each checkpoint after opening night.
- **S2.** Make-playoffs reliability within 10 points in every bin with at least 10
  team-seasons.
- **S3.** Win-total RMSE beats linear extrapolation at Dec 1 and later.
- **S4.** Seeding from real results, seasons 2022-2026, 100% required. Seeds 1-6 are
  compared with ESPN final `playoffSeed`. Seeds 7-10 are compared with play-in game-1
  pairings identified by notes: the home team of "7th Place vs 8th Place" is seed 7
  and the away team is seed 8; the home team of "9th Place vs 10th Place" is seed 9
  and the away team is seed 10.

Title odds are reported descriptively, with no skill claim.

**In-game, regular seasons 2025 and 2026, at Q1, Q2 and Q3 ends:** grouped reliability
at most 0.003 and calibration slope in [0.85, 1.15] per checkpoint.

**Playoffs:** series Brier is reported against the SRS + home reference on matched
series. No improvement claim unless the interval excludes zero.

## Ship rule

- **G1 and G4** are hard blockers.
- **G2** failure allows one disclosed refit on development seasons. If it still fails,
  the model ships with the deficit recorded in `docs/claims-ledger.md`.
- **G3** failure allows one fix: re-fit `sigma` alone on 2010-2015.
- **S1-S3** failure allows one disclosed re-fit of the simulator uncertainty scale on
  development seasons. The result is recorded either way.
- **S4** is a deterministic rule check and must pass. Tiebreak criteria for record
  against playoff-eligible teams are added only if S4 requires them.
- **In-game** failure allows one refit of `sigma_g` on 2025 states only, re-validated on
  2026 only. On a second failure the in-game estimate is not shown (score and sealed
  pregame number only) and the deficit is recorded in the claims ledger.
- No retuning against validation seasons beyond these rules. Every refit is disclosed
  here.

## Amendments

**2026-11-01, G3 result.** On gate seasons the calibration slope was 0.860, outside
[0.90, 1.10], while grouped reliability was 0.000489, inside the 0.002 limit. Forecasts
are therefore mildly overconfident: a stated 80% has historically been about 77%. The
permitted fix was applied (`scripts/live/refit-sigma.ts`, `sigma` alone on 2010-2015 regular
seasons, every other parameter held) and it returned the registered value, 10.5, so nothing
changed. G3 is not a hard blocker under the ship rule. No further tuning was done, because
anything else would be fitted on validation seasons. The deficit is recorded in
`docs/claims-ledger.md` and on `/live/methodology`. Any correction must be a new version
chosen on prospective data.
