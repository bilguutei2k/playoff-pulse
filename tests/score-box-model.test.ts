// The box model on simulated data: possessions and rates as defined, team ratings that add
// up to the adjusted net rating, an opponent adjustment that undoes a lopsided schedule,
// leave-one-game-out regressors, and a lineup regression that recovers the coefficients
// that generated the stints.

import { describe, expect, it } from "vitest";
import type { PlayerBoxLine } from "@/lib/season/player-stats";
import {
  BOX_STATS,
  ROLE_STATS,
  adjustedNetRatings,
  buildSeasonTotals,
  crossValidateLineup,
  fitLineupModel,
  fitRapmTargetModel,
  lineupRows,
  modalPosition,
  netRating,
  positionClass,
  positionNumber,
  rapmTargetRows,
  seasonPieceRatings,
  teamGames,
  teamPossessionEstimate,
  type TeamSeason,
} from "@/lib/score/box-model";
import { simulateLeague } from "./support/score-league";

/** True coefficients of the simulation, `BOX_STATS` order. */
const TRUE_BETA = [0.6, -0.5, -0.15, 0.3, 0.5, -0.8, 0.4, 0.2, 1.2, 0.6, -0.3];

function line(overrides: Partial<PlayerBoxLine>): PlayerBoxLine {
  return {
    athleteId: "1",
    name: "A",
    position: "G",
    starter: true,
    minutes: 24,
    points: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    threePointersMade: 0,
    threePointersAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    plusMinus: 0,
    ...overrides,
  };
}

describe("positions", () => {
  it("maps G, F, C, sub-positions and unknowns", () => {
    expect(["G", "PG", "SG", "F", "SF", "PF", "C", "GF", "FC", "NA", null].map(positionNumber)).toEqual([
      1, 1, 1, 3, 3, 3, 5, 2, 4, 3, 3,
    ]);
    expect(["PG", "SF", "C", "FC", null].map(positionClass)).toEqual(["G", "F", "C", "F", "F"]);
    expect(modalPosition({ F: 3, C: 3, G: 1 })).toBe("C");
    expect(modalPosition({})).toBeNull();
  });
});

describe("possessions", () => {
  it("averages the two teams' FGA − ORB + TOV + 0.44 FTA and splits by minutes", () => {
    const home = [
      line({ athleteId: "h1", minutes: 48, fieldGoalsAttempted: 40, offensiveRebounds: 10, turnovers: 14, freeThrowsAttempted: 25 }),
      line({ athleteId: "h2", minutes: 192, fieldGoalsAttempted: 50, turnovers: 0 }),
    ];
    const away = [line({ athleteId: "a1", minutes: 240, fieldGoalsAttempted: 85, offensiveRebounds: 8, turnovers: 13, freeThrowsAttempted: 20 })];
    expect(teamPossessionEstimate(home)).toBeCloseTo(40 - 10 + 14 + 11 + 50, 10);
    const [h, a] = teamGames({
      gameId: "g",
      season: 2015,
      etDate: "2015-01-01",
      homeId: "H",
      awayId: "A",
      homeScore: 100,
      awayScore: 90,
      box: { H: home, A: away },
      stints: null,
      audit: { source: "inferred", wrongCountPlays: 0, maxPlusMinusGap: 0, plusMinusMisses: 0, maxMinutesGap: 0, homePointsGap: 0, awayPointsGap: 0, rejected: "test" },
    });
    const possessions = (105 + (85 - 8 + 13 + 8.8)) / 2;
    expect(h.possessions).toBeCloseTo(possessions, 10);
    expect(a.possessions).toBeCloseTo(possessions, 10);
    expect(h.lines[0].possessions).toBeCloseTo((possessions * 48) / 48, 10);
    expect(h.lines[1].possessions).toBeCloseTo(possessions * 4, 10);
    expect(h.lines.reduce((s, l) => s + l.possessions, 0)).toBeCloseTo(5 * possessions, 10);
  });
});

describe("team-season sums and ratings", () => {
  const league = simulateLeague({
    seed: "box-sums",
    teams: 8,
    playersPerTeam: 10,
    meetings: 4,
    stintsPerGame: 12,
    possessionsPerStint: 8,
    boxBeta: TRUE_BETA,
  });
  const totals = buildSeasonTotals(league.games, 2015);

  it("a team's possession-weighted ratings times five equal its adjusted net rating", () => {
    const adjusted = adjustedNetRatings(totals.teams.values());
    for (const beta of [TRUE_BETA, BOX_STATS.map(() => 3), BOX_STATS.map((_, k) => k - 5)]) {
      for (const role of [null, ROLE_STATS.map(() => 0.7)]) {
        const ratings = seasonPieceRatings(totals, { beta, role }, adjusted);
        for (const teamId of league.teamIds) {
          const team = ratings.filter((r) => r.teamId === teamId);
          const weight = team.reduce((s, r) => s + r.possessions, 0);
          const mean = team.reduce((s, r) => s + r.possessions * r.rating, 0) / weight;
          expect(5 * mean).toBeCloseTo(adjusted.get(teamId) as number, 9);
        }
      }
    }
  });

  it("team possessions are the game sums; on-court possessions sum to five times them", () => {
    for (const team of totals.teams.values()) {
      const pieces = [...totals.pieces.values()].filter((p) => p.teamId === team.teamId);
      expect(pieces.reduce((s, p) => s + p.possessions, 0)).toBeCloseTo(5 * team.possessions, 8);
      const games = league.games.filter((g) => g.homeId === team.teamId || g.awayId === team.teamId);
      expect(team.games).toBe(games.length);
    }
  });

  it("the opponent adjustment credits a hard schedule and keeps the mean at zero", () => {
    // Three teams: A beats C by 10 per 100 in 2 games; B loses to A by 10 in 2 games.
    // Raw nets: A 0, B −10, C +10... A played both, so A's adjusted is pulled toward its opponents.
    const team = (teamId: string, points: number, opponentPoints: number, opponents: Record<string, number>): TeamSeason => ({
      teamId,
      season: 2015,
      games: 2,
      minutes: 480,
      possessions: Object.values(opponents).reduce((s, v) => s + v, 0),
      points,
      opponentPoints,
      stats: BOX_STATS.map(() => 0),
      opponents,
    });
    // A vs B (200 possessions, A +20) and A vs C (200 possessions, C +20); B vs C (200, even).
    const teams = [
      team("A", 400, 400, { B: 200, C: 200 }),
      team("B", 380, 400, { A: 200, C: 200 }),
      team("C", 420, 400, { A: 200, B: 200 }),
    ];
    expect(netRating(teams[0])).toBe(0);
    const adjusted = adjustedNetRatings(teams);
    // Solve adj = net + mean(opponents): A = 0 + (B + C)/2, B = −5 + (A + C)/2, C = 5 + (A + B)/2.
    // With A + B + C = 0: A = −A/2 → A = 0; B = −5 + C/2, C = 5 + B/2 → B = −10/3, C = 10/3.
    expect(adjusted.get("A")).toBeCloseTo(0, 8);
    expect(adjusted.get("B")).toBeCloseTo(-10 / 3, 8);
    expect(adjusted.get("C")).toBeCloseTo(10 / 3, 8);
    const sim = adjustedNetRatings(totals.teams.values());
    let weighted = 0;
    let weight = 0;
    for (const t of totals.teams.values()) {
      weighted += t.possessions * (sim.get(t.teamId) as number);
      weight += t.possessions;
    }
    expect(weighted / weight).toBeCloseTo(0, 8);
  });

  it("a game's regressors and offset are computed without it; other games' move with it", () => {
    const rows = lineupRows(league.games, { roleAware: false });
    const game = league.games[10];
    // Change game 10's box lines and result only. Its own regressors and offset must not
    // move, because they are computed without it; games of the same teams must.
    const altered = league.games.map((g) =>
      g.gameId !== game.gameId
        ? g
        : {
            ...g,
            homeScore: g.homeScore + 30,
            box: Object.fromEntries(
              Object.entries(g.box).map(([teamId, lines]) => [
                teamId,
                lines.map((l) => ({ ...l, assists: l.assists + 5, steals: l.steals + 3 })),
              ]),
            ),
          },
    );
    const changed = lineupRows(altered, { roleAware: false });
    const byId = new Map(league.games.map((g) => [g.gameId, g]));
    const index = rows.gameIds.indexOf(game.gameId);
    const width = rows.featureCount;
    let ownRows = 0;
    let ownMoved = 0;
    let relatedRows = 0;
    let relatedFeaturesMoved = 0;
    let relatedOffsetMoved = 0;
    for (let row = 0; row < rows.rowCount; row += 1) {
      const featuresEqual = Array.from(rows.features.slice(row * width, (row + 1) * width)).every(
        (v, k) => Math.abs(v - changed.features[row * width + k]) < 1e-8,
      );
      const offsetEqual = Math.abs(rows.offset[row] - changed.offset[row]) < 1e-8;
      if (rows.rowGame[row] === index) {
        ownRows += 1;
        if (!featuresEqual || !offsetEqual) ownMoved += 1;
        continue;
      }
      const other = byId.get(rows.gameIds[rows.rowGame[row]]);
      const teams = new Set([game.homeId, game.awayId]);
      if (other && (teams.has(other.homeId) || teams.has(other.awayId))) {
        relatedRows += 1;
        if (!featuresEqual) relatedFeaturesMoved += 1;
        if (!offsetEqual) relatedOffsetMoved += 1;
      }
    }
    expect(ownRows).toBeGreaterThan(0);
    expect(ownMoved).toBe(0);
    expect(relatedFeaturesMoved).toBe(relatedRows);
    expect(relatedOffsetMoved).toBe(relatedRows);
  });

  it("a game's own regressors differ from the full-season ones", () => {
    const rows = lineupRows(league.games, { roleAware: false });
    const game = league.games[0];
    const stint = (game.stints ?? [])[0];
    const ratings = new Map(
      seasonPieceRatings(totals, { beta: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }).map((r) => [`${r.teamId}|${r.athleteId}`, r]),
    );
    const adjusted = adjustedNetRatings(totals.teams.values());
    // With β = points only, rating − adjNet/5 is the full-season points deviation.
    let fullSeason = 0;
    for (const id of stint.home) fullSeason += (ratings.get(`${game.homeId}|${id}`)?.rating ?? 0) - (adjusted.get(game.homeId) as number) / 5;
    for (const id of stint.away) fullSeason -= (ratings.get(`${game.awayId}|${id}`)?.rating ?? 0) - (adjusted.get(game.awayId) as number) / 5;
    expect(Math.abs(rows.features[0] - fullSeason)).toBeGreaterThan(1e-6);
    expect(Math.abs(rows.features[0] - fullSeason)).toBeLessThan(5);
    expect(rows.offset[0]).not.toBeCloseTo((adjusted.get(game.homeId) as number) - (adjusted.get(game.awayId) as number), 6);
  });
});

describe("lineup regression", () => {
  const league = simulateLeague({
    seed: "box-recovery",
    teams: 16,
    playersPerTeam: 10,
    meetings: 30,
    stintsPerGame: 24,
    possessionsPerStint: 4,
    boxBeta: TRUE_BETA,
    home: 3,
  });

  it("recovers the coefficients that generated the stints", () => {
    const rows = lineupRows(league.games, { roleAware: false });
    expect(rows.rowCount).toBe(league.games.length * 24);
    const cv = crossValidateLineup(
      rows,
      [0, 0.001, 0.01, 0.1].map((alpha) => ({ alpha, roleAlpha: 0 })),
      5,
      "box-cv",
    );
    const fit = fitLineupModel(rows, { alpha: cv.best.alpha, roleAlpha: 0 });
    const errors = fit.beta.map((b, k) => b - TRUE_BETA[k]);
    const scale = Math.sqrt(TRUE_BETA.reduce((s, b) => s + b * b, 0) / TRUE_BETA.length);
    const relativeRmse = Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length) / scale;
    console.log(
      `[box recovery] rows ${rows.rowCount}, alpha ${cv.best.alpha}, home ${fit.home.toFixed(2)}, ` +
        `beta ${fit.beta.map((b) => b.toFixed(2)).join(" ")}; relative RMSE ${relativeRmse.toFixed(3)}`,
    );
    expect(relativeRmse).toBeLessThan(0.2);
    // Every sign right, and the home term near the simulated 3 points per 100.
    fit.beta.forEach((b, k) => expect(Math.sign(b)).toBe(Math.sign(TRUE_BETA[k])));
    expect(Math.abs(fit.home - 3)).toBeLessThan(2);
  });

  it("the role-aware variant finds no position effect where there is none", () => {
    const rows = lineupRows(league.games, { roleAware: true });
    expect(rows.featureCount).toBe(BOX_STATS.length + ROLE_STATS.length);
    const fit = fitLineupModel(rows, { alpha: 0.001, roleAlpha: 0.01 });
    expect(fit.role).not.toBeNull();
    console.log(`[box role] interactions ${(fit.role ?? []).map((g) => g.toFixed(3)).join(" ")} (truth 0)`);
    for (const g of fit.role ?? []) expect(Math.abs(g)).toBeLessThan(0.35);
  });

  it("the cross-check regression on RAPM-like targets recovers the same coefficients", () => {
    const totals = buildSeasonTotals(league.games, 2015);
    // A noise-free "RAPM" equal to the true effect: target − adjNet/5 is β · deviation up to
    // the team-mean term, so the fit should be close to the truth.
    const truth = new Map(
      league.players.map((p) => [p.athleteId, { total: p.offence + p.defence, offencePossessions: 5000, defencePossessions: 5000 }]),
    );
    const rows = rapmTargetRows([totals], truth, 1000);
    const fit = fitRapmTargetModel(rows, [0, 0.01], 5, "target");
    const errors = fit.beta.map((b, k) => b - TRUE_BETA[k]);
    const scale = Math.sqrt(TRUE_BETA.reduce((s, b) => s + b * b, 0) / TRUE_BETA.length);
    expect(Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length) / scale).toBeLessThan(0.3);
  });
});
