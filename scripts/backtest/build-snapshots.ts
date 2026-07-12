// Transforms raw scraped data into normalized JSON outputs.
// Reads from data/historical/raw/ and writes:
//   data/historical/series/{year}.json
//   data/historical/games/{year}.json
//   data/historical/team-snapshots/{year}.json
//
// Leakage control: snapshot_as_of is set to the last day of the regular season
// and must be strictly before any playoff series start date.

import * as fs from "node:fs";
import * as path from "node:path";
import type {
  HistoricalConference,
  HistoricalGame,
  HistoricalRound,
  HistoricalSeries,
  TeamSeasonSnapshot,
} from "./types";
import {
  fetchSeasonData,
  type RawGameResult,
  type RawPlayerAdvanced,
  type RawSeriesResult,
  type RawTeamRating,
  type Season,
} from "./scrape-bbref";

// -- Known regular-season end dates -----------------------------------------

export const REGULAR_SEASON_END_DATES: Record<Season, string> = {
  2016: "2016-04-13",
  2017: "2017-04-12",
  2018: "2018-04-11",
  2019: "2019-04-10",
  2020: "2020-08-14",
  2021: "2021-05-16",
  2022: "2022-04-10",
  2023: "2023-04-09",
  2024: "2024-04-14",
  2025: "2025-04-13",
};

export const BUBBLE_SEASON = 2020;

// -- Output paths ------------------------------------------------------------

const DATA_DIR = path.join(process.cwd(), "data", "historical");

function seriesPath(year: number): string {
  return path.join(DATA_DIR, "series", `${year}.json`);
}

function gamesPath(year: number): string {
  return path.join(DATA_DIR, "games", `${year}.json`);
}

function snapshotsPath(year: number): string {
  return path.join(DATA_DIR, "team-snapshots", `${year}.json`);
}

// -- Normalizer helpers ------------------------------------------------------

function compareIsoDate(a: string, b: string): number {
  return a.localeCompare(b);
}

function normalizeRound(round: string): HistoricalRound {
  if (round === "Finals") {
    return "NBA Finals";
  }
  if (round.includes("Conference Finals")) {
    return "Conference Final";
  }
  if (round.includes("Conference Semifinals")) {
    return "Conference Semifinal";
  }
  if (round.includes("First Round")) {
    return "First Round";
  }
  throw new Error(`Unknown historical round "${round}".`);
}

function normalizeConference(conference: string): HistoricalConference {
  if (conference === "East" || conference === "West" || conference === "Finals") {
    return conference;
  }
  throw new Error(`Unknown historical conference "${conference}".`);
}

function roundShort(round: HistoricalRound): string {
  switch (round) {
    case "First Round":
      return "r1";
    case "Conference Semifinal":
      return "csf";
    case "Conference Final":
      return "cf";
    case "NBA Finals":
      return "finals";
  }
}

function conferenceShort(conference: HistoricalConference): string {
  return conference.toLowerCase();
}

function sameTeams(game: RawGameResult, teamA: string, teamB: string): boolean {
  return (
    (game.homeTeam === teamA && game.awayTeam === teamB) ||
    (game.homeTeam === teamB && game.awayTeam === teamA)
  );
}

function sortSeriesGames(games: RawGameResult[]): RawGameResult[] {
  return [...games].sort(
    (a, b) =>
      compareIsoDate(a.date, b.date) ||
      a.homeTeam.localeCompare(b.homeTeam) ||
      a.awayTeam.localeCompare(b.awayTeam),
  );
}

function playoffTeams(series: HistoricalSeries[]): Set<string> {
  return new Set(series.flatMap((row) => [row.teamA, row.teamB]));
}

function seedForTeam(series: HistoricalSeries[], teamId: string): number {
  const seeds = series.flatMap((row) => {
    const matches: number[] = [];
    if (row.teamA === teamId) {
      matches.push(row.seedA);
    }
    if (row.teamB === teamId) {
      matches.push(row.seedB);
    }
    return matches;
  });

  if (seeds.length === 0) {
    throw new Error(`Could not find seed for playoff team ${teamId}.`);
  }

  return seeds[0];
}

// -- Normalizers -------------------------------------------------------------

export function normalizeSeries(
  raw: RawSeriesResult[],
  games: RawGameResult[],
  season: number,
): HistoricalSeries[] {
  return raw.map((row) => {
    const round = normalizeRound(row.round);
    const conference = normalizeConference(row.conference);
    const parsedGames = sortSeriesGames(
      games.filter((game) => game.season === season && sameTeams(game, row.teamA, row.teamB)),
    );

    if (parsedGames.length < 4 || parsedGames.length > 7) {
      throw new Error(
        `Expected 4-7 games for ${season} ${row.teamA}-${row.teamB}, found ${parsedGames.length}.`,
      );
    }

    const rawWinner =
      row.winsA === 4 ? row.teamA : row.winsB === 4 ? row.teamB : null;
    if (!rawWinner) {
      throw new Error(`No 4-win team for ${season} ${row.teamA}-${row.teamB}.`);
    }

    const rowTeamA =
      row.seedA < row.seedB || (row.seedA === row.seedB && row.teamA < row.teamB)
        ? row.teamA
        : row.teamB;
    const rowTeamB = rowTeamA === row.teamA ? row.teamB : row.teamA;
    const seedA = rowTeamA === row.teamA ? row.seedA : row.seedB;
    const seedB = rowTeamB === row.teamB ? row.seedB : row.seedA;
    const winsA = rowTeamA === row.teamA ? row.winsA : row.winsB;
    const winsB = rowTeamB === row.teamB ? row.winsB : row.winsA;

    if (winsA + winsB !== parsedGames.length) {
      throw new Error(
        `Series wins do not match game count for ${season} ${row.teamA}-${row.teamB}.`,
      );
    }

    return {
      id: [
        season,
        conferenceShort(conference),
        roundShort(round),
        rowTeamA.toLowerCase(),
        rowTeamB.toLowerCase(),
      ].join("-"),
      season,
      round,
      conference,
      teamA: rowTeamA,
      teamB: rowTeamB,
      seedA,
      seedB,
      winsA,
      winsB,
      winner: rawWinner,
      gamesPlayed: parsedGames.length,
      seriesStartDate: parsedGames[0].date,
      seriesEndDate: parsedGames[parsedGames.length - 1].date,
      homePattern: parsedGames.map((game) => game.homeTeam),
      bubble: season === BUBBLE_SEASON,
    };
  });
}

export function normalizeGames(
  raw: RawGameResult[],
  series: HistoricalSeries[],
  season: number,
): HistoricalGame[] {
  return series.flatMap((seriesRow) =>
    sortSeriesGames(
      raw.filter(
        (game) =>
          game.season === season &&
          compareIsoDate(game.date, seriesRow.seriesStartDate) >= 0 &&
          compareIsoDate(game.date, seriesRow.seriesEndDate) <= 0 &&
          sameTeams(game, seriesRow.teamA, seriesRow.teamB),
      ),
    ).map((game, index): HistoricalGame => {
      const winner = game.homeScore > game.awayScore ? game.homeTeam : game.awayTeam;
      return {
        seriesId: seriesRow.id,
        gameNumber: index + 1,
        date: game.date,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        homeScore: game.homeScore,
        awayScore: game.awayScore,
        winner,
      };
    }),
  );
}

export function buildSnapshots(
  teamRatings: RawTeamRating[],
  playerAdvanced: RawPlayerAdvanced[],
  series: HistoricalSeries[],
  season: number,
): TeamSeasonSnapshot[] {
  const snapshotAsOf = REGULAR_SEASON_END_DATES[season as Season];
  if (!snapshotAsOf) {
    throw new Error(`No regular-season end date configured for ${season}.`);
  }
  const teams = playoffTeams(series);

  return [...teams]
    .sort()
    .map((teamId): TeamSeasonSnapshot => {
      const rating = teamRatings.find((row) => row.teamId === teamId);
      if (!rating) {
        throw new Error(`No team rating found for playoff team ${teamId}.`);
      }

      const players = playerAdvanced
        .filter((player) => player.teamId === teamId && player.gamesPlayed >= 10)
        .sort((a, b) => b.mpg - a.mpg)
        .slice(0, 10)
        .map((player) => ({
          name: player.name,
          bpm: player.bpm,
          mpg: player.mpg,
          gamesPlayed: player.gamesPlayed,
          impact: player.bpm,
          projectedMinutes: Math.min(player.mpg, 40),
        }));

      return {
        teamId,
        teamName: rating.teamName,
        season,
        conference: rating.conference,
        seed: seedForTeam(series, teamId),
        snapshot_as_of: snapshotAsOf,
        eloRating: 1500 + rating.srs * 35,
        netRating: Number((rating.ortg - rating.drtg).toFixed(2)),
        manualAdjustment: 0,
        players,
        srs: rating.srs,
        ortg: rating.ortg,
        drtg: rating.drtg,
        wins: rating.wins,
        losses: rating.losses,
        eloSource: "srs_proxy",
        playerImpactSource: "bpm_proxy",
      };
    });
}

// -- Validation --------------------------------------------------------------

export type ValidationAnomaly = {
  season: number;
  entityId: string;
  issue: string;
};

export function validateSeries(series: HistoricalSeries[]): ValidationAnomaly[] {
  const anomalies: ValidationAnomaly[] = [];

  for (const row of series) {
    if (row.gamesPlayed < 4 || row.gamesPlayed > 7) {
      anomalies.push({
        season: row.season,
        entityId: row.id,
        issue: `gamesPlayed must be 4-7, got ${row.gamesPlayed}.`,
      });
    }

    const winnerWins =
      row.winner === row.teamA ? row.winsA : row.winner === row.teamB ? row.winsB : null;
    if (winnerWins !== 4) {
      anomalies.push({
        season: row.season,
        entityId: row.id,
        issue: `winner ${row.winner} must have exactly 4 wins, got ${winnerWins ?? "none"}.`,
      });
    }

    if (row.winsA + row.winsB !== row.gamesPlayed) {
      anomalies.push({
        season: row.season,
        entityId: row.id,
        issue: `winsA + winsB must equal gamesPlayed, got ${row.winsA + row.winsB} vs ${row.gamesPlayed}.`,
      });
    }

    if (row.homePattern.length !== row.gamesPlayed) {
      anomalies.push({
        season: row.season,
        entityId: row.id,
        issue: `homePattern length must equal gamesPlayed, got ${row.homePattern.length}.`,
      });
    }

    if (row.bubble !== (row.season === BUBBLE_SEASON)) {
      anomalies.push({
        season: row.season,
        entityId: row.id,
        issue: `bubble flag should be ${row.season === BUBBLE_SEASON}.`,
      });
    }
  }

  return anomalies;
}

export function validateSnapshots(
  snapshots: TeamSeasonSnapshot[],
  series: HistoricalSeries[],
): ValidationAnomaly[] {
  const anomalies: ValidationAnomaly[] = [];
  const snapshotsByTeam = new Map(snapshots.map((snapshot) => [snapshot.teamId, snapshot]));

  for (const snapshot of snapshots) {
    if (snapshot.netRating < -15 || snapshot.netRating > 20) {
      anomalies.push({
        season: snapshot.season,
        entityId: snapshot.teamId,
        issue: `netRating must be plausible (-15 to +20), got ${snapshot.netRating}.`,
      });
    }

    if (snapshot.players.length === 0) {
      anomalies.push({
        season: snapshot.season,
        entityId: snapshot.teamId,
        issue: "snapshot has no qualifying players.",
      });
    }

    for (const player of snapshot.players) {
      // The league's heaviest workloads top out around 43 minutes per game.
      // Anything above this means minutes were parsed as totals, not per game.
      if (player.mpg > 44) {
        anomalies.push({
          season: snapshot.season,
          entityId: snapshot.teamId,
          issue: `${player.name} has implausible minutes per game (${player.mpg}).`,
        });
      }

      if (player.projectedMinutes > 40) {
        anomalies.push({
          season: snapshot.season,
          entityId: snapshot.teamId,
          issue: `${player.name} has projectedMinutes above the 40-minute cap (${player.projectedMinutes}).`,
        });
      }
    }
  }

  for (const row of series) {
    for (const teamId of [row.teamA, row.teamB]) {
      const snapshot = snapshotsByTeam.get(teamId);
      if (!snapshot) {
        anomalies.push({
          season: row.season,
          entityId: row.id,
          issue: `missing snapshot for ${teamId}.`,
        });
        continue;
      }

      if (snapshot.snapshot_as_of >= row.seriesStartDate) {
        anomalies.push({
          season: row.season,
          entityId: row.id,
          issue: `snapshot_as_of for ${teamId} (${snapshot.snapshot_as_of}) must be before seriesStartDate (${row.seriesStartDate}).`,
        });
      }
    }
  }

  return anomalies;
}

function validateTeamRatings(ratings: RawTeamRating[]): ValidationAnomaly[] {
  return ratings
    .filter((rating) => rating.netRating < -15 || rating.netRating > 20)
    .map((rating) => ({
      season: rating.season,
      entityId: rating.teamId,
      issue: `team rating netRating must be plausible (-15 to +20), got ${rating.netRating}.`,
    }));
}

function throwIfAnomalies(anomalies: ValidationAnomaly[]): void {
  if (anomalies.length === 0) {
    return;
  }

  const details = anomalies
    .map((anomaly) => `${anomaly.season} ${anomaly.entityId}: ${anomaly.issue}`)
    .join("\n");
  throw new Error(`Historical data validation failed:\n${details}`);
}

// -- Writers -----------------------------------------------------------------

export function writeSeriesJson(year: number, series: HistoricalSeries[]): void {
  fs.mkdirSync(path.dirname(seriesPath(year)), { recursive: true });
  fs.writeFileSync(seriesPath(year), JSON.stringify(series, null, 2), "utf-8");
}

export function writeGamesJson(year: number, games: HistoricalGame[]): void {
  fs.mkdirSync(path.dirname(gamesPath(year)), { recursive: true });
  fs.writeFileSync(gamesPath(year), JSON.stringify(games, null, 2), "utf-8");
}

export function writeSnapshotsJson(year: number, snapshots: TeamSeasonSnapshot[]): void {
  fs.mkdirSync(path.dirname(snapshotsPath(year)), { recursive: true });
  fs.writeFileSync(snapshotsPath(year), JSON.stringify(snapshots, null, 2), "utf-8");
}

// -- Readers -----------------------------------------------------------------

export function loadSeries(year: number): HistoricalSeries[] {
  return JSON.parse(fs.readFileSync(seriesPath(year), "utf-8")) as HistoricalSeries[];
}

export function loadGames(year: number): HistoricalGame[] {
  return JSON.parse(fs.readFileSync(gamesPath(year), "utf-8")) as HistoricalGame[];
}

export function loadSnapshots(year: number): TeamSeasonSnapshot[] {
  return JSON.parse(
    fs.readFileSync(snapshotsPath(year), "utf-8"),
  ) as TeamSeasonSnapshot[];
}

// -- Entry point -------------------------------------------------------------

export async function buildAllSnapshots(seasons: readonly Season[]): Promise<void> {
  for (const season of seasons) {
    const raw = await fetchSeasonData(season);
    const series = normalizeSeries(raw.series, raw.games, season);
    const games = normalizeGames(raw.games, series, season);
    const snapshots = buildSnapshots(raw.teamRatings, raw.playerAdvanced, series, season);
    throwIfAnomalies([
      ...validateTeamRatings(raw.teamRatings),
      ...validateSeries(series),
      ...validateSnapshots(snapshots, series),
    ]);

    writeSeriesJson(season, series);
    writeGamesJson(season, games);
    writeSnapshotsJson(season, snapshots);
  }
}

if (typeof require !== "undefined" && require.main === module) {
  buildAllSnapshots([2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
