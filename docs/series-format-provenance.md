# NBA playoff series-format provenance

This document freezes the format lookup used for the 1984–2026 historical
evaluation. The implementation is a per-season, per-round registry in
`src/lib/backtest/series-formats.ts`; it does not infer format from the number
of games that happened to be played. Seasons outside the registered range fail
closed.

## Registered formats

| Playoff seasons | First Round | Conference Semifinals | Conference Finals | NBA Finals |
| --- | --- | --- | --- | --- |
| 1984 | Best-of-5, 2-2-1 | Best-of-7, 2-2-1-1-1 | Best-of-7, 2-2-1-1-1 | Best-of-7, 2-2-1-1-1 |
| 1985–2002 | Best-of-5, 2-2-1 | Best-of-7, 2-2-1-1-1 | Best-of-7, 2-2-1-1-1 | Best-of-7, 2-3-2 |
| 2003–2013 | Best-of-7, 2-2-1-1-1 | Best-of-7, 2-2-1-1-1 | Best-of-7, 2-2-1-1-1 | Best-of-7, 2-3-2 |
| 2014–2026 | Best-of-7, 2-2-1-1-1 | Best-of-7, 2-2-1-1-1 | Best-of-7, 2-2-1-1-1 | Best-of-7, 2-2-1-1-1 |

“Home” in those patterns means the team holding home-court advantage. The
2020 neutral-site series still retain their nominal slot order, while the
backtest separately sets the numerical home-court adjustment to zero.

## Transition evidence

### First round: Best-of-5 begins in 1984 and ends after 2002

The NBA’s 1983-84 season review says the league eliminated the prior
best-of-three opening round and made every first-round series best-of-five.
Its results also show three wins deciding each 1984 first-round series, while
four wins decided every later round:

- https://www.nba.com/news/history-season-review-1983-84

The NBA’s 2002-03 season review identifies the other boundary: before that
season, the first round expanded from best-of-five to best-of-seven. Its
results show four wins in the 2003 opening round:

- https://www.nba.com/news/history-season-review-2002-03

A contemporaneous published 2002 schedule supplies the venue sequence rather
than merely the series length. For every listed matchup it schedules Games 1
and 2 at the home-court team, Games 3 and 4 at the opponent, and Game 5 back
at the home-court team—the 2-2-1 pattern:

- https://www.latimes.com/archives/la-xpm-2002-apr-18-sp-nbaplayoffsked18-story.html

Therefore the lookup uses Best-of-5, 2-2-1 for 1984–2002 and Best-of-7,
2-2-1-1-1 beginning in 2003.

### Finals: 1984 is 2-2-1-1-1; 2-3-2 begins in 1985; 2-2-1-1-1 returns in 2014

The NBA’s official October 23, 2013 release records all three boundaries. It
states that the Finals had used 2-3-2 for the preceding 29 seasons, would move
to 2-2-1-1-1 for the 2014 Finals, and had previously used 2-2-1-1-1 from 1957
through 1984 (except 1978, which is outside this evaluation):

- https://pr.nba.com/nba-finals-format-change-2014/

The NBA’s later historical account is even more explicit: 2-3-2 began in
1985, continued through the 2013 Finals, and replaced the 2-2-1-1-1 pattern
used in the 1984 Finals and other rounds:

- https://www.nba.com/news/coast-to-coast-finals-matchup-brings-attention-back-to-old-2-3-2-format

Therefore 1984 is intentionally its own lookup era, not folded into the
1985–2002 era.

## Enforcement

The test suite checks every season/round pair from 1984 through 2026, the
1984/1985, 2002/2003, and 2013/2014 boundaries, all three hand-written venue
sequences, and fail-closed behavior outside the registered range. The existing
dynamic-programming solver is compared with direct brute-force enumeration at
every reachable score for both Best-of-5 and Best-of-7, using asymmetric game
probabilities and an absolute tolerance below `1e-12`.

During ingestion, every observed game’s host must match the prefix of the
registered full pattern. A mismatch is an error; the code does not change the
format or truncate the contract to make data pass.
