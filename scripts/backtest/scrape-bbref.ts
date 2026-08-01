// Basketball-Reference scraper with local HTML caching.
// Fetches four pages per season year: playoff bracket, playoff game log,
// team ratings, and player advanced stats. All responses are cached to
// data/historical/raw/{year}/ before parsing; re-runs skip fetch.
//
// Rate limiting: 2-second delay between uncached requests (polite scraping).
// Node 24 native fetch is used; no node-fetch dependency.

import * as fs from "node:fs";
import * as path from "node:path";
import * as cheerio from "cheerio";

// -- Constants ---------------------------------------------------------------

export const LEGACY_INGESTION_SEASONS = [
  1984, 1985, 1986, 1987, 1988, 1989, 1990, 1991, 1992, 1993, 1994,
  1995, 1996, 1997, 1998, 1999, 2000, 2001, 2002,
] as const;
export const SEASONS = [
  1984, 1985, 1986, 1987, 1988, 1989, 1990, 1991, 1992, 1993, 1994,
  1995, 1996, 1997, 1998, 1999, 2000, 2001, 2002, 2003, 2004, 2005,
  2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016,
  2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026,
] as const;
export const HOLDOUT_SEASON = 2026 as const;
export type LegacyIngestionSeason = (typeof LEGACY_INGESTION_SEASONS)[number];
export type ArchivedSeason = (typeof SEASONS)[number];
export type Season = ArchivedSeason;

const RAW_DIR = path.join(process.cwd(), "data", "historical", "raw");
// Basketball-Reference asks crawlers to stay under 20 requests/minute.
const FETCH_DELAY_MS = 3500;

const BBREF_PAGES = {
  playoffBracket: (year: number) =>
    `https://www.basketball-reference.com/playoffs/NBA_${year}.html`,
  playoffGames: (year: number) =>
    `https://www.basketball-reference.com/playoffs/NBA_${year}_games.html`,
  teamRatings: (year: number) =>
    `https://www.basketball-reference.com/leagues/NBA_${year}_ratings.html`,
  playerAdvanced: (year: number) =>
    `https://www.basketball-reference.com/leagues/NBA_${year}_advanced.html`,
  leagueStandings: (year: number) =>
    `https://www.basketball-reference.com/leagues/NBA_${year}_standings.html`,
  aprilGames: (year: number) =>
    `https://www.basketball-reference.com/leagues/NBA_${year}_games-april.html`,
} as const;

// -- Raw data types ----------------------------------------------------------

export type RawSeriesResult = {
  season: number;
  round: string;
  conference: string;
  teamA: string;
  teamB: string;
  seedA: number;
  seedB: number;
  winsA: number;
  winsB: number;
};

export type RawGameResult = {
  season: number;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
};

export type RawTeamRating = {
  season: number;
  teamId: string;
  teamName: string;
  conference: "East" | "West";
  wins: number;
  losses: number;
  ortg: number;
  drtg: number;
  netRating: number;
  srs: number;
};

export type RawPlayerAdvanced = {
  season: number;
  name: string;
  teamId: string;
  gamesPlayed: number;
  mpg: number;
  bpm: number;
};

export type RawConferenceSeed = {
  season: number;
  teamId: string;
  conference: "East" | "West";
  regularSeasonSeed: number;
};

export type RawPlayInGame = {
  season: number;
  date: string;
  conference: "East" | "West";
  stage: "seventh_seed_game" | "elimination_game" | "eighth_seed_game";
  homeTeam: string;
  awayTeam: string;
  homeRegularSeasonSeed: number;
  awayRegularSeasonSeed: number;
  homeScore: number;
  awayScore: number;
  winner: string;
  loser: string;
  playoffSeedAwarded: 7 | 8 | null;
};

// -- Cache helpers -----------------------------------------------------------

function cachePath(year: number, pageKey: string): string {
  return path.join(RAW_DIR, String(year), `${pageKey}.html`);
}

function isCached(year: number, pageKey: string): boolean {
  return fs.existsSync(cachePath(year, pageKey));
}

function readCache(year: number, pageKey: string): string {
  return fs.readFileSync(cachePath(year, pageKey), "utf-8");
}

function writeCache(year: number, pageKey: string, html: string): void {
  const dir = path.join(RAW_DIR, String(year));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(cachePath(year, pageKey), html, "utf-8");
}

// -- Fetch with caching ------------------------------------------------------

let lastFetchAt = 0;

async function fetchWithCache(
  year: number,
  pageKey: string,
  url: string,
): Promise<string> {
  if (isCached(year, pageKey)) {
    return readCache(year, pageKey);
  }

  const elapsed = Date.now() - lastFetchAt;
  if (elapsed < FETCH_DELAY_MS) {
    await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS - elapsed));
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; playoff-pulse-backtest/1.0; research use)",
    },
  });

  if (!response.ok) {
    throw new Error(`BBRef fetch failed: ${response.status} ${response.statusText} - ${url}`);
  }

  lastFetchAt = Date.now();
  const html = await response.text();
  writeCache(year, pageKey, html);
  return html;
}

// -- BBRef comment-block extraction -----------------------------------------

export function extractCommentedTable(html: string, tableId: string): string | null {
  const commentPattern = /<!--([\s\S]*?)-->/g;
  let match: RegExpExecArray | null;
  while ((match = commentPattern.exec(html)) !== null) {
    if (
      match[1].includes(`id="${tableId}"`) ||
      match[1].includes(`id='${tableId}'`)
    ) {
      return match[1];
    }
  }
  return null;
}

// -- Parser helpers ----------------------------------------------------------

function parseNumber(value: string): number {
  const parsed = Number(value.replace(/,/g, "").trim());
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected numeric value, received "${value}".`);
  }
  return parsed;
}

function parseOptionalNumber(value: string): number | null {
  const trimmed = value.replace(/,/g, "").trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function teamIdFromHref(href: string | undefined): string {
  const match = href?.match(/\/teams\/([A-Z0-9]{3})\/\d{4}\.html/);
  if (!match) {
    throw new Error(`Could not parse team id from href "${href ?? ""}".`);
  }
  return match[1];
}

function normalizeConference(value: string): "East" | "West" | "Finals" {
  if (value.includes("Eastern")) {
    return "East";
  }
  if (value.includes("Western")) {
    return "West";
  }
  if (value === "Finals") {
    return "Finals";
  }
  throw new Error(`Unknown playoff conference from round label "${value}".`);
}

/**
 * NBA membership by completed season. This is deliberately independent of
 * playoff-bracket size: the 1984-2026 playoff bracket has eight teams per
 * conference even while the league itself expands from 23 to 30 teams.
 */
export function expectedLeagueTeamCount(season: number): number {
  if (season >= 1984 && season <= 1988) {
    return 23;
  }
  if (season === 1989) {
    return 25;
  }
  if (season >= 1990 && season <= 1995) {
    return 27;
  }
  if (season >= 1996 && season <= 2004) {
    return 29;
  }
  if (season >= 2005 && season <= HOLDOUT_SEASON) {
    return 30;
  }
  throw new Error(`No NBA league-size contract is registered for ${season}.`);
}

export type ParsedSeriesRow = RawSeriesResult & {
  game1HomeTeam: string;
};

export function inferSeedMap(
  rows: ParsedSeriesRow[],
  ratings: RawTeamRating[],
  season: number,
): Map<string, number> {
  const seedMap = new Map<string, number>();
  const playoffTeams = new Set(rows.flatMap((row) => [row.teamA, row.teamB]));

  for (const conference of ["East", "West"] as const) {
    const firstRoundRows = rows.filter(
      (row) => row.conference === conference && row.round.includes("First Round"),
    );
    const homeCourtTeams = new Set(firstRoundRows.map((row) => row.game1HomeTeam));
    const topSeeds = ratings
      .filter(
        (rating) =>
          rating.conference === conference &&
          playoffTeams.has(rating.teamId) &&
          homeCourtTeams.has(rating.teamId),
      )
      .sort((a, b) => b.wins - a.wins || a.losses - b.losses || b.netRating - a.netRating);

    if (topSeeds.length !== 4) {
      throw new Error(
        `Expected 4 ${conference} first-round home-court teams in ${season}, found ${topSeeds.length}.`,
      );
    }

    topSeeds.forEach((rating, index) => {
      seedMap.set(rating.teamId, index + 1);
    });

    for (const row of firstRoundRows) {
      const homeSeed = seedMap.get(row.game1HomeTeam);
      if (!homeSeed) {
        throw new Error(`Missing inferred seed for ${row.game1HomeTeam}.`);
      }
      const opponent = row.teamA === row.game1HomeTeam ? row.teamB : row.teamA;
      seedMap.set(opponent, 9 - homeSeed);
    }
  }

  return seedMap;
}

// -- Parsers -----------------------------------------------------------------

export function parsePlayoffBracket(
  html: string,
  season: number,
  ratings: RawTeamRating[],
): RawSeriesResult[] {
  const $ = cheerio.load(html);
  const table = $("#all_playoffs");
  if (table.length === 0) {
    throw new Error("Could not find #all_playoffs table on playoff bracket page.");
  }

  const parsedRows: ParsedSeriesRow[] = [];

  table.children("tbody").children("tr").each((_, row) => {
    const rowNode = $(row);
    if (rowNode.hasClass("toggleable") || rowNode.hasClass("thead")) {
      return;
    }

    const cells = rowNode.children("td");
    if (cells.length < 3) {
      return;
    }

    const round = cells.eq(0).text().replace(/\s+/g, " ").trim();
    if (!round) {
      return;
    }

    const matchupCell = cells.eq(1);
    const teamLinks = matchupCell.find("a[href^='/teams/']").toArray();
    if (teamLinks.length < 2) {
      throw new Error(`Could not parse teams from playoff row "${matchupCell.text()}".`);
    }

    const teamA = teamIdFromHref($(teamLinks[0]).attr("href"));
    const teamB = teamIdFromHref($(teamLinks[1]).attr("href"));
    const winsMatch = matchupCell.text().match(/\((\d+)-(\d+)\)/);
    if (!winsMatch) {
      throw new Error(`Could not parse series wins from "${matchupCell.text()}".`);
    }

    const firstGameHomeHref = rowNode
      .next("tr.toggleable")
      .find("a[href^='/boxscores/']")
      .first()
      .attr("href");
    const homeMatch = firstGameHomeHref?.match(/\/boxscores\/\d{9}([A-Z0-9]{3})\.html/);
    if (!homeMatch) {
      throw new Error(`Could not parse Game 1 home team for ${round}: ${teamA}-${teamB}.`);
    }

    parsedRows.push({
      season,
      round,
      conference: normalizeConference(round),
      teamA,
      teamB,
      seedA: 0,
      seedB: 0,
      winsA: parseNumber(winsMatch[1]),
      winsB: parseNumber(winsMatch[2]),
      game1HomeTeam: homeMatch[1],
    });
  });

  if (parsedRows.length !== 15) {
    throw new Error(`Expected 15 playoff series for ${season}, parsed ${parsedRows.length}.`);
  }

  const seedMap = inferSeedMap(parsedRows, ratings, season);

  return parsedRows.map((parsedRow) => {
    const { game1HomeTeam, ...row } = parsedRow;
    void game1HomeTeam;
    const seedA = seedMap.get(row.teamA);
    const seedB = seedMap.get(row.teamB);
    if (!seedA || !seedB) {
      throw new Error(`Missing seed for parsed series ${row.teamA}-${row.teamB}.`);
    }
    return { ...row, seedA, seedB };
  });
}

export function parsePlayoffGames(html: string, season: number): RawGameResult[] {
  const $ = cheerio.load(html);
  const table = $("#schedule");
  if (table.length === 0) {
    throw new Error("Could not find #schedule table on playoff games page.");
  }

  const games: RawGameResult[] = [];
  table.find("tbody tr").each((_, row) => {
    const rowNode = $(row);
    if (rowNode.hasClass("thead")) {
      return;
    }

    const dateText = rowNode.find("[data-stat='date_game']").text().trim();
    const awayLink = rowNode.find("[data-stat='visitor_team_name'] a").attr("href");
    const homeLink = rowNode.find("[data-stat='home_team_name'] a").attr("href");
    const awayScore = parseOptionalNumber(rowNode.find("[data-stat='visitor_pts']").text());
    const homeScore = parseOptionalNumber(rowNode.find("[data-stat='home_pts']").text());

    if (!dateText || !awayLink || !homeLink || awayScore === null || homeScore === null) {
      return;
    }

    games.push({
      season,
      date: new Date(`${dateText} 00:00:00 GMT-0400`).toISOString().slice(0, 10),
      homeTeam: teamIdFromHref(homeLink),
      awayTeam: teamIdFromHref(awayLink),
      homeScore,
      awayScore,
    });
  });

  if (games.length === 0) {
    throw new Error(`No playoff games parsed for ${season}.`);
  }

  return games;
}

export function parseConferenceSeeds(
  html: string,
  season: number,
): RawConferenceSeed[] {
  const $ = cheerio.load(html);
  const seeds: RawConferenceSeed[] = [];

  for (const [tableId, conference] of [
    ["confs_standings_E", "East"],
    ["confs_standings_W", "West"],
  ] as const) {
    const table = $(`#${tableId}`);
    if (table.length === 0) {
      throw new Error(`Could not find #${tableId} on league standings page.`);
    }

    let conferenceSeed = 0;
    table.find("tbody tr").each((_, row) => {
      const teamHref = $(row).find("[data-stat='team_name'] a").attr("href");
      if (!teamHref) {
        return;
      }
      conferenceSeed += 1;
      seeds.push({
        season,
        teamId: teamIdFromHref(teamHref),
        conference,
        regularSeasonSeed: conferenceSeed,
      });
    });
  }

  if (
    seeds.filter((row) => row.conference === "East").length !== 15 ||
    seeds.filter((row) => row.conference === "West").length !== 15
  ) {
    throw new Error(
      `Expected 15 teams per conference in ${season} standings, parsed ${seeds.length} total.`,
    );
  }

  return seeds;
}

export function parsePlayInGames(
  html: string,
  season: number,
  conferenceSeeds: RawConferenceSeed[],
): RawPlayInGame[] {
  const $ = cheerio.load(html);
  const table = $("#schedule");
  if (table.length === 0) {
    throw new Error("Could not find #schedule table on April games page.");
  }

  const seedByTeam = new Map(
    conferenceSeeds.map((row) => [
      row.teamId,
      {
        conference: row.conference,
        seed: row.regularSeasonSeed,
      },
    ]),
  );
  const games: RawPlayInGame[] = [];

  table.find("tbody tr").each((_, row) => {
    const rowNode = $(row);
    if (rowNode.find("[data-stat='game_remarks']").text().trim() !== "Play-In Game") {
      return;
    }

    const dateText = rowNode.find("[data-stat='date_game']").text().trim();
    const awayLink = rowNode.find("[data-stat='visitor_team_name'] a").attr("href");
    const homeLink = rowNode.find("[data-stat='home_team_name'] a").attr("href");
    const awayScore = parseOptionalNumber(rowNode.find("[data-stat='visitor_pts']").text());
    const homeScore = parseOptionalNumber(rowNode.find("[data-stat='home_pts']").text());
    if (!dateText || !awayLink || !homeLink || awayScore === null || homeScore === null) {
      throw new Error(`Incomplete play-in result row for ${season}.`);
    }

    const awayTeam = teamIdFromHref(awayLink);
    const homeTeam = teamIdFromHref(homeLink);
    const awayStanding = seedByTeam.get(awayTeam);
    const homeStanding = seedByTeam.get(homeTeam);
    if (!awayStanding || !homeStanding) {
      throw new Error(`Missing conference seed for play-in game ${awayTeam}-${homeTeam}.`);
    }
    if (awayStanding.conference !== homeStanding.conference) {
      throw new Error(`Play-in game crossed conferences: ${awayTeam}-${homeTeam}.`);
    }

    const seedPair = [awayStanding.seed, homeStanding.seed].sort((a, b) => a - b);
    let stage: RawPlayInGame["stage"];
    let playoffSeedAwarded: RawPlayInGame["playoffSeedAwarded"];
    if (seedPair[0] === 7 && seedPair[1] === 8) {
      stage = "seventh_seed_game";
      playoffSeedAwarded = 7;
    } else if (seedPair[0] === 9 && seedPair[1] === 10) {
      stage = "elimination_game";
      playoffSeedAwarded = null;
    } else if (seedPair[0] <= 8 && seedPair[1] >= 9) {
      stage = "eighth_seed_game";
      playoffSeedAwarded = 8;
    } else {
      throw new Error(
        `Unexpected play-in seed pairing ${awayStanding.seed}-${homeStanding.seed} for ${awayTeam}-${homeTeam}.`,
      );
    }

    const winner = homeScore > awayScore ? homeTeam : awayTeam;
    const loser = winner === homeTeam ? awayTeam : homeTeam;
    games.push({
      season,
      date: new Date(`${dateText} 00:00:00 GMT-0400`).toISOString().slice(0, 10),
      conference: homeStanding.conference,
      stage,
      homeTeam,
      awayTeam,
      homeRegularSeasonSeed: homeStanding.seed,
      awayRegularSeasonSeed: awayStanding.seed,
      homeScore,
      awayScore,
      winner,
      loser,
      playoffSeedAwarded,
    });
  });

  if (games.length !== 6) {
    throw new Error(`Expected 6 play-in games for ${season}, parsed ${games.length}.`);
  }

  return games;
}

export function parseTeamRatings(html: string, season: number): RawTeamRating[] {
  const commentedTable = extractCommentedTable(html, "ratings");
  const $ = cheerio.load(commentedTable ?? html);
  const table = $("#ratings");
  if (table.length === 0) {
    throw new Error("Could not find #ratings table on team ratings page.");
  }

  const ratings: RawTeamRating[] = [];
  table.find("tbody tr").each((_, row) => {
    const rowNode = $(row);
    if (rowNode.hasClass("thead")) {
      return;
    }

    const teamCell = rowNode.find("[data-stat='team_name']");
    const teamHref = teamCell.find("a").attr("href");
    if (!teamHref) {
      return;
    }

    const conferenceValue = rowNode.find("[data-stat='conf_id']").text().trim();
    if (conferenceValue !== "E" && conferenceValue !== "W") {
      throw new Error(`Unexpected conference value "${conferenceValue}" in ratings table.`);
    }

    const ortg = parseNumber(rowNode.find("[data-stat='off_rtg']").text());
    const drtg = parseNumber(rowNode.find("[data-stat='def_rtg']").text());
    const netRating = parseNumber(rowNode.find("[data-stat='net_rtg']").text());
    const movAdjusted = parseNumber(rowNode.find("[data-stat='mov_adj']").text());

    ratings.push({
      season,
      teamId: teamIdFromHref(teamHref),
      teamName: teamCell.text().trim(),
      conference: conferenceValue === "E" ? "East" : "West",
      wins: parseNumber(rowNode.find("[data-stat='wins']").text()),
      losses: parseNumber(rowNode.find("[data-stat='losses']").text()),
      ortg,
      drtg,
      netRating,
      srs: movAdjusted,
    });
  });

  const expectedTeamCount = expectedLeagueTeamCount(season);
  if (ratings.length !== expectedTeamCount) {
    throw new Error(
      `Expected ${expectedTeamCount} team ratings for ${season}, parsed ${ratings.length}.`,
    );
  }

  return ratings;
}

export function parsePlayerAdvanced(html: string, season: number): RawPlayerAdvanced[] {
  const commentedTable = extractCommentedTable(html, "advanced");
  const $ = cheerio.load(commentedTable ?? html);
  const table = $("#advanced");
  if (table.length === 0) {
    throw new Error("Could not find #advanced table on player advanced page.");
  }

  const latestByPlayer = new Map<string, RawPlayerAdvanced>();

  table.find("tbody tr").each((_, row) => {
    const rowNode = $(row);
    if (rowNode.hasClass("thead")) {
      return;
    }

    const playerCell = rowNode.find("[data-stat='name_display']");
    const name = playerCell.text().trim();
    const playerKey = playerCell.find("a").attr("href") ?? name;
    const teamId = rowNode.find("[data-stat='team_name_abbr']").text().trim();
    const gamesPlayed = parseOptionalNumber(rowNode.find("[data-stat='games']").text());
    const minutes = parseOptionalNumber(rowNode.find("[data-stat='mp']").text());
    const bpm = parseOptionalNumber(rowNode.find("[data-stat='bpm']").text());

    if (!name || !teamId || gamesPlayed === null || minutes === null || bpm === null) {
      return;
    }

    if (gamesPlayed <= 0) {
      return;
    }

    if (teamId === "TOT" || /^\d+TM$/.test(teamId)) {
      return;
    }

    latestByPlayer.set(playerKey, {
      season,
      name,
      teamId,
      gamesPlayed,
      // The BBRef advanced table's MP column is TOTAL minutes, never per game.
      // An earlier "minutes > 48" heuristic misread deep-bench players with
      // <= 48 total minutes as 40+ MPG starters and corrupted six team
      // snapshots (see docs/CODEBASE_HANDOVER.md, finding P0-3).
      mpg: minutes / gamesPlayed,
      bpm,
    });
  });

  return [...latestByPlayer.values()];
}

// -- Top-level fetcher -------------------------------------------------------

export async function fetchSeasonData(year: Season): Promise<{
  series: RawSeriesResult[];
  games: RawGameResult[];
  teamRatings: RawTeamRating[];
  playerAdvanced: RawPlayerAdvanced[];
  playInGames: RawPlayInGame[];
}> {
  const gamesHtml = await fetchWithCache(year, "playoff-games", BBREF_PAGES.playoffGames(year));
  const ratingsHtml = await fetchWithCache(year, "team-ratings", BBREF_PAGES.teamRatings(year));
  const advancedHtml = await fetchWithCache(
    year,
    "player-advanced",
    BBREF_PAGES.playerAdvanced(year),
  );
  const teamRatings = parseTeamRatings(ratingsHtml, year);
  const bracketHtml = await fetchWithCache(
    year,
    "playoff-bracket",
    BBREF_PAGES.playoffBracket(year),
  );
  let playInGames: RawPlayInGame[] = [];
  if (year === HOLDOUT_SEASON) {
    const standingsHtml = await fetchWithCache(
      year,
      "league-standings",
      BBREF_PAGES.leagueStandings(year),
    );
    const aprilGamesHtml = await fetchWithCache(
      year,
      "april-games",
      BBREF_PAGES.aprilGames(year),
    );
    playInGames = parsePlayInGames(
      aprilGamesHtml,
      year,
      parseConferenceSeeds(standingsHtml, year),
    );
  }

  return {
    series: parsePlayoffBracket(bracketHtml, year, teamRatings),
    games: parsePlayoffGames(gamesHtml, year),
    teamRatings,
    playerAdvanced: parsePlayerAdvanced(advancedHtml, year),
    playInGames,
  };
}

export async function fetchAllSeasons(): Promise<void> {
  for (const season of SEASONS) {
    await fetchSeasonData(season);
  }
}
