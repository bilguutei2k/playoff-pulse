# 548 — UI brief (binding design decisions)

Owner verdict on the current UI: "amateurish", "way too simple", text and table mistakes. Goal: a
useful daily destination for NBA game information in the spirit of FiveThirtyEight's sports
pages, with the model's numbers and the market's numbers side by side as reference. The owner
wants the brand to be **548** (the site lives at 548-sable.vercel.app). This document records the
high-level decisions; the builder owns every detail not fixed here.

## 1. Brand

- The product is called **548** everywhere a user can see it (header, titles, footer, metadata,
  OG image). "Playoff Pulse" stays only in package/repo names and the retrospective where it names
  the 2026 experiment.
- Mark: a rounded-square tile (radius ≈ 22% of the side) filled ink `#121417`, the numerals
  **548** set in Archivo Black, white, tracking about −0.04em, optically centred and filling about
  70% of the tile width, with a small accent-orange square (`#ff5a1f`) sitting on the baseline
  right after the 8, like a full stop. That dot is the "pulse". Implement once as a React
  component (`Brand548`, props: size) and reuse it for the header, `src/app/icon.tsx`,
  `src/app/apple-icon.tsx` and `src/app/opengraph-image.tsx` (ImageResponse; load the TTF from a
  file committed under `src/app/fonts/`, OFL licence, download it from Google Fonts).
- Header: the tile at 36px plus, to its right, "NBA forecasts" in small-caps mono. No icon from an
  icon set anywhere in the brand.
- Tagline where one is needed: "NBA forecasts, updated through the day." Never promise a cadence
  in copy; the "Updated X min ago" chip shows the real freshness.

## 2. Type and colour

- Fonts via `next/font`: UI **Archivo** (variable, 400–700); figures and labels **JetBrains Mono**
  (tabular numerals; use it for every number in tables, cards and charts); wordmark **Archivo
  Black** (local TTF, see above). Remove Inter.
- Light theme only. Background warm off-white `#faf9f7`; panels white; hairlines `#e6e3de`;
  ink `#121417`; secondary text `#5c5a57`; muted `#8a8782`. Accent orange `#ff5a1f` used sparingly
  (brand dot, active nav, focus rings, the "live" pulse). Model numbers are ink; market numbers
  are slate `#4b5563` and always labelled "Market".
- Probability heat (tables): one sequential ramp from the panel colour to deep teal-green
  `#0b6e55`; cell text flips to white above ~60% intensity. Use `src/components/live/heat.ts`
  (rewrite it if needed). Never a rainbow.
- Team colours come from `src/lib/season/team-colors.ts` and are used for probability bars and
  chart lines, with an ink outline where contrast fails.
- Load the `dataviz` skill before building any chart or heat table.

## 3. Information architecture

Keep every existing route and redirect working. Add the routes marked new.

| Route | Purpose |
| --- | --- |
| `/` | Today's slate (ET). Date strip with previous/next day links. |
| `/games/[etDate]` (new) | Any ET date of the season: past days show scores and the sealed forecast; future days show the schedule with projections (see §5). `/` is the same page for today. |
| `/game/[gameId]` (new) | One game in full (§4). |
| `/odds` | Standings and odds table (§6) plus the title-odds chart. |
| `/teams` (new) | Grid of 30 logos by conference, each with record, rating and title odds. |
| `/teams/[abbr]` (new) | Team page (§7). Lower-case ESPN abbreviation. |
| `/record` (new) | Track record (§8). |
| `/how-it-works` | Methodology, polished; add a glossary (rating, sealed forecast, morning/final seal, market, play-in, Brier). |
| `/retrospective` | Unchanged except fix the "73.0%for" concatenation and any similar text bugs. |

Header nav: Games · Odds · Teams · Record · How it works, plus the freshness chip
("Updated 4 min ago · live-2026.27-v2"). Footer: data sources (ESPN schedules and scores, NBA
injury reports, DraftKings lines via ESPN), model version, links, "For information only."

## 4. Game card and game page

Card (home and day pages): both teams as rows (logo, name, record, rating rank), one bar split by
team colour for the win probability, the model's number big on each side, the market's number
small under it with the difference in points of probability, predicted margin in words
("548 favours BOS by 4.5"), tip time in ET with venue, broadcast if the data has it, and a status
pill: Scheduled / Live with score and clock / Final with score. After a final, the card shows who
won and what the model gave them. v2 only: a one-line injury note when expected absences move the
line by at least 1 point ("Tatum out: −3.1"). Whole card links to the game page.

Game page sections, all from stored data, no invented numbers:
1. Matchup header with status and score.
2. Win probability: model vs market, large; predicted margin vs market spread.
3. "What moves the number": rating difference, home court, rest (back-to-back), expected absences
   with the listed drivers and points (v2 rows carry `drivers` and `absencePoints`), adding up to
   the margin. When the row is v1 only, show the three components and say injuries are not in
   this version.
4. Seals: morning seal and final seal with issue times and the number at each; explain that the
   scored one is the final seal if it exists, else the morning seal ("No final seal" is a state).
5. Result (final games): score, winner, the probability the model gave the winner, that game's
   Brier score, and the v1 reference number.
6. Both teams: record, rating and rank, playoff and title odds, next game, link to team page.

## 5. Projections (unsealed) and labelling

Future games (team schedules and future day pages) may show a projection computed from the
published ratings with `predictGame` (home court and back-to-back from `teamGameDates`; no injury
term). Every projection carries the label "Projection from current ratings, before injuries. The
sealed forecast is issued on game day." Projections never enter the ledger or the record and are
never scored or compared to the market. Add verifier invariants in `scripts/verify/live-checks.ts`
for them (range, home+away = 1, computed from the published ratings) as AGENTS.md requires for
any new probability output. If AGENTS.md or `docs/claims-ledger.md` forbids showing unsealed
projections, show the schedule without numbers and say why in the PR.

## 6. Odds page

One table in the FiveThirtyEight style, split East/West (tabs or two stacked tables), sortable by
any column (client component), sticky header, sticky team column on narrow screens, tabular
numerals, heat cells for probabilities. Columns: team (logo, name, record), rating (number and a
small centred bar), projected W–L with the P10–P90 range, play-in, make playoffs, top six,
conference finals, finals, title. Use only the fields the forecast actually has
(`forecast.teams[]`); do not invent columns. Keep the title-odds-over-time chart, improved:
top eight highlighted, others grey, logo or label at the line end, hover tooltip, from
`state.history`. Seed distribution (`seedProbabilities`, 15 seeds) as a small inline bar strip
per team is welcome.

## 7. Team page

Header: logo, name, record, rating and league rank, conference standing by record. Odds strip:
make playoffs, play-in, top six, title, projected wins with the P10–P90 band. Seed-probability bar
chart. Rating over time: reconstruct from the games store with `replayRatings` snapshotting after
each ET date, drawn as an inline SVG line with the league spread shaded; cache per build. Full
schedule: results with score and the sealed pregame probability where a seal exists (ledger
starts 2026-10-31; earlier games show the score only), upcoming games with the projection of §5.
v2: the team's current absences with status and expected lost points, from the published state.

## 8. Record page

The record from `state.record` for the live version and the v1 reference (sealed, scored,
pending, missed, incomplete; Brier, log loss, accuracy, baseline Brier), labelled small-sample
below 500 scored games exactly as AGENTS.md and the claims ledger say. A game-by-game list of
scored seals (date, matchup, forecast, outcome, Brier). Model and market Brier on the games that
have a stored line, presented as two numbers with no superiority wording. A calibration chart
only once 100 scored games exist; before that an honest placeholder. Copy on this page is gated
by `docs/claims-ledger.md`; read it first.

## 9. Quality bar

- Proofread every string. No concatenated tokens ("73.0%for"), no raw identifiers, never
  `NaN`, `undefined`, `null` or `—` where a sentence belongs, consistent capitalisation,
  whole-percent probabilities everywhere (`formatChance`), ET for all times, one team naming
  style per surface.
- Empty states for: no games today, before the first seal of the day, data unavailable, a game
  with no market line, a team with no sealed games, v1-only data (no injuries yet).
- Responsive from 360px: cards stack, tables scroll with a sticky first column, nav collapses.
- Accessibility: landmarks, labelled links, visible focus, contrast AA on all text including on
  heat cells and team-colour bars.
- Server components by default; client components only for sorting, tabs and tooltips. No new
  runtime dependencies. Inline SVG for charts.
- Do not touch: the model (`src/lib/season/*`, read-only), `scripts/live/*`, `data/live/*`,
  `docs/live/registration.md`, `docs/live/*.json`, the workflow files.
- Every number on screen must trace to a field of the published state, the ledger or the games
  store, or to `predictGame` over the published ratings.
