import { summarizeRecord, scoredSeal, sealKindOf } from "../../src/lib/season/live-state";
// Checks for the live forecast path: published state, the injury model's invariants,
// NBA seeding rules against real seasons, and the ledger. Runs offline.

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import type { StoredLine } from "../../src/lib/season/box-scores";
import {
  createTracker,
  expectedFurtherGames,
  lostValue,
  recordPlayerGame,
  type ReportPoint,
} from "../../src/lib/season/injury-model";
import {
  absenceDetail,
  injuryModelHash,
  replayFullStrength,
  sealInjuryGames,
  type InjuryModel,
} from "../../src/lib/season/live-injury";
import { currentAbsences } from "../../src/lib/season/injury-model";
import {
  derivePlayerFiles,
  type PlayerGamesDay,
  type PlayerIndexFile,
  type ResolvedListing,
  type TeamPlayersFile,
} from "../../src/lib/season/player-stats";
import {
  PROJECTION_ONLY_KEYS,
  projectionProblems,
  projectUpcomingGames,
  teamInjuryLists,
  teamInjuryProblems,
  type ProjectionsFile,
  type TeamInjuriesFile,
} from "../../src/lib/season/projections";
import {
  siteFileContent,
  sitePlayerIndexPath,
  siteProjectionsPath,
  siteTeamInjuriesPath,
  siteTeamPlayersPath,
  isModelViewPath,
} from "../../src/lib/season/site-files";
import {
  INJURY_PARAMS,
  INJURY_STATUS_TABLE,
  INJURY_SURVIVAL,
  LIVE_MODEL_VERSION,
  LIVE_PARAMS,
  REFERENCE_MODEL_VERSION,
} from "../../src/lib/season/params";
import { impliedHomeProbability } from "../../src/lib/season/market";
import { createFilterState, paramsHash, predictGame } from "../../src/lib/season/ratings";
import { assertForecastSums, simulateSeason } from "../../src/lib/season/simulate";
import { SEASON_TEAMS, STATE_SIZE, teamIndex } from "../../src/lib/season/teams";
import type { LedgerRow, LiveState, SeasonGame, SealRow } from "../../src/lib/season/types";
import { seasonLabel } from "../../src/lib/season/formats";
import { LIVE_SEASON } from "../live/game-store";
import { runSeedingCheck } from "../live/seeding-check";
import { expectedSiteFiles, publishedSiteFiles } from "../live/site-files";
import { ledgerProblems } from "../live/verify-ledger";
import { upgradeLiveState } from "../../src/lib/season/state-schema";
import { marginBreakdown } from "../../src/lib/view/margin";
import {
  PROJECTION_LABEL,
  isProjectable,
  projectGame,
  scheduleDates,
} from "../../src/lib/view/projection";

const MODEL: InjuryModel = {
  params: LIVE_PARAMS,
  injury: INJURY_PARAMS,
  statusTable: INJURY_STATUS_TABLE,
  survival: INJURY_SURVIVAL,
};

/** The frozen v2 inputs must equal the registered fit file, and keep their shape rules. */
function checkFrozenInjuryInputs(): void {
  const fit = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "docs/live/injury-fit.json"), "utf-8"),
  ) as {
    fitted: typeof INJURY_PARAMS;
    statusTable: Record<string, { absent: number }>;
    survival: { long: number[]; short: number[]; classUsed: boolean };
  };
  assert.deepEqual(INJURY_PARAMS, fit.fitted, "Injury parameters differ from injury-fit.json.");
  assert.deepEqual(
    INJURY_STATUS_TABLE,
    Object.fromEntries(Object.entries(fit.statusTable).map(([code, row]) => [code, row.absent])),
    "Status table differs from injury-fit.json.",
  );
  assert.deepEqual(
    INJURY_SURVIVAL,
    { long: fit.survival.long, short: fit.survival.short, classUsed: fit.survival.classUsed },
    "Survival table differs from injury-fit.json.",
  );
  const order = [INJURY_STATUS_TABLE.O, INJURY_STATUS_TABLE.D, INJURY_STATUS_TABLE.Q, INJURY_STATUS_TABLE.P, INJURY_STATUS_TABLE.A];
  for (let index = 0; index < order.length; index += 1) {
    assert.ok(order[index] >= 0 && order[index] <= 1, "Status shares must be probabilities.");
    if (index > 0) assert.ok(order[index] <= order[index - 1], "Status table must be monotone, Out to Available.");
  }
  assert.ok(
    expectedFurtherGames(INJURY_SURVIVAL, 0, "long") >= expectedFurtherGames(INJURY_SURVIVAL, 0, "short"),
    "A long absence must not be expected to end sooner than a short one at bucket 0.",
  );
}

/** Item 9 of the injury plan: the adjustment moves the right way, and only when it should. */
function checkInjuryInvariants(): void {
  const [A, B, C] = SEASON_TEAMS.map((team) => team.id);
  // A synthetic season: two evenly matched teams, each with a star, a bench player and
  // a player below replacement level.
  const finals: SeasonGame[] = [];
  const box = new Map<string, Record<string, StoredLine[]>>();
  for (let day = 0; day < 24; day += 1) {
    const etDate = new Date(Date.UTC(2026, 9, 21 + day)).toISOString().slice(0, 10);
    const id = `check-${day}`;
    const homeFirst = day % 2 === 0;
    finals.push({
      id,
      season: 2027,
      kind: "regular",
      tipUtc: `${etDate}T23:30Z`,
      etDate,
      homeId: homeFirst ? A : B,
      awayId: homeFirst ? B : A,
      neutral: false,
      status: "final",
      homeScore: homeFirst ? 110 : 104,
      awayScore: homeFirst ? 104 : 110,
    });
    box.set(id, {
      [A]: [["a-star", 36, 28], ["a-bench", 24, 9], ["a-scrub", 12, 1]],
      [B]: [["b-star", 36, 28], ["b-bench", 24, 9], ["b-scrub", 12, 1]],
    });
  }
  const target: SeasonGame = {
    id: "check-target",
    season: 2027,
    kind: "regular",
    tipUtc: "2026-11-20T00:30Z",
    etDate: "2026-11-19",
    homeId: A,
    awayId: B,
    neutral: false,
    status: "scheduled",
    homeScore: null,
    awayScore: null,
  };
  const point = (rows: Array<[string, string, "O" | "D" | "Q" | "P" | "A"]>): ReportPoint => ({
    at: "2026-11-19T18:30",
    notSubmitted: [],
    rows: rows.map(([teamId, athleteId, status]) => ({ teamId, athleteId, status, reason: "Injury/Illness - Knee" })),
  });
  const seal = (report: ReportPoint | null, boxes = box) =>
    sealInjuryGames([{ game: target, inputsIncomplete: false, missingGameIds: [], kind: "final" }], {
      history: [],
      seasonGames: [...finals, target],
      model: MODEL,
      modelVersion: LIVE_MODEL_VERSION,
      referenceModelVersion: REFERENCE_MODEL_VERSION,
      runId: "check",
      nowIso: "2026-11-19T23:45:00Z",
      source: { boxScores: (gameId) => boxes.get(gameId), availability: () => null },
      report: { point: report, stale: false, missing: false },
      nameOf: (athleteId) => athleteId,
      marketFor: () => null,
    })[0];
  const none = seal(null);
  const homeOut = seal(point([[A, "a-star", "O"]]));
  const homeQuestionable = seal(point([[A, "a-star", "Q"]]));
  const homeProbable = seal(point([[A, "a-star", "P"]]));
  const awayOut = seal(point([[B, "b-star", "O"]]));
  const homeTwoOut = seal(point([[A, "a-star", "O"], [A, "a-bench", "O"]]));
  const scrubOut = seal(point([[A, "a-scrub", "O"], [B, "b-scrub", "O"]]));
  assert.ok(
    homeTwoOut.homeWinProbability < homeOut.homeWinProbability &&
      homeOut.homeWinProbability < homeQuestionable.homeWinProbability &&
      homeQuestionable.homeWinProbability < homeProbable.homeWinProbability &&
      homeProbable.homeWinProbability < none.homeWinProbability,
    "More expected absence must lower a team's chance.",
  );
  assert.ok(awayOut.homeWinProbability > none.homeWinProbability, "An absent opponent must raise a team's chance.");
  assert.equal(scrubOut.homeWinProbability, none.homeWinProbability, "A replacement-level absence must change nothing.");
  assert.deepEqual(scrubOut.absence, { home: 0, away: 0 }, "A replacement-level absence must be zero.");
  assert.equal(none.referenceHomeWinProbability, homeOut.referenceHomeWinProbability, "The v1 reference must ignore absences.");
  for (const row of [none, homeOut, homeQuestionable, homeProbable, awayOut, homeTwoOut, scrubOut]) {
    const { absence, absencePoints } = row;
    assert.ok(absence && absencePoints, "A v2 seal must carry its absence term.");
    assert.ok(absence.home >= 0 && absence.away >= 0, "Every absence term must be at least 0.");
    assert.ok(absencePoints.home >= 0 && absencePoints.away >= 0, "Absence points must be at least 0.");
    assert.ok(row.homeWinProbability > 0 && row.homeWinProbability < 1, "Seals must be probabilities.");
  }

  // A team the report marks NOT YET SUBMITTED counts its current absences: here A's star
  // sat out its last two games. A team with nobody missing counts nothing, and a team
  // simply absent from the report has nobody listed.
  const starSat = new Map(box);
  for (const day of [22, 23]) {
    const lines = box.get(`check-${day}`) as Record<string, StoredLine[]>;
    starSat.set(`check-${day}`, { ...lines, [A]: lines[A].filter(([athleteId]) => athleteId !== "a-star") });
  }
  const unfiled = (teamIds: string[]): ReportPoint => ({ ...point([]), notSubmitted: teamIds });
  const homeUnfiled = seal(unfiled([A]), starSat);
  const homeAbsent = seal(point([]), starSat);
  const awayUnfiled = seal(unfiled([B]), starSat);
  assert.ok(
    homeUnfiled.unfiled?.home === true && (homeUnfiled.absence?.home ?? 0) > 0,
    "An unfiled side must count its current absences.",
  );
  assert.ok(
    homeUnfiled.homeWinProbability < homeAbsent.homeWinProbability,
    "Counting an unfiled team's current absences must lower its chance.",
  );
  assert.deepEqual(homeAbsent.absence, { home: 0, away: 0 }, "A team absent from the report has nobody listed.");
  assert.equal(awayUnfiled.homeWinProbability, homeAbsent.homeWinProbability, "An unfiled team with nobody out changes nothing.");
  for (const row of [none, homeOut, homeQuestionable, homeProbable, awayOut, homeTwoOut, scrubOut, homeUnfiled, awayUnfiled]) {
    assert.equal(row.driversComplete, true, "A new v2 seal must list every driver.");
    for (const side of ["home", "away"] as const) {
      const total = (row.drivers?.[side] ?? []).reduce((sum, driver) => sum + driver.points, 0);
      assert.ok(Math.abs(total - (row.absencePoints?.[side] ?? 0)) <= 0.01, "Drivers must add up to the side's points.");
    }
  }

  // Equal teams with equal absences stay even, on a neutral floor.
  const tracker = createTracker();
  for (let game = 0; game < 30; game += 1) {
    recordPlayerGame(tracker.book, A, [["a-star", 34, 24]], INJURY_PARAMS);
    recordPlayerGame(tracker.book, C, [["c-star", 34, 24]], INJURY_PARAMS);
  }
  const both = point([[A, "a-star", "O"], [C, "c-star", "O"]]);
  const home = absenceDetail(both, A, tracker, MODEL, (id) => id).absence;
  const away = absenceDetail(both, C, tracker, MODEL, (id) => id).absence;
  assert.ok(home > 0 && Math.abs(home - away) < 1e-12, "Identical absences must be equal.");
  const even = predictGame(
    createFilterState(LIVE_PARAMS),
    { homeId: A, awayId: C, neutral: true, playoff: false, homeOnBackToBack: false, awayOnBackToBack: false },
    LIVE_PARAMS,
    -INJURY_PARAMS.beta * (home - away),
  );
  assert.ok(Math.abs(even.homeWinProbability - 0.5) < 1e-9, "Equal teams with equal absences must stay even.");
  assert.ok(lostValue(tracker.book, "nobody", INJURY_PARAMS) === 0, "An unknown player is worth nothing.");

  // In the season simulation, absences cost a team wins and title chances.
  const schedule: SeasonGame[] = [];
  for (let round = 0; round < 6; round += 1) {
    SEASON_TEAMS.forEach((team, index) => {
      const other = SEASON_TEAMS[(index + 1 + round) % SEASON_TEAMS.length];
      const etDate = new Date(Date.UTC(2026, 10, 2 + round * 2 + (index % 2))).toISOString().slice(0, 10);
      schedule.push({
        id: `sim-${round}-${index}`,
        season: 2027,
        kind: "regular",
        tipUtc: `${etDate}T23:00Z`,
        etDate,
        homeId: team.id,
        awayId: other.id,
        neutral: false,
        status: "scheduled",
        homeScore: null,
        awayScore: null,
      });
    });
  }
  const simulate = (points: number) => {
    const regular: Record<string, number[]> = {};
    const postseason: Record<string, number> = {};
    for (const team of SEASON_TEAMS) {
      const games = schedule.filter((game) => game.homeId === team.id || game.awayId === team.id).length;
      regular[team.id] = new Array<number>(games).fill(team.id === A ? points : 0);
      postseason[team.id] = team.id === A ? points : 0;
    }
    return simulateSeason({
      season: 2027,
      phase: "regular-season",
      games: schedule,
      state: createFilterState(LIVE_PARAMS),
      params: LIVE_PARAMS,
      asOfEtDate: "2026-11-01",
      lastGameEtDate: Object.fromEntries(SEASON_TEAMS.map((team) => [team.id, null])),
      iterations: 3000,
      absences: { regular, postseason },
    }).teams[teamIndex(A)];
  };
  const healthy = simulate(0);
  const hurt = simulate(6);
  assert.ok(hurt.projectedWins < healthy.projectedWins, "Absences must cost simulated wins.");
  assert.ok(hurt.champion < healthy.champion, "Absences must cost title chances.");
}

function checkSchemaOneState(state: { modelVersion: string; paramsHash: string }): void {
  // Published by v1 before this code first ran; the job replaces it on its next run.
  assert.equal(state.modelVersion, REFERENCE_MODEL_VERSION, "A schema 1 state must come from v1.");
  assert.equal(state.paramsHash, paramsHash(LIVE_PARAMS), "State comes from other parameters.");
}

function checkSchemaTwoState(state: LiveState): void {
  assert.equal(state.modelVersion, LIVE_MODEL_VERSION, "State comes from another model version.");
  assert.equal(state.referenceModelVersion, REFERENCE_MODEL_VERSION, "Unexpected reference model.");
  assert.equal(state.paramsHash, injuryModelHash(MODEL), "State comes from other parameters.");
  assert.deepEqual(state.params, LIVE_PARAMS, "Published rating parameters differ from the frozen ones.");
  assert.deepEqual(
    state.injury,
    { params: INJURY_PARAMS, statusTable: INJURY_STATUS_TABLE, survival: INJURY_SURVIVAL },
    "Published injury model differs from the frozen one.",
  );
  for (const version of [LIVE_MODEL_VERSION, REFERENCE_MODEL_VERSION]) {
    assert.ok(state.records[version], `No record for ${version}.`);
    assert.equal(state.records[version].modelVersion, version, `Record for ${version} is mislabeled.`);
  }
  assert.deepEqual(state.record, state.records[LIVE_MODEL_VERSION], "The headline record must be v2's.");
  assert.ok(state.records[LIVE_MODEL_VERSION].noFinalSeal !== null, "v2 must count games with no final seal.");
  if (state.availability.missing) {
    assert.equal(state.availability.reportAt, null, "Missing availability cannot name a report.");
  }
  for (const team of SEASON_TEAMS) {
    const points = state.absencePoints[team.id];
    assert.ok(points >= 0, `${team.abbreviation} absence points must be at least 0.`);
    const forecastRow = state.forecast.teams.find((row) => row.teamId === team.id);
    assert.ok(forecastRow, `${team.abbreviation} has no forecast row.`);
    assert.ok(
      Math.abs(state.currentRatings[team.id] - (forecastRow.rating - points)) < 0.002,
      `${team.abbreviation} current rating must be full strength minus absence points.`,
    );
  }
  for (const absence of state.absences) {
    assert.ok(SEASON_TEAMS.some((team) => team.id === absence.teamId), "Absence for an unknown team.");
    assert.ok(absence.points > 0, "A published absence must cost something.");
    assert.ok(absence.expectedGames > 0, "A published absence must have games left to miss.");
  }
  for (const [gameId, rows] of Object.entries(state.seals)) {
    assert.ok(Array.isArray(rows) && rows.every((row) => row.gameId === gameId), "Seals must be grouped by game.");
  }
}

/**
 * Projections: the site's unsealed numbers for games still to come. Every one it can
 * show must be a probability, pair with its complement, equal `predictGame` over the
 * published ratings with no injury term, and move the right way with rest and venue.
 * They are labeled as projections and never enter the ledger or the record.
 */
function checkProjections(state: LiveState, games: readonly SeasonGame[]): void {
  assert.match(PROJECTION_LABEL, /before injuries/, "The projection label must say it is before injuries.");
  assert.match(PROJECTION_LABEL, /sealed forecast is issued on game day/, "The projection label must point to the seal.");
  const dates = scheduleDates(state, games);
  let checked = 0;
  for (const game of games) {
    if (!isProjectable(game, state.slateEtDate)) continue;
    const projection = projectGame(state, game, dates);
    const p = projection.homeWinProbability;
    assert.ok(p > 0 && p < 1, `Projection for ${game.id} must be strictly between 0 and 1.`);
    assert.equal(p + projection.awayWinProbability, 1, `Projection for ${game.id} must sum to 1.`);
    const direct = predictGame(
      state.ratings,
      {
        homeId: game.homeId,
        awayId: game.awayId,
        neutral: game.neutral,
        playoff: game.kind === "playoff",
        homeOnBackToBack: projection.homeOnBackToBack,
        awayOnBackToBack: projection.awayOnBackToBack,
      },
      state.params,
    );
    assert.equal(p, direct.homeWinProbability, `Projection for ${game.id} must come from the published ratings.`);
    assert.equal(projection.expectedMargin, direct.expectedMargin, `Projection for ${game.id} must carry no injury term.`);
    const parts = marginBreakdown({
      state,
      context: {
        homeId: game.homeId,
        awayId: game.awayId,
        neutral: game.neutral,
        playoff: game.kind === "playoff",
        homeOnBackToBack: projection.homeOnBackToBack,
        awayOnBackToBack: projection.awayOnBackToBack,
      },
      expectedMargin: projection.expectedMargin,
      absencePoints: null,
      ratingsHash: null,
    });
    assert.ok(parts.separated, `Projection ${game.id} must split into rating and home court.`);
    const shown = parts.parts.reduce((sum, part) => sum + part.display, 0);
    assert.ok(
      Math.abs(shown - Math.round(projection.expectedMargin * 10) / 10) < 1e-9,
      `Projection ${game.id}: the shown margin parts must add up to the shown margin.`,
    );
    checked += 1;
  }
  if (state.slateEtDate < (games.at(-1)?.etDate ?? "")) {
    assert.ok(checked > 0, "A season with games to come must have projections to check.");
  }

  // Rest and venue move a projection the right way; a neutral swap mirrors it.
  const [a, b] = [SEASON_TEAMS[0].id, SEASON_TEAMS[1].id];
  const base = { homeId: a, awayId: b, neutral: false, kind: "regular" as const, etDate: "2027-01-10" };
  const rested = projectGame(state, base, { [a]: ["2027-01-08"], [b]: ["2027-01-08"] });
  const tired = projectGame(state, base, { [a]: ["2027-01-09"], [b]: ["2027-01-08"] });
  assert.ok(tired.homeWinProbability < rested.homeWinProbability, "A home back-to-back must lower the home projection.");
  const neutral = projectGame(state, { ...base, neutral: true }, {});
  const swapped = projectGame(state, { ...base, neutral: true, homeId: b, awayId: a }, {});
  assert.ok(
    Math.abs(neutral.homeWinProbability + swapped.homeWinProbability - 1) < 1e-12,
    "Swapping teams on a neutral court must mirror the projection.",
  );
  assert.ok(
    projectGame(state, base, {}).homeWinProbability > neutral.homeWinProbability,
    "Home court must raise the home team's projection.",
  );
}

/**
 * Projections with the injury term, on a synthetic season: probabilities in (0, 1), home
 * and away summing to one, absences never negative and always lowering their side's
 * chance, drivers adding up to the side's points, the seal rules on a report slate
 * (including an unfiled side), and no projection key ever accepted in the ledger.
 */
function checkProjectionInvariants(): void {
  const [A, B, C] = SEASON_TEAMS.map((team) => team.id);
  const finals: SeasonGame[] = [];
  const box = new Map<string, Record<string, StoredLine[]>>();
  for (let day = 0; day < 24; day += 1) {
    const etDate = new Date(Date.UTC(2026, 9, 21 + day)).toISOString().slice(0, 10);
    const id = `projection-${day}`;
    finals.push({
      id,
      season: 2027,
      kind: "regular",
      tipUtc: `${etDate}T23:30Z`,
      etDate,
      homeId: day % 2 === 0 ? A : B,
      awayId: day % 2 === 0 ? B : C,
      neutral: false,
      status: "final",
      homeScore: 108,
      awayScore: 104,
    });
    const home = day % 2 === 0 ? A : B;
    const away = day % 2 === 0 ? B : C;
    const lines = (teamId: string): StoredLine[] => [[`${teamId}-star`, 36, 26], [`${teamId}-bench`, 24, 9]];
    // C's star sits out the last game he could play: C counts him from box scores.
    box.set(id, { [home]: lines(home), [away]: day === 23 && away === C ? lines(C).slice(1) : lines(away) });
  }
  const scheduled = (id: string, etDate: string, homeId: string, awayId: string): SeasonGame => ({
    id,
    season: 2027,
    kind: "regular",
    tipUtc: `${etDate}T23:30Z`,
    etDate,
    homeId,
    awayId,
    neutral: false,
    status: "scheduled",
    homeScore: null,
    awayScore: null,
  });
  const today = scheduled("projection-today", "2026-11-15", A, B);
  const tomorrow = scheduled("projection-tomorrow", "2026-11-16", C, A);
  const later = scheduled("projection-later", "2026-11-19", B, C);
  const outside = scheduled("projection-outside", "2026-11-25", A, C);
  const games = [...finals, today, tomorrow, later, outside];
  const replay = replayFullStrength(games, MODEL, { boxScores: (gameId) => box.get(gameId), availability: () => null }, { asOfEtDate: today.etDate });
  const current = currentAbsences(replay.tracker, MODEL.injury, MODEL.survival);
  const point = (rows: Array<[string, string, "O" | "Q"]>, notSubmitted: string[] = []): ReportPoint => ({
    at: "2026-11-15T12:00",
    notSubmitted,
    rows: rows.map(([teamId, athleteId, status]) => ({ teamId, athleteId, status, reason: "Injury/Illness - Ankle" })),
  });
  const project = (reports: Array<{ etDate: string; point: ReportPoint }>) =>
    projectUpcomingGames({
      season: 2027,
      seasonLabel: "2026-27",
      modelVersion: LIVE_MODEL_VERSION,
      games,
      fromEtDate: today.etDate,
      ratings: replay.state,
      ratingsHash: "check",
      ratingsThroughUtc: null,
      params: LIVE_PARAMS,
      model: MODEL,
      tracker: replay.tracker,
      current,
      reports: reports.map((report) => ({ ...report, stale: false })),
      nameOf: (athleteId) => athleteId,
    });
  const nobody = project([{ etDate: today.etDate, point: point([]) }]);
  const homeOut = project([{ etDate: today.etDate, point: point([[A, `${A}-star`, "O"]]) }]);
  const awayOut = project([{ etDate: today.etDate, point: point([[B, `${B}-star`, "O"]]) }]);
  const nextSlate = project([
    { etDate: today.etDate, point: point([]) },
    { etDate: tomorrow.etDate, point: { ...point([]), at: "2026-11-15T20:00", notSubmitted: [C, A] } },
  ]);
  const at = (file: ProjectionsFile, id: string) => {
    const found = file.games.find((game) => game.gameId === id);
    assert.ok(found, `Projection ${id} is missing.`);
    return found;
  };
  for (const file of [nobody, homeOut, awayOut, nextSlate]) {
    assert.deepEqual(
      projectionProblems(file, { ratings: replay.state, params: LIVE_PARAMS, games, ledger: [] }),
      [],
      "Synthetic projections must satisfy every projection invariant.",
    );
    assert.deepEqual(file.games.map((game) => game.gameId), [today.id, tomorrow.id, later.id], "Only scheduled games in the seven-day window are projected.");
    for (const game of file.games) {
      assert.ok(game.homeWinProbability > 0 && game.homeWinProbability < 1, "A projection must be a probability.");
      assert.ok(Math.abs(game.homeWinProbability + game.awayWinProbability - 1) < 1e-9, "Home and away must sum to one.");
      assert.ok(game.absencePoints.home >= 0 && game.absencePoints.away >= 0, "Projection absences must be at least 0.");
      for (const side of ["home", "away"] as const) {
        const total = game.drivers[side].reduce((sum, driver) => sum + driver.points, 0);
        assert.ok(Math.abs(total - game.absencePoints[side]) <= 0.01, "Projection drivers must add up to the side's points.");
      }
    }
  }
  assert.ok(at(homeOut, today.id).homeWinProbability < at(nobody, today.id).homeWinProbability, "A listed home absence must lower the home projection.");
  assert.ok(at(awayOut, today.id).homeWinProbability > at(nobody, today.id).homeWinProbability, "A listed away absence must lower the away projection.");
  assert.deepEqual(at(homeOut, today.id).basis, { kind: "report", reportAt: "2026-11-15T12:00", stale: false }, "A report slate's projection names its report.");
  // The next slate's report marks both teams unfiled: each counts current absences, as a seal would.
  const unfiled = at(nextSlate, tomorrow.id);
  assert.deepEqual(unfiled.unfiled, { home: true, away: true }, "Unfiled sides must be marked.");
  assert.ok(unfiled.absencePoints.home > 0, "An unfiled side counts the player who missed its last game.");
  const sealed = sealInjuryGames([{ game: tomorrow, inputsIncomplete: false, missingGameIds: [], kind: "final" }], {
    history: [],
    seasonGames: games,
    model: MODEL,
    modelVersion: LIVE_MODEL_VERSION,
    referenceModelVersion: REFERENCE_MODEL_VERSION,
    runId: "check",
    nowIso: "2026-11-16T22:45:00Z",
    source: { boxScores: (gameId) => box.get(gameId), availability: () => null },
    report: { point: { ...point([]), at: "2026-11-15T20:00", notSubmitted: [C, A] }, stale: false, missing: false },
    nameOf: (athleteId) => athleteId,
    marketFor: () => null,
  })[0];
  assert.deepEqual(unfiled.absencePoints, sealed.absencePoints, "A report slate's injury term must follow the seal rules exactly.");
  assert.deepEqual(unfiled.drivers, sealed.drivers, "A report slate's drivers must be the seal's.");
  assert.equal(at(nobody, later.id).basis.kind, "current-absences", "A game beyond the report slates uses current absences.");
  assert.ok(at(nobody, later.id).absencePoints.away > 0, "Current absences must reach later games.");
  // Team lists agree with the projections.
  const lists: TeamInjuriesFile = teamInjuryLists({
    season: 2027,
    seasonLabel: "2026-27",
    modelVersion: LIVE_MODEL_VERSION,
    games,
    fromEtDate: today.etDate,
    ratings: replay.state,
    ratingsHash: "check",
    ratingsThroughUtc: null,
    params: LIVE_PARAMS,
    model: MODEL,
    tracker: replay.tracker,
    current,
    reports: [{ etDate: today.etDate, point: point([[A, `${A}-star`, "O"]]), stale: false }],
    nameOf: (athleteId) => athleteId,
    teamIds: SEASON_TEAMS.map((team) => team.id),
    reportFile: () => "check",
  });
  assert.deepEqual(teamInjuryProblems(lists, homeOut, SEASON_TEAMS.map((team) => team.id)), [], "Team injury lists must match their projections.");
  // No projection key is ever accepted on a ledger row.
  const leaked = { type: "seal", gameId: "leak", basis: { kind: "current-absences" } } as unknown as LedgerRow;
  assert.ok(projectionProblems(nobody, { ratings: replay.state, params: LIVE_PARAMS, games, ledger: [leaked] }).length > 0, "A projection key in the ledger must be caught.");
}

function readLiveJson<T>(relative: string): T | null {
  const file = path.join(process.cwd(), "data/live", relative);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf-8")) as T) : null;
}

/**
 * The published model views: projections against the state, games and ledger on disk,
 * team lists against the projections, and player files re-derived exactly from the
 * stored player lines (taking report listings and 548 impact from the published files).
 * Skipped until the job first writes them.
 */
function checkModelViews(state: LiveState, games: readonly SeasonGame[], ledger: readonly LedgerRow[]): void {
  const label = seasonLabel(LIVE_SEASON);
  for (const row of ledger) {
    const leaked = PROJECTION_ONLY_KEYS.filter((key) => key in row);
    assert.deepEqual(leaked, [], `Ledger row for ${row.gameId} carries a projection key.`);
  }
  const projections = readLiveJson<ProjectionsFile>(siteProjectionsPath(label));
  if (!projections) {
    console.log("Model views not published yet; the next pipeline run writes them.");
    return;
  }
  assert.equal(projections.fromEtDate, state.slateEtDate, "Projections must start at the published slate.");
  assert.equal(projections.ratingsHash, state.ratingsHash, "Projections must use the published ratings.");
  assert.deepEqual(
    projectionProblems(projections, { ratings: state.ratings, params: state.params, games, ledger }),
    [],
    "Published projections must satisfy every projection invariant.",
  );
  const lists = readLiveJson<TeamInjuriesFile>(siteTeamInjuriesPath(label));
  assert.ok(lists, "Team injury lists must be published with the projections.");
  assert.deepEqual(teamInjuryProblems(lists, projections, SEASON_TEAMS.map((team) => team.id)), [], "Team injury lists must match the projections.");
  const index = readLiveJson<PlayerIndexFile>(sitePlayerIndexPath(label));
  assert.ok(index, "The player index must be published with the projections.");
  const teams = new Map<string, TeamPlayersFile>();
  const listings: ResolvedListing[] = [];
  for (const team of SEASON_TEAMS) {
    const file = readLiveJson<TeamPlayersFile>(siteTeamPlayersPath(label, team.id));
    if (!file) continue;
    teams.set(team.id, file);
    for (const player of file.players) for (const listing of player.injuries) listings.push({ ...listing, athleteId: player.athleteId });
  }
  const daysDirectory = path.join(process.cwd(), "data/live/players", label);
  const days: PlayerGamesDay[] = fs.existsSync(daysDirectory)
    ? fs
        .readdirSync(daysDirectory)
        .filter((file) => file.endsWith(".json"))
        .map((file) => JSON.parse(fs.readFileSync(path.join(daysDirectory, file), "utf-8")) as PlayerGamesDay)
    : [];
  const impact = new Map(index.players.map((player) => [player.athleteId, player.impact]));
  const names = new Map(index.players.map((player) => [player.athleteId, player.name]));
  const derived = derivePlayerFiles({
    season: LIVE_SEASON,
    seasonLabel: label,
    days,
    listings,
    impact: (athleteId) => impact.get(athleteId) ?? null,
    nameOf: (athleteId) => names.get(athleteId),
  });
  assert.equal(siteFileContent(derived.index), siteFileContent(index), "The player index must be what the stored player lines give.");
  assert.deepEqual([...derived.teams.keys()].sort(), [...teams.keys()].sort(), "Every team with stored lines has a player file, and no other.");
  for (const [teamId, file] of derived.teams) {
    assert.equal(siteFileContent(file), siteFileContent(teams.get(teamId)), `Team ${teamId}'s player file must be what the stored lines give.`);
  }
  for (const player of index.players) {
    assert.ok(player.impact === null || player.impact >= 0, "A 548 impact is never negative.");
  }
  console.log(
    `Model views pass (${projections.games.length} projections, ${lists.teams.length} team lists, ${index.players.length} players from ${index.storedGames} stored games).`,
  );
}

/** The data cache stores items up to 2 MB; warn well before a file the site reads gets there. */
const SITE_FILE_WARN_BYTES = 1_500_000;

/**
 * The site files under data/live/site must be exactly what the ledger, state and games
 * on disk produce: no file missing, extra or different. Skipped until the job first
 * publishes them.
 */
function checkSiteFiles(): void {
  const liveDirectory = path.join(process.cwd(), "data/live");
  const published = publishedSiteFiles(liveDirectory);
  if (published.size === 0) {
    console.log("Site files not published yet; the next pipeline run writes them.");
    return;
  }
  const expected = expectedSiteFiles(liveDirectory, LIVE_SEASON, seasonLabel(LIVE_SEASON));
  const missing = [...expected.keys()].filter((file) => !published.has(file));
  const extra = [...published.keys()].filter(
    (file) => !expected.has(file) && !isModelViewPath(file, seasonLabel(LIVE_SEASON)),
  );
  const different = [...expected.keys()].filter(
    (file) => published.has(file) && published.get(file) !== expected.get(file),
  );
  assert.deepEqual(missing, [], "Every site file must be published.");
  assert.deepEqual(extra, [], "No site file may exist that the ledger does not produce.");
  assert.deepEqual(different, [], "Site files must match the ledger, state and games they were derived from.");
  const read = [
    "state.json",
    `games/${LIVE_SEASON}.json`,
    ...expected.keys(),
    ...[...published.keys()].filter((file) => isModelViewPath(file, seasonLabel(LIVE_SEASON))),
  ].map((file) => ({ file, bytes: fs.existsSync(path.join(liveDirectory, file)) ? fs.statSync(path.join(liveDirectory, file)).size : 0 }));
  for (const { file, bytes } of read) {
    if (bytes > SITE_FILE_WARN_BYTES) {
      console.warn(`Warning: data/live/${file} is ${(bytes / 1e6).toFixed(2)} MB; the site's data cache stores items up to 2 MB.`);
    }
  }
  const largest = read.reduce((max, entry) => (entry.bytes > max.bytes ? entry : max));
  console.log(`Site files match the ledger (${expected.size} files; largest read by the site: ${largest.file}, ${(largest.bytes / 1e3).toFixed(0)} KB).`);
}

export function runLiveChecks(): void {
  const raw = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "data/live/state.json"), "utf-8"),
  ) as LiveState | (Omit<LiveState, "schemaVersion"> & { schemaVersion: 1 });

  checkFrozenInjuryInputs();
  checkInjuryInvariants();
  checkProjectionInvariants();

  assert.ok(raw.schemaVersion === 1 || raw.schemaVersion === 2, "Unknown live state schema.");
  if (raw.schemaVersion === 2) checkSchemaTwoState(raw);
  else checkSchemaOneState(raw);
  const state = raw;
  assert.equal(state.ratings.mean.length, STATE_SIZE, "Rating vector has the wrong size.");
  assert.equal(state.ratings.cov.length, STATE_SIZE ** 2, "Covariance has the wrong size.");
  assert.equal(state.forecast.teams.length, SEASON_TEAMS.length, "Forecast must cover 30 teams.");
  assert.ok(!Number.isNaN(Date.parse(state.generatedAt)), "generatedAt must be a timestamp.");
  assertForecastSums({
    ...state.forecast,
    // Published values are rounded, so allow for rounding before re-checking sums.
    sums: { champion: 1, makePlayoffs: 16, topSix: 12, playIn: 8 },
  });
  const sumOf = (key: "champion" | "makePlayoffs" | "topSix" | "playIn") =>
    state.forecast.teams.reduce((total, team) => total + team[key], 0);
  assert.ok(Math.abs(sumOf("champion") - 1) < 0.01, "Title odds must sum to 1.");
  assert.ok(Math.abs(sumOf("makePlayoffs") - 16) < 0.01, "Playoff odds must sum to 16.");
  assert.ok(Math.abs(sumOf("topSix") - 12) < 0.01, "Top-six odds must sum to 12.");
  assert.ok(Math.abs(sumOf("playIn") - 8) < 0.01, "Play-in odds must sum to 8.");

  // Published state must price a game inside [0, 1], with home court helping.
  const [first, second] = SEASON_TEAMS;
  const atFirst = predictGame(
    state.ratings,
    {
      homeId: first.id,
      awayId: second.id,
      neutral: false,
      playoff: false,
      homeOnBackToBack: false,
      awayOnBackToBack: false,
    },
    state.params,
  );
  const neutral = predictGame(
    state.ratings,
    {
      homeId: first.id,
      awayId: second.id,
      neutral: true,
      playoff: false,
      homeOnBackToBack: false,
      awayOnBackToBack: false,
    },
    state.params,
  );
  assert.ok(atFirst.homeWinProbability >= 0 && atFirst.homeWinProbability <= 1);
  assert.ok(
    atFirst.homeWinProbability > neutral.homeWinProbability,
    "Home court must raise the home team's chance.",
  );

  for (const team of SEASON_TEAMS) {
    assert.ok(
      fs.existsSync(path.join(process.cwd(), "public/logos/nba", `${team.id}.png`)),
      `${team.abbreviation} has no logo file.`,
    );
  }

  // The market reference shown beside the model must be a probability, favor the
  // shorter line, and come out even for a pick'em. Comparison only, never an input.
  const favorite = impliedHomeProbability({
    provider: "check",
    homeMoneyline: -200,
    awayMoneyline: 170,
    homeSpread: null,
  });
  const even = impliedHomeProbability({
    provider: "check",
    homeMoneyline: -110,
    awayMoneyline: -110,
    homeSpread: null,
  });
  assert.ok(favorite !== null && favorite > 0.5 && favorite < 1, "Market favorite must be above even.");
  assert.ok(even !== null && Math.abs(even - 0.5) < 1e-9, "Equal lines must give an even market.");
  assert.equal(
    impliedHomeProbability({ provider: "check", homeMoneyline: null, awayMoneyline: 150, homeSpread: null }),
    null,
    "A missing line must give no market number.",
  );

  const gamesPath = path.join(process.cwd(), "data/live/games", `${LIVE_SEASON}.json`);
  const storedGames = fs.existsSync(gamesPath)
    ? (JSON.parse(fs.readFileSync(gamesPath, "utf-8")) as SeasonGame[]).sort(
        (x, y) => Date.parse(x.tipUtc) - Date.parse(y.tipUtc) || x.id.localeCompare(y.id),
      )
    : [];
  checkProjections(upgradeLiveState(state), storedGames);

  const seeding = runSeedingCheck();
  assert.deepEqual(seeding.mismatches, [], "Computed seeds must match real seasons.");
  assert.equal(seeding.checked, 100, "Seeding check must cover five seasons of seeds 1-10.");

  const ledgerPath = path.join(
    process.cwd(),
    "data/live/ledger",
    `${seasonLabel(LIVE_SEASON)}.jsonl`,
  );
  const ledgerRows: LedgerRow[] = fs.existsSync(ledgerPath)
    ? fs
        .readFileSync(ledgerPath, "utf-8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as LedgerRow)
    : [];
  assert.deepEqual(ledgerProblems(ledgerRows), [], "Ledger rows must be valid.");
  const summary = summarizeRecord(ledgerRows, LIVE_MODEL_VERSION, 0.5);
  const resultMap = new Map(ledgerRows.filter((row) => row.type === "result").map((row) => [row.gameId, row]));
  const grouped = new Map<string, SealRow[]>();
  for (const row of ledgerRows) {
    if (row.type === "seal" && row.modelVersion === LIVE_MODEL_VERSION)
      grouped.set(row.gameId, [...(grouped.get(row.gameId) ?? []), row]);
  }
  for (const [kind, scoreKey, countKey] of [
    ["morning", "morningBrier", "morningCount"],
    ["reissued", "reissuedBrier", "reissuedCount"],
    ["latest", "latestPreFinalBrier", "latestPreFinalCount"],
  ] as const) {
    const losses: number[] = [];
    for (const rows of grouped.values()) {
      const result = resultMap.get(rows[0].gameId);
      const seal = kind === "latest" ? scoredSeal(rows.filter((row) => sealKindOf(row) !== "final"))
        : rows.find((row) => sealKindOf(row) === kind);
      if (result && seal) losses.push((seal.homeWinProbability - (result.homeScore > result.awayScore ? 1 : 0)) ** 2);
    }
    assert.equal(summary[countKey], losses.length, `${kind} count must match its own scored games.`);
    const expected = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : null;
    if (expected === null) assert.equal(summary[scoreKey], null);
    else assert.ok(Math.abs(summary[scoreKey]! - expected) < 1e-10, `${kind} Brier must match its own seals.`);
    const published = state.records?.[LIVE_MODEL_VERSION];
    if (published?.morningCount !== undefined) {
      assert.equal(published[countKey], summary[countKey]);
      assert.equal(published[scoreKey], summary[scoreKey]);
    }
  }
  console.log(`Record metric split checked: original n=${summary.morningCount}, reissued n=${summary.reissuedCount}, latest pre-final n=${summary.latestPreFinalCount}.`);

  checkSiteFiles();
  if (raw.schemaVersion === 2) checkModelViews(upgradeLiveState(state), storedGames, ledgerRows);
}

if (process.argv[1]?.endsWith("live-checks.ts")) {
  runLiveChecks();
  console.log("Live checks passed.");
}
