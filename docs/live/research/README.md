# Research register: the live game model

Every experiment on the live forecast's game model is listed here, whether or not it led to a
version. An entry is appended when the experiment's numbers exist and is never edited afterwards;
a correction is a new entry that names the one it corrects. The register exists so that a later
candidate starts from what was already tried, and so that the number of looks at the development
seasons is on record.

Rules for anyone adding to it:

- Read the whole register before proposing a model change. A candidate that repeats a listed
  experiment must say what is different.
- Development seasons are 2015-16 to 2023-24 under rolling origin. 2024-25 and 2025-26 are closed
  (see `docs/live/registration-v3.md` and `registration-v4.md`): nothing is computed on them.
- State the protocol once, before any result, and apply it to every candidate in the entry. Record
  every candidate tried, including the ones that showed nothing, and every departure.
- Nothing here is a public claim. Claims on the site follow `docs/claims-ledger.md`. No entry
  says a model beats another model or the market.
- Scripts that are not part of a registered version live outside the repository; an entry says
  where, and what can and cannot be reproduced from the repository alone.

## Entries

### 2026-11-23, residual study of v4

Record: `2026-11-23-residual-study.md` (the full report), `2026-11-23-summary.json` (its headline
numbers). Run by a research agent for the session lead; scripts and the per-game table are
outside the repository (`/Users/bilguutei/dev/548-research-out/`, copied to the owner's review
folder), so only the parts that became `live-2026.27-v5` can be reproduced from the repository.

Question: on the development seasons the vig-free market scores 0.2123 against v4's 0.2173 on
2,460 games with a stored spread. Where is that 0.0050, and is any of it reachable?

What was established (development seasons; changes in Brier × 10⁻⁴ against v4, negative better):

| Tried | Result | Standing |
|---|---|---|
| Twenty add-on signals under one forward-chaining protocol (7,059 held-out games): rest and schedule density, travel and time zones, altitude, team-specific home court, v4's own recent error, three-point makes above a team's norm, blowouts, contention after March 1, a blend with v1, team age | None has an interval wholly below zero. Altitude −1.9 (−3.9, +0.0) is the nearest; team-specific home court and age shares are reliably worse | Closed. Altitude may be retested only with new seasons |
| Where the market's lead sits | 95% of it is in the third of games where the market and v4 disagree most (0.2174 against 0.2317); the other two thirds are level. Measured features explain under a tenth of the disagreement | Finding |
| Persistent against game-specific disagreement (lead's analysis) | A team's trailing mean disagreement predicts its next one (correlation 0.45 to 0.47), but adding it to v4 gains 2 to 5 of the 53 | Finding: about nine-tenths of the lead is game-specific, not a better standing opinion of teams |
| Telling v4 who plays (its own expected minutes over the players who played) | −21.6 (−27.5, −15.7) on 9,845 games, most of it in seasons without reports; on spread games it recovers 16 of 45, and 23 of 131 in the largest-disagreement third | Finding: lineup knowledge is about a third of the lead and not where it is largest |
| Absence pricing, told who plays | The result is 0.21 points worse (SE 0.09, 7 of 9 seasons) per point v4 charges; for absentees with 28+ expected minutes 0.58 (SE 0.19, 8 of 9); measured almost entirely on first games missed | **Open anomaly.** Worth roughly 1 to 2 on game Brier if fixed; larger for season odds of a team missing a star |
| Mechanism 1 for it: cap redistributed minutes at 1.15 × a player's average | −0.2 (−0.5, +0.1) told; +1.0 on report seasons | Null |
| Mechanism 2: an on-court observation per player per game (team margin rate with him on minus off) | −1.1 (−1.8, −0.4) on 10,749 games; −3.3 (−4.9, −1.6) on the report era, 3 of 3 seasons; calibration unchanged; the anomaly does not move (0.58 → 0.565) | **Registered as `live-2026.27-v5`** (`docs/live/registration-v5.md`) |
| Mechanism 3: minutes as evidence of quality (a term in the box observation) | −0.1 (−0.6, +0.4); chosen zero at the last three origins | Null |
| Process idea: interim looks at v4's 500-game Stage B | On the first 200 to 300 games of each report season the v4 − v2 difference ranges from −0.014 to +0.009 | Rejected: an early look would be noise |

Not tried, recorded so they are not mistaken for nulls: three-point and free-throw percentages
(the stored lines have makes without attempts); lineup interactions; whether the absence anomaly
persists past the first game missed (too few report seasons); a non-linear effect of a star's
absence on his replacements.

Looks at the development seasons to date for the v4 family: the inquiry spike (2026-11-21),
Stage A (2026-11-21), this study and its two spikes (2026-11-23), v5's Stage A′.

### 2026-11-23, Stage A′ of `live-2026.27-v5` (the on-court observation)

Record: `docs/live/registration-v5.md` (result section) and `docs/live/evaluation-v5-stage-a.json`. Passed: Brier
against v4 −0.000111 (−0.000182 to −0.000043) on 10,749 games and −0.000328 on the report era (3 of 3 seasons);
calibration slope 0.988; season-level odds within every non-inferiority limit against v4 (the one part not seen
before registration). A registered candidate only: not wired, and wiring is the owner's decision.
