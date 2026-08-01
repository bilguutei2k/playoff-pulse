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
import { historicalSeriesFormat } from "../../src/lib/backtest/series-formats";
import type {
  HistoricalConference,
  HistoricalGame,
  HistoricalRound,
  HistoricalSeries,
  TeamSeasonSnapshot,
} from "./types";
import {
  fetchSeasonData,
  SEASONS,
  type RawGameResult,
  type RawPlayerAdvanced,
  type RawSeriesResult,
  type RawTeamRating,
  type Season,
} from "./scrape-bbref";

// -- Known regular-season end dates -----------------------------------------

// Each 1984-2002 cutoff was mechanically verified from Basketball-Reference's
// season schedule: it is the latest schedule date strictly before the first
// date in that season's NBA playoff game log. The source URLs follow
// https://www.basketball-reference.com/leagues/NBA_{year}_games-{month}.html
// and https://www.basketball-reference.com/playoffs/NBA_{year}_games.html.
export const REGULAR_SEASON_END_DATES: Record<Season, string> = {
  1984: "1984-04-15",
  1985: "1985-04-14",
  1986: "1986-04-13",
  1987: "1987-04-19",
  1988: "1988-04-24",
  1989: "1989-04-23",
  1990: "1990-04-22",
  1991: "1991-04-21",
  1992: "1992-04-19",
  1993: "1993-04-25",
  1994: "1994-04-24",
  1995: "1995-04-23",
  1996: "1996-04-21",
  1997: "1997-04-20",
  1998: "1998-04-19",
  1999: "1999-05-05",
  2000: "2000-04-19",
  2001: "2001-04-18",
  2002: "2002-04-17",
  2003: "2003-04-16",
  2004: "2004-04-14",
  2005: "2005-04-20",
  2006: "2006-04-19",
  2007: "2007-04-18",
  2008: "2008-04-16",
  2009: "2009-04-15",
  2010: "2010-04-14",
  2011: "2011-04-13",
  2012: "2012-04-26",
  2013: "2013-04-17",
  2014: "2014-04-16",
  2015: "2015-04-15",
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
  2026: "2026-04-12",
};

export const BUBBLE_SEASON = 2020;
export const PLAYOFF_ROTATION_MINUTES = 240;
export const PLAYER_MINUTE_CAP = 40;

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

type RotationInput = {
  mpg: number;
};

/**
 * Converts regular-season MPG into a deterministic 240-minute rotation.
 * Allocation is proportional to MPG, subject to the per-player cap. The
 * iterative pass also handles unusually shallow source rosters without
 * silently losing minutes.
 */
export function allocatePlayoffRotation<T extends RotationInput>(players: T[]): number[] {
  if (players.length === 0) {
    return [];
  }

  const weights = players.map((player) =>
    Number.isFinite(player.mpg) ? Math.max(0, player.mpg) : 0,
  );
  const capacity = players.length * PLAYER_MINUTE_CAP;
  if (capacity < PLAYOFF_ROTATION_MINUTES) {
    throw new Error(
      `At least ${Math.ceil(PLAYOFF_ROTATION_MINUTES / PLAYER_MINUTE_CAP)} players are required for a 240-minute rotation.`,
    );
  }
  if (weights.every((weight) => weight === 0)) {
    throw new Error("Cannot allocate a rotation when every MPG weight is zero.");
  }

  const minutes = Array.from({ length: players.length }, () => 0);
  const active = new Set(players.map((_, index) => index));
  let remaining = PLAYOFF_ROTATION_MINUTES;

  while (remaining > 1e-9 && active.size > 0) {
    const activeWeight = [...active].reduce((sum, index) => sum + weights[index], 0);
    const equalShare = activeWeight === 0 ? remaining / active.size : null;
    let allocated = 0;

    for (const index of [...active]) {
      const proposed =
        equalShare ?? remaining * (weights[index] / activeWeight);
      const available = PLAYER_MINUTE_CAP - minutes[index];
      const addition = Math.min(available, proposed);
      minutes[index] += addition;
      allocated += addition;
      if (available - addition <= 1e-9) {
        active.delete(index);
      }
    }

    if (allocated <= 1e-9) {
      break;
    }
    remaining -= allocated;
  }

  if (Math.abs(minutes.reduce((sum, value) => sum + value, 0) - PLAYOFF_ROTATION_MINUTES) > 1e-6) {
    throw new Error("Unable to allocate a complete 240-minute rotation.");
  }

  return minutes.map((value) => Number(value.toFixed(6)));
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
    const format = historicalSeriesFormat(season, round);
    const minimumGames = format.winsRequired;
    const maximumGames = format.winsRequired * 2 - 1;
    const parsedGames = sortSeriesGames(
      games.filter((game) => game.season === season && sameTeams(game, row.teamA, row.teamB)),
    );

    if (parsedGames.length < minimumGames || parsedGames.length > maximumGames) {
      throw new Error(
        `Expected ${minimumGames}-${maximumGames} games for ${season} ${round} ${row.teamA}-${row.teamB}, found ${parsedGames.length}.`,
      );
    }

    const rawWinner =
      row.winsA === format.winsRequired
        ? row.teamA
        : row.winsB === format.winsRequired
          ? row.teamB
          : null;
    if (!rawWinner) {
      throw new Error(
        `No ${format.winsRequired}-win team for ${season} ${round} ${row.teamA}-${row.teamB}.`,
      );
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

      const qualifyingPlayers = playerAdvanced
        .filter((player) => player.teamId === teamId && player.gamesPlayed >= 10)
        .sort((a, b) => b.mpg - a.mpg)
        .slice(0, 10);
      const rotationMinutes = allocatePlayoffRotation(qualifyingPlayers);
      const players = qualifyingPlayers.map((player, index) => ({
          name: player.name,
          bpm: player.bpm,
          mpg: player.mpg,
          gamesPlayed: player.gamesPlayed,
          impact: player.bpm,
          projectedMinutes: rotationMinutes[index],
          availabilityStatus: "unknown_assumed_available" as const,
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
        ratingSource: "srs_point_proxy",
        playerImpactSource: "bpm_proxy",
        rotationSource: "normalized_regular_season_mpg",
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
    const format = historicalSeriesFormat(row.season, row.round);
    const minimumGames = format.winsRequired;
    const maximumGames = format.winsRequired * 2 - 1;

    if (row.gamesPlayed < minimumGames || row.gamesPlayed > maximumGames) {
      anomalies.push({
        season: row.season,
        entityId: row.id,
        issue: `gamesPlayed must be ${minimumGames}-${maximumGames} for ${format.label}, got ${row.gamesPlayed}.`,
      });
    }

    const winnerWins =
      row.winner === row.teamA ? row.winsA : row.winner === row.teamB ? row.winsB : null;
    if (winnerWins !== format.winsRequired) {
      anomalies.push({
        season: row.season,
        entityId: row.id,
        issue: `winner ${row.winner} must have exactly ${format.winsRequired} wins for ${format.label}, got ${winnerWins ?? "none"}.`,
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

    const rotationTotal = snapshot.players.reduce(
      (sum, player) => sum + player.projectedMinutes,
      0,
    );
    if (Math.abs(rotationTotal - PLAYOFF_ROTATION_MINUTES) > 1e-4) {
      anomalies.push({
        season: snapshot.season,
        entityId: snapshot.teamId,
        issue: `projected playoff rotation must total 240 minutes, got ${rotationTotal}.`,
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
    // The lockout-shortened 2011-12 Charlotte team finished at -15.41.
    // Keep a broad corruption guard without rejecting that legitimate extreme.
    .filter((rating) => rating.netRating < -20 || rating.netRating > 20)
    .map((rating) => ({
      season: rating.season,
      entityId: rating.teamId,
      issue: `team rating netRating must be plausible (-20 to +20), got ${rating.netRating}.`,
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
  buildAllSnapshots(SEASONS).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
