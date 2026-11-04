# 548: design handoff

For a designer, human or model, who will not see the code. Read this, then `sample-data.json`, then the screenshots (1440 and 390 px of eight pages, taken about 12:45 AM ET on 2026-11-03 with two games live).

## 1. What 548 is

A public NBA forecast site (https://548-sable.vercel.app). Every game gets a win probability that is **sealed** before tip into an append-only public ledger and **scored** after the final. The site also gives playoff and title odds for all 30 teams (20,000 simulations of the season) and a public track record per model version.

- Published model `live-2026.27-v2` uses ratings plus the NBA injury report. `live-2026.27-v1` (ratings only) keeps sealing beside it as the reference.
- Data: ESPN's public feeds, the NBA's injury-report PDFs (read unofficially), and DraftKings lines via ESPN, vig removed (reference only).
- Published roughly hourly; pages refresh each minute during live games. Independent, not affiliated with the NBA, not a betting product. Record since Nov 1, 2026.

## 2. Users and jobs (inferred; no analytics exist)

| Who | Job | Where |
|---|---|---|
| Fan on a phone | Who's favored tonight, by how much, who's out | Day page |
| Fan during games | Score, clock, live estimate | Day, game page |
| Team fan | Playoff and title chances, schedule, injuries | Team, odds |
| Skeptic | Is it any good? Can they fudge it? | Record, seals, how it works |
| Returning reader | What moved since yesterday | Title race, odds chart |

## 3. Information architecture

| Route | Page | Reached from |
|---|---|---|
| `/` | Today's games, title race, record glance | Logo, nav **Games** |
| `/games/YYYY-MM-DD` | Any day ("Results" past, "Schedule" future) | Date strip, game breadcrumb |
| `/game/{espnGameId}` | One game | Whole game card, record and schedule rows, "Next game" |
| `/odds` | Playoff and title odds | Nav, "All odds", team page |
| `/teams` | 30-team index | Nav, team breadcrumb |
| `/teams/{slug}` | Team (`atl`, `gs`, `ny`, `sa`, `utah`, `wsh`...) | Index, odds rows, title race, game page names |
| `/record` | Track record | Nav, "Full record", game result |
| `/how-it-works` | Methodology, 10 anchored sections | Nav, card legend, odds footnotes |
| 404 | "Nothing here" + two buttons | |

Out of scope: the frozen 2026 archive (`/retrospective`, `/snapshot`, `/evidence`, `/methodology`, `/lab`), which stays linked from the footer.

**Header** (sticky): mark, nav (a second scrolling row below 768 px), and a freshness chip "Updated 4 min ago · live-2026.27-v2", amber past 12 h. **Footer**: not-affiliated notice, versions, links, data sources.

## 4. Pages, sections and states

`[key]` points into the sample data.

### Day page (`/`, `/games/{date}`) [dateStrip, dayPage, lifecycleAtlInd, futureDay, emptyDay]
1. **Date strip**: 3/5/7 days by width, with arrows. Each day shows "Today" or the weekday, the date, and the game count or "No games".
2. **Header**: kicker, long date, "15 games · 2 live · 13 final · times ET", "Back to today".
3. **Notices**, shown only when true: state stale or scores unavailable (amber); nothing sealed yet (provisional), future-day projections, or v1 numbers (grey).
4. **Game grid**: 1 column, 2 from 768 px.
5. **Home only**: the Title race (top 8, heat cell, change since the previous day in percentage points) [titleRace] and the Record glance (scored, Brier, missed, no final seal, small-sample label) [record].
6. **How to read a card**: legend.

**Empty day**: "No NBA games on Tuesday, November 3", plus Previous and Next game-day buttons.

### Game card states

| State | Badge | Number | Body |
|---|---|---|---|
| Morning seal, no report yet | `Morning seal 6:00 AM ET` | "548", 30 px, `Market 64% (+1)` | Margin line; "No NBA injury report was available for this number." |
| Reissued seal | `Reissued seal 11:30 AM ET` | same | Injury lines |
| Final seal, pre-tip | `Final seal 6:30 PM ET` | same | same |
| Today, unsealed | `Provisional` amber | same | Never scored |
| Future | `Projection` grey | no market | No injury term |
| Live | pulsing "LIVE · 4TH 2:40" | "Live estimate", no market | Scores; "· pregame 44% GSW" |
| Final, Final/OT | seal badge | "548 pregame", small | Big scores, loser dimmed; "Hawks won 108–104. 548 gave them 88%." |
| Postponed, Canceled | status text | seal if any | No real example yet |
| Missed | `Missed` red | none | "Tipped without a seal: counted as missed." |
| Before the record | grey | none | Games before Nov 1 |
| v1-only seal | `Sealed 6:48 AM ET` | v1's | "Before injuries: this number comes from live-2026.27-v1." |
| No final seal | `No final seal` amber | morning seal | Scored, counted |
| Incomplete inputs | seal badge, amber | any seal | Still counted |
| No market line | | no market | "· No market line yet" |

Badge tooltips are in [sealBadges]. **Injury lines** appear for sides that lose at least 1 point: "IND −12.2: Haliburton, Siakam, Nembhard out +7 more". Unfiled-team forms are in [injuryStates]. The card footer shows venue · broadcast.

### Game page [gamePage]
1. Breadcrumb back to the day.
2. **Matchup header**: status, game kind and date, seal badge, 48 px logos, names, record · #rank (past days show the record then, without rank), 56 px scores, "at" or "vs", venue.
3. **Win probability**: two 60 px numbers with the market, a split bar, the margin, the market spread (or "No market line for this game") and the footnote. Live adds the pregame number; projections drop the market.
4. **What moves the number**: diverging bars for ratings, home court, rest and absences, plus a total. Then two **absence boxes**: points, a filing note, and status groups with per-player points where stored.
   Report states: used ("Injury report used: the NBA's report of 6:30 PM ET."), stale ("…the last good one, from 6:15 PM ET, was used"), missing ("absences are zero", empty sides say "nobody is counted"). Unfiled side: legacy seals "counted nobody"; current seals count "players who missed its last game". A v1 number has no absence line.
5. **Result** (final only): one tile per version ("Gave Hawks 88%", Brier 0.015).
6. **Seals** table, one row per version: morning, reissued, final ("Due in the hour before tip", "Seals once"), and which one was scored. ATL at IND reads IND 35% → 43% → 12%.
7. **Aside**: both teams' playoff and title odds, projected wins, next game and team link.

### Odds [oddsTable, titleHistory, currentAbsences]
1. Title, season phase (Regular season / Play-in tournament / Playoffs / Season complete), simulation count, last run.
2. **Series odds**: playoffs only, per round.
3. **Standings and odds**: heat key, East / West / All 30, and a sortable table with Rating (+ "now" after absences), Proj. W–L with 10th to 90th percentile range, a 15-seed sparkline, then Play-in, Playoffs, Top 6, Conf. finals, Finals and Title heat cells. Sticky header and first column; scrolls inside its frame under 1024 px.
4. **Title odds over time**: the top 8 in team colours, others grey; keyboard and hover readout.
5. **Who the model counts as out**: per-team panels of current absences with points and expected games.

### Teams [teamsIndex]
East and West card grids: logo, name, record · rating (#rank), title chip.

### Team page [teamPage]
1. **Header**: conference · division, name, "2–6, 12th in the East by record · rating −3.8, 24th of 30 · −16.7 with current absences".
2. **Tiles**: playoffs, play-in, top six, title, and a projected-record band.
3. **Seed chances** (15 bars) and **Rating over time** (team line over league bands).
4. **Current absences**, or an empty line.
5. **Upcoming games**: `Proj.` %; 10 rows, then "Show the other 62 games".
6. **Results**: W/L with score, and a sealed %, `V1` + %, `Missed`, or "Before the record".

### Record [record]
1. Title and ledger link.
2. Amber small-sample notice.
3. **The numbers**: 12 measures × version.
4. **548 and the market** panel: text until 500 scored games. **Calibration** panel: text until 100.
5. **Every scored seal** per version, with tags Final / Morning / No final seal / Incomplete / No report / Stale report, then missed seals.

### How it works
A table of contents, then 10 prose sections with test tables and a glossary (about 10,000 px).

## 5. Shared components

548 mark (ink tile, orange square); freshness chip; panel with kicker, title, dek; game card; status pill; badge (good, warn, bad, quiet); split bar (away left, team colours ≥3:1); heat cell (9 teal bins, value printed, white text from 60%); seed sparkline and chart (teal 1–6, light teal 7–10, grey 11–15); diverging row; absence box and rows; team logo (18–56 px); sortable and plain tables; three charts; notice (amber, grey); date strip; segmented control; buttons; orange-underlined links.

## 6. Current tokens (current, open to change)

| Role | Value |
|---|---|
| page, panel, wash, wash-2 | `#faf9f7` `#ffffff` `#f5f3ef` `#eeebe6` |
| line, line-strong | `#e6e3de` `#d4d0c9` |
| ink, ink-2, ink-3, ink-4 (decoration only) | `#121417` `#5c5a57` `#6b6863` `#8a8782` |
| pulse (brand, live, active; never text), pulse-ink (text) | `#ff5a1f` `#b8400f` |
| market | `#4b5563` |
| good, bad, warn | `#0b6e55` `#b42318` `#8a4b00` |
| heat 1–8 | `#eff4f2 #dbe7e2 #c2d6ce #a7c5b9 #8ab2a3 #377f68 #25765e #0b6e55` |

Team colours are in `site.teams`.

**Type**: Archivo for the UI (15 px body, 700-weight headlines of 22–44 px); JetBrains Mono for every figure and label (11 px uppercase kickers); Archivo Black for the wordmark only. Card numbers are 30 px; game page numbers 60 px.

**Space**: 76 rem container, 16/24 px gutters, 10 px card radius, 20/24 px panel padding, breakpoints at 640, 768, 1024 and 1280 px.

## 7. Non-negotiables

- **No betting framing.** No American odds, picks, "value", "edge" or sportsbook links. The market is labelled "Market" with its provider and sits beside the model as a reference only. It never appears beside a projection or a live estimate, and there is no model-versus-market comparison or claim before 500 scored games.
- **Small samples.** Below 500 scored games, results carry the small-sample label. Missed, no-final-seal and incomplete seals are always shown.
- **Projection and Provisional** labels sit on the number itself, and these numbers never enter the record. v1 numbers say they exclude injuries.
- **Seals are never edited.** Morning, reissued and final seals are separate permanent entries, each with its true time. Nothing may look revised in place.
- **ET** for every time, labelled "ET". Days are ET slates.
- **Whole percents.** A game's two sides sum to 100, within 1–99; season odds show <1% and >99%. Ratings use one decimal.
- **Logos**: only the 56 px ESPN files, small and unaltered, always beside the name or code, decorative. A single switch hides them, so screens must work without them. Keep the not-affiliated notice on `/` (the footer carries it on every page).
- **Caveats stay visible**: v2 sees only the injury report (not future injuries, minutes or matchups); midseason odds are uncalibrated; no title-odds skill is claimed; never "official NBA data"; no claim that v2 beats v1, the baseline or the market.

## 8. Open to change

Everything else: visual language, palette, type, density, layout, card anatomy, navigation (a mobile bottom bar, for instance), merging or splitting pages, chart forms, how injuries and the market are visualised, motion, copy wording within the rules above, and a dark theme. The name stays; the mark may be refined.

## 9. Weaknesses today (my critique)

1. **The day page is a wall**: 15 identical cards, about 8,000 px on a phone, with live games not lifted.
2. **The market competes with the model.** It has near-equal weight, and "(+11)" reads like an edge.
3. **"Final" means two things**: the game status and "FINAL SEAL".
4. **Injury notes are jargon** ("stored points for its three largest absences only"), and seal absences and current absences differ.
5. **What moves the number** has unlabelled scales.
6. **/odds runs 6,700 px (13,800 on mobile)**, mostly a 30-team absence wall. The table scrolls sideways on phones, the 9-bin legend is hard to read, and the row number looks like a seed.
7. **Team colours collide**: four teams share navy, and GSW falls back to grey.
8. **/teams truncates names** at 1440 px ("Cleveland Caval…").
9. **Team page numbers clash**: the rating chart (−6.3, v1 rebuild) against the published −3.8, and an unexplained "−16.7 with current absences".
10. **The record is a bare number table**, with no progress toward 500.
11. **Mobile chrome is about 100 px sticky**; much text is 10.5–12 px.
12. **Live games barely stand out**: a small dot is the only cue.
13. **How it works is 10,000 px of prose.**

## 10. Responsive and accessibility targets

- Design for 390, 768, 1024 and 1440 px, with no page-level horizontal scroll down to 320 px (tables may scroll inside their frame).
- WCAG 2.1 AA: text ≥4.5:1, bars and marks ≥3:1, never colour alone (values print, W/L letters, badge words); touch targets ≥44 px.
- Skip link, focus ring, one H1 per page, captioned tables, `aria-sort`, tab roles, `aria-current` dates, chart text summaries with arrow-key reading.
- Respect reduced motion (the live pulse stops). Auto-refresh must not move focus or shift layout.

## 11. Sample data (`sample-data.json`, 25 KB)

Real production data (12:40 AM ET) from the site's own view functions, minified below the second level. Strings are exactly as printed; probabilities are 0–1 floats; away precedes home. Cards name teams by `code`; `site.teams` maps a code to its ESPN id (`logoPath`), names and colour. `_` keys are notes, and `_illustrative` marks the only constructed objects.

Section 4 names the key for each page. Also: `site` (chip, footer, 30 teams), `lifecycleAtlInd` (one game from morning seal to reissue, with an unfiled side, to final), `injuryStates`, `sealBadges` (10 states) and `sealRows` (raw ledger rows).

No real examples exist yet for missed, no-final-seal, postponed, stale-report, no-market-line or playoff states; their copy is above and in `sealBadges`.

## 12. Glossary

- **Seal**: a forecast written to the ledger before tip and never changed.
- **Morning / reissued / final seal**: the morning seal; one reissue if the morning seal had no injury report; the seal in the hour before tip. Scoring uses the final, else the reissued, else the morning seal.
- **No final seal**: scored on the morning seal. Counted, not missed.
- **Missed**: tipped without a seal.
- **Provisional**: today's stopgap number. Never scored.
- **Projection**: a future game's number, without injuries. Never scored.
- **Live estimate**: an in-game chance from score and clock.
- **Market**: the vig-free DraftKings moneyline, a reference.
- **Rating**: points per game above an average team.
- **Unfiled**: a team that has not submitted its injury report.
- **Brier**: squared forecast error; 0 is perfect, an even 50% scores 0.25.
- **v1 / v2**: without / with injuries, each with its own record.
