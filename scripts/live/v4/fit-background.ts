// v4 fit, S1: background availability, on box scores of the open seasons under rolling
// origin (registration-v4.md, S1). The rule fitted:
//
//   A_p(j) = a_p + (1 - a_p) 0.5^((j - 1) / halfLife),
//   a_p = (played + m r_tier) / (games + m),
//
// with `games` and `played` his team games as a member and games played this season to
// date and last season, and r_tier the league share for his minutes tier (running-average
// minutes < 12, 12-20, 20-28, 28+) over the fit seasons. Observations: every Monday from
// November 1 to April 1, every member of every team who played its last game and is not on
// its latest report rows; outcomes: whether he plays each of the team's next 60 games with
// usable lines (for that team). halfLife and m are chosen from a frozen grid by mean squared
// error (A(1) = 1 makes log loss unusable). One set per origin S (2015-16 to 2023-24) fitted
// on 2011-12 to S - 1 (2010-11 only warms a-bar), and the frozen set on 2011-12 to 2023-24.
//
// Run: corepack pnpm exec tsx scripts/live/v4/fit-background.ts

import * as fs from "node:fs";
import * as path from "node:path";
import { availabilityAt, longRunRate, minutesTier, S1_TIERS, type BackgroundParams } from "../../../src/lib/season/availability-v4";
import { createMinutesState, recordRows, recordTeamGame, setOpeningRosters, teamRows } from "../../../src/lib/season/minutes-v4";
import { sideListing } from "../../../src/lib/season/roster-state";
import { V4_FIXED } from "../../../src/lib/season/params-v4";
import { devOpeningRosters } from "./dev-data";
import { finalPoint, openData } from "./engine-run";

export const HALF_LIVES = [5, 10, 20, 40, 80, 160];
export const SHRINKAGES = [5, 10, 20, 40, 80];
/**
 * The one widening, used only for a grid whose best value sits on an edge (as v2's fit did).
 * Added after the first run, on fit seasons only: both best values sat on edges (half-life 5,
 * m 80) at every origin.
 */
export const WIDER_HALF_LIVES = [1, 2, 3, ...HALF_LIVES];
export const WIDER_SHRINKAGES = [...SHRINKAGES, 160, 320, 640];
const HORIZON = 60;
const ORIGINS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

type Observation = { season: number; tier: number; games: number; played: number; outcomes: number[] };

function collect(): Observation[] {
  const { games, lines } = openData();
  const observations: Observation[] = [];
  const bySeason = new Map<number, typeof games>();
  for (const game of games) {
    if (game.status !== "final" || game.kind !== "regular") continue;
    const list = bySeason.get(game.season) ?? [];
    list.push(game);
    bySeason.set(game.season, list);
  }
  const state = createMinutesState();
  for (const [season, seasonGames] of [...bySeason].sort(([a], [b]) => a - b)) {
    setOpeningRosters(state, devOpeningRosters(season));
    // each team's games with usable lines, in order, with who played
    const teamGames = new Map<string, Array<{ etDate: string; played: Set<string> }>>();
    for (const game of seasonGames) {
      for (const teamId of [game.homeId, game.awayId]) {
        const own = (lines(game.id)?.[teamId] ?? []).filter((line) => line[1] > 0);
        if (own.reduce((sum, line) => sum + line[1], 0) < V4_FIXED.usableTeamMinutes) continue;
        const list = teamGames.get(teamId) ?? [];
        list.push({ etDate: game.etDate, played: new Set(own.map((line) => line[0])) });
        teamGames.set(teamId, list);
      }
    }
    const position = new Map<string, number>();
    const checkpoints = new Set<string>();
    for (const game of seasonGames) {
      const day = new Date(`${game.etDate}T12:00:00Z`);
      const md = game.etDate.slice(5);
      if (day.getUTCDay() === 1 && (md >= "11-01" || md <= "04-01")) checkpoints.add(game.etDate);
    }
    let index = 0;
    while (index < seasonGames.length) {
      const etDate = seasonGames[index].etDate;
      if (checkpoints.has(etDate)) {
        for (const teamId of [...state.members.keys()].sort()) {
          const upcoming = (teamGames.get(teamId) ?? []).slice(position.get(teamId) ?? 0, (position.get(teamId) ?? 0) + HORIZON);
          if ((position.get(teamId) ?? 0) === 0 || upcoming.length === 0) continue;
          for (const athleteId of [...(state.members.get(teamId) ?? [])].sort()) {
            const player = state.players.get(athleteId);
            if (!player || player.presence !== 1 || player.listed || player.missed !== 0 || player.average === null) continue;
            const now = player.participation.get(season) ?? { games: 0, played: 0 };
            const before = player.participation.get(season - 1) ?? { games: 0, played: 0 };
            observations.push({
              season,
              tier: minutesTier(player.average),
              games: now.games + before.games,
              played: now.played + before.played,
              outcomes: upcoming.map((entry) => (entry.played.has(athleteId) ? 1 : 0)),
            });
          }
        }
      }
      while (index < seasonGames.length && seasonGames[index].etDate === etDate) {
        const game = seasonGames[index++];
        const point = finalPoint(game);
        for (const teamId of [game.homeId, game.awayId]) {
          const own = (lines(game.id)?.[teamId] ?? []).filter((line) => line[1] > 0);
          const listing = sideListing(point, teamId);
          const rows = teamRows(state, teamId, listing);
          if (own.reduce((sum, line) => sum + line[1], 0) >= V4_FIXED.usableTeamMinutes) {
            recordTeamGame(state, season, teamId, own.map((line) => [line[0], line[1]] as [string, number]), rows, 0.15);
            position.set(teamId, (position.get(teamId) ?? 0) + 1);
          }
          recordRows(state, teamId, listing);
        }
      }
    }
  }
  return observations;
}

function fitOn(observations: readonly Observation[]) {
  const first = fitGrid(observations, HALF_LIVES, SHRINKAGES);
  const onEdge =
    first.params.halfLife === HALF_LIVES[0] ||
    first.params.halfLife === HALF_LIVES[HALF_LIVES.length - 1] ||
    first.params.shrinkage === SHRINKAGES[0] ||
    first.params.shrinkage === SHRINKAGES[SHRINKAGES.length - 1];
  if (!onEdge) return { ...first, widened: false };
  return { ...fitGrid(observations, WIDER_HALF_LIVES, WIDER_SHRINKAGES), widened: true, firstGrid: first.params };
}

function fitGrid(observations: readonly Observation[], halfLives: readonly number[], shrinkages: readonly number[]) {
  const tierGames = new Array<number>(S1_TIERS.length).fill(0);
  const tierPlayed = new Array<number>(S1_TIERS.length).fill(0);
  for (const row of observations) {
    tierGames[row.tier] += row.games;
    tierPlayed[row.tier] += row.played;
  }
  const tierRates = tierGames.map((games, tier) => (games > 0 ? tierPlayed[tier] / games : 0.9));
  let best: { params: BackgroundParams; mse: number } | null = null;
  const grid: Array<{ halfLife: number; shrinkage: number; mse: number }> = [];
  for (const halfLife of halfLives) {
    for (const shrinkage of shrinkages) {
      const params: BackgroundParams = { halfLife, shrinkage, tierRates };
      let squared = 0;
      let count = 0;
      for (const row of observations) {
        const rate = longRunRate(row.games, row.played, row.tier, params);
        row.outcomes.forEach((y, offset) => {
          squared += (availabilityAt(offset + 1, rate, params) - y) ** 2;
          count += 1;
        });
      }
      const mse = squared / count;
      grid.push({ halfLife, shrinkage, mse });
      if (!best || mse < best.mse) best = { params, mse };
    }
  }
  return { ...(best as { params: BackgroundParams; mse: number }), observations: observations.length, grid };
}

const all = collect();
const origins: Record<string, unknown> = {};
for (const origin of ORIGINS) {
  origins[String(origin)] = { fitSeasons: [2012, origin - 1], ...fitOn(all.filter((row) => row.season >= 2012 && row.season < origin)) };
  console.log(`[fit-background] origin ${origin}: ${JSON.stringify((origins[String(origin)] as { params: unknown }).params)}`);
}
fs.writeFileSync(
  path.join(process.cwd(), "docs/live/v4-fit-parts/background.json"),
  `${JSON.stringify({ halfLives: HALF_LIVES, shrinkages: SHRINKAGES, widerHalfLives: WIDER_HALF_LIVES, widerShrinkages: WIDER_SHRINKAGES, horizon: HORIZON, origins }, null, 2)}\n`,
  "utf-8",
);
