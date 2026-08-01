import { describe, expect, it } from "vitest";

import {
  expectedLeagueTeamCount,
  inferSeedMap,
  type ParsedSeriesRow,
  type RawTeamRating,
} from "../scripts/backtest/scrape-bbref";
import { buildSnapshots } from "../scripts/backtest/build-snapshots";
import type { HistoricalSeries } from "../scripts/backtest/types";

function rating(
  teamId: string,
  conference: "East" | "West",
  wins: number,
): RawTeamRating {
  return {
    season: 1984,
    teamId,
    teamName: teamId,
    conference,
    wins,
    losses: 82 - wins,
    ortg: 110,
    drtg: 108,
    netRating: 2,
    srs: 2,
  };
}

function firstRoundRows(conference: "East" | "West"): ParsedSeriesRow[] {
  const prefix = conference === "East" ? "E" : "W";
  return [1, 2, 3, 4].map((seed) => ({
    season: 1984,
    round: `${conference}ern Conference First Round`,
    conference,
    teamA: `${prefix}${seed}`,
    teamB: `${prefix}${9 - seed}`,
    seedA: 0,
    seedB: 0,
    winsA: 3,
    winsB: 0,
    game1HomeTeam: `${prefix}${seed}`,
  }));
}

function ratingsForLeagueSize(teamCount: number): RawTeamRating[] {
  const playoffRatings = (["East", "West"] as const).flatMap((conference) => {
    const prefix = conference === "East" ? "E" : "W";
    return Array.from({ length: 8 }, (_, index) =>
      rating(`${prefix}${index + 1}`, conference, 70 - index * 5),
    );
  });
  const extras = Array.from({ length: teamCount - playoffRatings.length }, (_, index) =>
    rating(`X${String(index).padStart(2, "0")}`, index % 2 ? "East" : "West", 20 - index),
  );
  return [...playoffRatings, ...extras];
}

describe("historical NBA league-size contract", () => {
  it.each([
    [1984, 23],
    [1988, 23],
    [1989, 25],
    [1990, 27],
    [1995, 27],
    [1996, 29],
    [2004, 29],
    [2005, 30],
    [2026, 30],
  ] as const)("registers %i with %i teams", (season, expectedCount) => {
    expect(expectedLeagueTeamCount(season)).toBe(expectedCount);
  });

  it.each([1983, 2027])("fails closed outside the registered range (%i)", (season) => {
    expect(() => expectedLeagueTeamCount(season)).toThrow(
      "No NBA league-size contract is registered",
    );
  });

  it.each([23, 25, 27, 29, 30])(
    "infers the same 1–8 playoff seeds in a %i-team league",
    (teamCount) => {
      const seeds = inferSeedMap(
        [...firstRoundRows("East"), ...firstRoundRows("West")],
        ratingsForLeagueSize(teamCount),
        1984,
      );

      for (const prefix of ["E", "W"]) {
        for (let seed = 1; seed <= 8; seed += 1) {
          expect(seeds.get(`${prefix}${seed}`)).toBe(seed);
        }
      }
      expect(seeds.size).toBe(16);
    },
  );

  it("preserves BBRef SRS directly without a fixed league-size divisor", () => {
    const series: HistoricalSeries[] = [
      {
        id: "1984-east-r1-e1-e8",
        season: 1984,
        round: "First Round",
        conference: "East",
        teamA: "E1",
        teamB: "E8",
        seedA: 1,
        seedB: 8,
        winsA: 3,
        winsB: 0,
        winner: "E1",
        gamesPlayed: 3,
        seriesStartDate: "1984-04-17",
        seriesEndDate: "1984-04-21",
        homePattern: ["E1", "E1", "E8"],
        bubble: false,
      },
    ];
    const ratings = [rating("E1", "East", 60), rating("E8", "East", 35)];
    ratings[0].srs = 4.25;
    ratings[1].srs = -3.5;
    const players = ["E1", "E8"].flatMap((teamId) =>
      Array.from({ length: 6 }, (_, index) => ({
        season: 1984,
        name: `${teamId}-${index}`,
        teamId,
        gamesPlayed: 82,
        mpg: 30,
        bpm: 0,
      })),
    );

    const snapshots = buildSnapshots(ratings, players, series, 1984);
    expect(snapshots.find((row) => row.teamId === "E1")).toMatchObject({
      srs: 4.25,
      eloRating: 1500 + 4.25 * 35,
    });
    expect(snapshots.find((row) => row.teamId === "E8")).toMatchObject({
      srs: -3.5,
      eloRating: 1500 - 3.5 * 35,
    });
  });
});
