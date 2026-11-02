// Replay harness: runs the live logic with a frozen clock over real postseasons,
// which tests April's play-in and playoff handling months before it is needed.

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/season/dates";
import {
  decideMissed,
  decideResults,
  decideSeals,
  sealedGameIds,
  sealGames,
  summarizeRecord,
} from "@/lib/season/live-state";
import { LIVE_PARAMS, REFERENCE_MODEL_VERSION } from "@/lib/season/params";
import {
  buildObservedPostseason,
  crossCheckSeeds,
  detectPhase,
  seasonAsOf,
} from "@/lib/season/postseason";
import { replayRatings } from "@/lib/season/ratings";
import { simulateSeason } from "@/lib/season/simulate";
import { buildStandings, seedConference } from "@/lib/season/standings";
import { SEASON_TEAMS, teamIndex } from "@/lib/season/teams";
import type { LedgerRow, SeasonForecast, SeasonGame } from "@/lib/season/types";
import { ledgerProblems } from "../scripts/live/verify-ledger";

function load(season: number): SeasonGame[] {
  return (
    JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "data/season/games", `${season}.json`), "utf-8"),
    ) as SeasonGame[]
  ).sort((a, b) => Date.parse(a.tipUtc) - Date.parse(b.tipUtc));
}

function forecastAt(games: readonly SeasonGame[], season: number, etDate: string, iterations = 400) {
  const known = seasonAsOf(games, etDate);
  const phase = detectPhase(known, season);
  const replay = replayRatings(known, LIVE_PARAMS, { asOfEtDate: etDate });
  const forecast = simulateSeason({
    season,
    phase,
    observed: phase === "regular-season" ? undefined : buildObservedPostseason(known),
    games: known,
    state: replay.state,
    params: LIVE_PARAMS,
    asOfEtDate: etDate,
    lastGameEtDate: replay.lastGameEtDate,
    iterations,
  });
  return { phase, forecast };
}

function team(forecast: SeasonForecast, abbreviation: string) {
  const id = SEASON_TEAMS.find((row) => row.abbreviation === abbreviation)?.id;
  const row = forecast.teams.find((entry) => entry.teamId === id);
  if (!row) throw new Error(`No team ${abbreviation}`);
  return row;
}

describe("replay of the 2026 postseason", () => {
  const games = load(2026);

  it("detects the phase on each date", () => {
    const phaseOn = (date: string) => detectPhase(seasonAsOf(games, date), 2026);
    expect(phaseOn("2026-04-10")).toBe("regular-season");
    expect(phaseOn("2026-04-13")).toBe("play-in");
    expect(phaseOn("2026-04-15")).toBe("play-in");
    expect(phaseOn("2026-04-18")).toBe("playoffs");
    expect(phaseOn("2026-05-20")).toBe("playoffs");
    expect(phaseOn("2026-06-05")).toBe("playoffs");
    expect(phaseOn("2026-06-14")).toBe("complete");
  });

  it("uses real play-in results as they happen, in any order", () => {
    // After Apr 14: CHA beat MIA in 9v10 and POR beat PHX in 7v8.
    const { forecast, phase } = forecastAt(games, 2026, "2026-04-15");
    expect(phase).toBe("play-in");
    expect(team(forecast, "POR").makePlayoffs).toBe(1);
    expect(team(forecast, "MIA").makePlayoffs).toBe(0);
    expect(team(forecast, "CHA").makePlayoffs).toBeGreaterThan(0);
    expect(team(forecast, "CHA").makePlayoffs).toBeLessThan(1);
    expect(forecast.sums.makePlayoffs).toBeCloseTo(16, 9);
  });

  it("fixes the 16 playoff teams once the play-in is done", () => {
    const { forecast } = forecastAt(games, 2026, "2026-04-18");
    const inPlayoffs = forecast.teams.filter((row) => row.makePlayoffs === 1);
    const out = forecast.teams.filter((row) => row.makePlayoffs === 0);
    expect(inPlayoffs).toHaveLength(16);
    expect(out).toHaveLength(14);
    expect(forecast.sums.champion).toBeCloseTo(1, 9);
    for (const row of out) expect(row.champion).toBe(0);
  });

  it("respects series scores mid-playoffs and drops eliminated teams to zero", () => {
    const known = seasonAsOf(games, "2026-05-10");
    const observed = buildObservedPostseason(known);
    const { forecast } = forecastAt(games, 2026, "2026-05-10");
    expect(forecast.series.length).toBe(observed.series.length);
    for (const series of forecast.series) {
      expect(series.homeCourtSeriesProbability).toBeGreaterThanOrEqual(0);
      expect(series.homeCourtSeriesProbability).toBeLessThanOrEqual(1);
      if (series.homeCourtWins === 4) expect(series.homeCourtSeriesProbability).toBe(1);
      if (series.otherWins === 4) {
        expect(series.homeCourtSeriesProbability).toBe(0);
        const loser = forecast.teams.find((row) => row.teamId === series.homeCourtId);
        expect(loser?.champion).toBe(0);
      }
      if (series.homeCourtWins === 4) {
        const loser = forecast.teams.find((row) => row.teamId === series.otherId);
        expect(loser?.champion).toBe(0);
      }
    }
    expect(forecast.sums.champion).toBeCloseTo(1, 9);
  });

  it("leaves only the two finalists alive during the Finals", () => {
    const { forecast } = forecastAt(games, 2026, "2026-06-05");
    const alive = forecast.teams.filter((row) => row.champion > 0);
    expect(alive.map((row) => teamIndex(row.teamId)).sort()).toEqual(
      [teamIndex("18"), teamIndex("24")].sort(),
    );
    expect(forecast.series.find((row) => row.round === "finals")).toBeDefined();
    expect(team(forecast, "NY").reachFinals).toBe(1);
    expect(team(forecast, "SA").reachFinals).toBe(1);
  });

  it("ends with the real champion at 100%", () => {
    const { forecast, phase } = forecastAt(games, 2026, "2026-06-14");
    expect(phase).toBe("complete");
    expect(team(forecast, "NY").champion).toBe(1);
    const finals = forecast.series.find((row) => row.round === "finals");
    expect(finals).toBeDefined();
    expect(Math.max(finals?.homeCourtWins ?? 0, finals?.otherWins ?? 0)).toBe(4);
  });

  it("gives the home-court team the better record in every series", () => {
    const table = buildStandings(games);
    const { forecast } = forecastAt(games, 2026, "2026-06-14");
    expect(forecast.series.length).toBe(15);
    for (const series of forecast.series) {
      const homeCourt = teamIndex(series.homeCourtId);
      const other = teamIndex(series.otherId);
      expect(table.wins[homeCourt]).toBeGreaterThanOrEqual(table.wins[other]);
    }
  });

  it("seals every postseason game before tip, and scores each one", () => {
    const postseasonDates = [
      ...new Set(
        games
          .filter((game) => game.kind === "play-in" || game.kind === "playoff")
          .map((game) => game.etDate),
      ),
    ].sort();
    const postseasonGames = games.filter(
      (game) => (game.kind === "play-in" || game.kind === "playoff") && game.status === "final",
    );
    let ledger: LedgerRow[] = [];
    for (const date of postseasonDates) {
      // A run at 07:00 ET, then one the next morning to record results.
      const known = seasonAsOf(games, date, { includeSlate: true });
      const nowIso = `${date}T11:00:00Z`;
      const sealedIds = sealedGameIds(ledger, REFERENCE_MODEL_VERSION, "morning");
      const decisions = decideSeals(known, sealedIds, nowIso);
      for (const decision of decisions) expect(decision.inputsIncomplete).toBe(false);
      const seals = sealGames(decisions, {
        history: [],
        seasonGames: known,
        params: LIVE_PARAMS,
        modelVersion: REFERENCE_MODEL_VERSION,
        runId: "replay",
        nowIso,
        marketFor: () => null,
      });
      ledger = [...ledger, ...seals];
      const later = seasonAsOf(games, addDays(date, 1));
      const laterIso = `${addDays(date, 1)}T10:00:00Z`;
      ledger = [...ledger, ...decideMissed(later, ledger, laterIso, REFERENCE_MODEL_VERSION)];
      ledger = [...ledger, ...decideResults(later, ledger, laterIso)];
    }
    expect(ledgerProblems(ledger)).toEqual([]);
    expect(ledger.filter((row) => row.type === "missed")).toEqual([]);
    const sealed = new Set(
      ledger.filter((row) => row.type === "seal").map((row) => row.gameId),
    );
    for (const game of postseasonGames) expect(sealed.has(game.id)).toBe(true);
    const record = summarizeRecord(ledger, REFERENCE_MODEL_VERSION, 0.56);
    expect(record.scored).toBe(postseasonGames.length);
    expect(record.pending).toBe(0);
    expect(record.brier).toBeGreaterThan(0.15);
    expect(record.brier).toBeLessThan(0.3);
  });
});

describe.each([2022, 2023, 2024, 2025])("replay of the %i postseason", (season) => {
  const games = load(season);
  const playInDates = games
    .filter((game) => game.kind === "play-in")
    .map((game) => game.etDate)
    .sort();
  const firstRound = games
    .filter((game) => game.kind === "playoff")
    .map((game) => game.etDate)
    .sort();
  const last = firstRound[firstRound.length - 1];

  it("holds every invariant through each phase and ends with one champion", () => {
    const dates = [
      playInDates[0],
      addDays(playInDates[playInDates.length - 1], 1),
      addDays(firstRound[0], 7),
      addDays(firstRound[0], 30),
      addDays(last, 1),
    ];
    const phases = dates.map((date) => {
      const { forecast, phase } = forecastAt(games, season, date, 200);
      expect(forecast.sums.champion).toBeCloseTo(1, 9);
      expect(forecast.sums.makePlayoffs).toBeCloseTo(16, 9);
      expect(forecast.sums.topSix).toBeCloseTo(12, 9);
      expect(forecast.sums.playIn).toBeCloseTo(8, 9);
      return { phase, forecast };
    });
    expect(phases[0].phase).toBe("play-in");
    expect(phases[phases.length - 1].phase).toBe("complete");
    const final = phases[phases.length - 1].forecast;
    expect(final.teams.filter((row) => row.champion === 1)).toHaveLength(1);
    expect(final.series).toHaveLength(15);
  });

  it("agrees with the bracket that actually happened", () => {
    const known = seasonAsOf(games, addDays(last, 1));
    const table = buildStandings(known);
    const observed = buildObservedPostseason(known);
    const firstRoundSeries = observed.series.filter((row) => row.round === "first-round");
    expect(firstRoundSeries).toHaveLength(8);
    for (const conference of ["East", "West"] as const) {
      const order = seedConference(conference, table);
      for (let seed = 0; seed < 6; seed += 1) {
        const inSeries = firstRoundSeries.some(
          (row) => row.teamA === order[seed] || row.teamB === order[seed],
        );
        expect(inSeries).toBe(true);
      }
    }
  });
});

describe("live seed cross-check", () => {
  it("passes on real pre-play-in seeds, and catches a wrong one", () => {
    const games = seasonAsOf(load(2026), "2026-04-13");
    const table = buildStandings(games);
    const seeds = SEASON_TEAMS.map((row) => ({ teamId: row.id, playoffSeed: null as number | null }));
    for (const conference of ["East", "West"] as const) {
      seedConference(conference, table).forEach((index, position) => {
        seeds[index].playoffSeed = position + 1;
      });
    }
    expect(crossCheckSeeds(seeds, games)).toEqual([]);
    const swapped = seeds.map((row) =>
      row.playoffSeed === 1 ? { ...row, playoffSeed: 2 } : row,
    );
    expect(crossCheckSeeds(swapped, games).length).toBeGreaterThan(0);
  });
});
