# Frozen external model-benchmark mapping

This rule was committed before any FiveThirtyEight comparison number was
computed. Changing it requires a new versioned benchmark; it must not be tuned
to the result produced under this version.

## Source and scope

- Dataset: FiveThirtyEight, `checking-our-work-data/nba_playoffs.csv`
- Repository: https://github.com/fivethirtyeight/checking-our-work-data
- Pinned repository commit: `f6d5b2e1d6da2889345d381c41431f9a4ee208dd`
- Pinned raw URL: https://raw.githubusercontent.com/fivethirtyeight/checking-our-work-data/f6d5b2e1d6da2889345d381c41431f9a4ee208dd/nba_playoffs.csv
- Verified schema: one row per `season`, `forecast_date`, and `team`, with
  probabilities and realized outcomes for reaching each playoff round.
- Verified coverage in this file: seasons 2016–2022, forecast dates
  2015-10-27 through 2022-06-17, 47,580 rows.

The archive spans two FiveThirtyEight model generations. The 2016–2019
postseasons predate the October 2019 RAPTOR forecast launch and belong to the
CARM-Elo/CARMELO era. The 2020–2022 postseasons belong to the RAPTOR era.
FiveThirtyEight states that its sports forecasts stopped updating on June 13,
2023; this pinned dataset itself contains no 2023 postseason rows. Results may
therefore be pooled only with this model-generation limitation displayed.

## Team identity

Team names are mapped through a versioned, explicit name-to-Basketball-
Reference-code table. Fuzzy matching is forbidden. A missing or ambiguous name
leaves the series uncovered.

## Pre-series timestamp

For each reconstructed series, select the latest `forecast_date` for which:

1. the date is strictly earlier than `seriesStartDate`;
2. both participating teams have a row on that same date; and
3. both teams have finite, strictly positive probabilities in the required
   next-round field.

The source contains dates, not times. The stored observation timestamp is
therefore `${forecast_date}T00:00:00Z`, and same-calendar-date rows are excluded
under the repository's conservative midnight deadline. No later row may be
substituted when no qualifying date exists.

## Round field and series conversion

Use the field representing advancement immediately beyond the current series:

| Playoff Pulse round | FiveThirtyEight field |
| --- | --- |
| First Round | `make_conf_semis` |
| Conference Semifinal | `make_conf_finals` |
| Conference Final | `make_finals` |
| NBA Finals | `win_finals` |

Let `qA` and `qB` be the two teams' probabilities from that field on the
selected common date. Convert the two team-level advancement forecasts into a
head-to-head series probability with:

`P(team A wins series) = qA / (qA + qB)`

Both source values and the normalized probability are retained. The conversion
conditions on one of the two known opponents advancing and absorbs source
rounding. The normalized result must be finite and strictly inside `(0, 1)`.

`win_finals` is used only when the current matchup is the NBA Finals. A team's
championship probability is never converted into an earlier-round series
probability; earlier rounds use their corresponding next-round field.

## Missingness and interpretation

- No qualifying common pre-series date: uncovered.
- Missing team mapping or row: uncovered.
- Missing, zero, negative, or non-finite advancement probability: uncovered.
- No interpolation, backfill, hindsight result, or model-to-market conversion.

This is an external **model** benchmark. It is not a betting-market benchmark,
does not provide two-sided prices, and does not satisfy the separate no-vig
market contract. The market benchmark remains at zero coverage.

## Model-generation sources

- FiveThirtyEight archive and shutdown notice:
  https://github.com/fivethirtyeight/data
- 2015–16 CARM-Elo methodology:
  https://fivethirtyeight.com/features/how-our-2015-16-nba-predictions-work/
- October 2019 RAPTOR forecast launch:
  https://fivethirtyeight.com/features/winners-and-losers-in-our-updated-nba-season-predictions/
- NBA forecast version history:
  https://fivethirtyeight.com/methodology/how-our-nba-predictions-work/
