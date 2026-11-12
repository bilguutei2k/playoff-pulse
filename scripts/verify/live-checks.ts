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
  SCORE_LABEL,
  SCORE_LABEL_BOX,
  toStoredLine,
  type PlayerBoxLine,
  type PlayerGamesDay,
  type PlayerIndexFile,
  type ResolvedListing,
  type TeamPlayersFile,
} from "../../src/lib/season/player-stats";
import { combinePieces } from "../../src/lib/score/book";
import { SCORE_BOUND, scoreProblems, type PriorPiece } from "../../src/lib/score/live";
import { liveOnCourt, onCourtProblems, publishedOnCourt, ON_COURT_BOUND, PARTS_TOLERANCE } from "../../src/lib/score/live-on-court";
import { emptyStintDay, storeStint, type StintDay } from "../../src/lib/score/live-stints";
import {
  SCORE_BOOK,
  SCORE_CHECKPOINT_DAYS,
  SCORE_COEFFICIENTS,
  SCORE_MODEL_VERSION,
  SCORE_MODEL_VERSION_S2,
  SCORE_ON_COURT,
  SCORE_ON_COURT_REPLACEMENT,
} from "../../src/lib/score/params";
import type { Five, Stint } from "../../src/lib/score/types";
import { scoresFrom, scoresWithOnCourt } from "../live/model-views";
import { loadCarriedDelta, loadScorePrior } from "../live/score-prior";
import { loadStintDays } from "../live/stint-collect";
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
import { sealKindOf, summarizeRecord } from "../../src/lib/season/live-state";
import { clampProbability } from "../../src/lib/season/math";
import { impliedHomeProbability } from "../../src/lib/season/market";
import { POLICY_MODEL_VERSION, POLICY_REVISIONS, policyRevisionAt } from "../../src/lib/season/policy-revisions";
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

/**
 * The 548 score on a synthetic season (display only, never a forecast input): every score
 * finite, within ±SCORE_BOUND, with a share in [0, 1]; a player with no games and no prior
 * piece has none; a prior-only player keeps his prior value with a share of 0; a better box
 * line gives a higher score; and without a prior every score is null.
 */
function checkScoreInvariants(): void {
  const [home, away] = SEASON_TEAMS.slice(0, 2).map((team) => team.id);
  const season = LIVE_SEASON;
  const line = (athleteId: string, minutes: number, points: number, extra: Partial<PlayerBoxLine> = {}): PlayerBoxLine => ({
    athleteId,
    name: athleteId,
    position: null,
    starter: minutes >= 30,
    minutes,
    points,
    offensiveRebounds: 1,
    defensiveRebounds: 4,
    assists: 3,
    steals: 1,
    blocks: 0,
    turnovers: 2,
    fouls: 2,
    fieldGoalsMade: Math.floor(points / 2.5),
    fieldGoalsAttempted: Math.ceil(points / 1.1),
    threePointersMade: 1,
    threePointersAttempted: 3,
    freeThrowsMade: 2,
    freeThrowsAttempted: 3,
    plusMinus: 0,
    ...extra,
  });
  const roster = (prefix: string): PlayerBoxLine[] => [
    line(`${prefix}1`, 36, 24),
    line(`${prefix}2`, 34, 18),
    line(`${prefix}3`, 32, 14),
    line(`${prefix}4`, 30, 12),
    line(`${prefix}5`, 28, 10),
    line(`${prefix}6`, 24, 8),
    line(`${prefix}7`, 20, 6),
    line(`${prefix}8`, 16, 4),
    line(`${prefix}9`, 20, 4),
  ];
  const build = (better: boolean): PlayerGamesDay[] =>
    [0, 1, 2, 3].map((index) => {
      const etDate = `2026-10-2${index + 1}`;
      const homeId = index % 2 === 0 ? home : away;
      const awayId = homeId === home ? away : home;
      const box = (teamId: string) =>
        roster(teamId === home ? "81" : "82").map((entry) =>
          better && index === 2 && entry.athleteId === "813" ? { ...entry, assists: entry.assists + 4, steals: entry.steals + 2, turnovers: 0 } : entry,
        );
      const points = (teamId: string) => box(teamId).reduce((total, entry) => total + entry.points, 0) - (teamId === awayId ? 4 : 0);
      const day: PlayerGamesDay = { version: 1, etDate, athletes: {}, games: {} };
      const teams: PlayerGamesDay["games"][string]["teams"] = {};
      for (const teamId of [homeId, awayId]) {
        const lines = box(teamId).map((entry) => (teamId === awayId && entry.athleteId.endsWith("1") ? { ...entry, points: entry.points - 4 } : entry));
        for (const entry of lines) day.athletes[entry.athleteId] = { name: entry.name, position: entry.position };
        teams[teamId] = { lines: lines.map(toStoredLine), didNotPlay: [] };
      }
      day.games[`9${index}`] = { gameId: `9${index}`, etDate, homeId, awayId, homeScore: points(homeId), awayScore: points(awayId), teams };
      return day;
    });
  const priorPiece: PriorPiece = { season: season - 1, teamId: home, possessions: 3000, minutes: 1500, rating: 2.4 };
  const prior = new Map<string, PriorPiece[]>([
    ["811", [{ ...priorPiece, rating: 4 }]],
    ["8000", [priorPiece]],
  ]);
  const base = scoresFrom(season, build(false), prior);
  assert.equal(base.problem, null, `The synthetic 548 score must compute: ${base.problem}`);
  const scores = base.scores!;
  assert.deepEqual(scoreProblems(scores), [], "Synthetic 548 scores must be finite, within bounds, with shares in [0, 1].");
  assert.equal(scores.size, 19, "Every player with a piece, and only those, has a 548 score.");
  assert.ok(!scores.has("8001"), "A player with no games this season and no prior piece has no 548 score.");
  const priorOnly = scores.get("8000");
  assert.ok(priorOnly && priorOnly.share === 0, "A player with no games this season takes nothing from this season.");
  assert.ok(
    Math.abs(priorOnly.score - combinePieces([priorPiece], season, SCORE_BOOK).value) < 0.0005,
    "A prior-only player's 548 score is his prior pieces through the book.",
  );
  assert.ok((scores.get("811")?.share ?? 0) < (scores.get("821")?.share ?? 0), "Prior pieces lower the share from this season.");
  const better = scoresFrom(season, build(true), prior).scores!;
  assert.ok(better.get("813")!.score > scores.get("813")!.score, "A better box line must give a higher 548 score.");
  const without = scoresFrom(season, build(false), null, "no prior");
  assert.ok(without.scores === null && without.problem === "no prior", "Without a prior the 548 score is not computed, and says why.");
  const files = derivePlayerFiles({
    season,
    seasonLabel: seasonLabel(season),
    days: build(false),
    listings: [],
    impact: () => null,
    score: () => ({ score: 1, share: 1 }),
    scoreModel: null,
    nameOf: () => undefined,
  });
  assert.ok(
    files.index.scoreModel === null && files.index.players.every((player) => player.score === null && player.scoreShare === null),
    "An index without a score model carries no 548 score.",
  );
}

/**
 * Stage 2 of the 548 score on a synthetic season (display only, never a forecast input):
 * a lineup that outscores what its box values predict gets a positive on-court part and
 * its opponents a negative one; every published value is finite, bounded and the score is
 * the sum of its parts; before the first checkpoint the on-court part is the carried value;
 * and each missing input falls back as the job does (no carried δ or no stints: box scores
 * alone with the reason; no prior: no score).
 */
function checkOnCourtInvariants(): void {
  const [home, away] = SEASON_TEAMS.slice(0, 2).map((team) => team.id);
  const season = LIVE_SEASON;
  const line = (athleteId: string): PlayerBoxLine => ({
    athleteId,
    name: athleteId,
    position: null,
    starter: true,
    minutes: 24,
    points: 10,
    offensiveRebounds: 1,
    defensiveRebounds: 4,
    assists: 3,
    steals: 1,
    blocks: 0,
    turnovers: 2,
    fouls: 2,
    fieldGoalsMade: 4,
    fieldGoalsAttempted: 9,
    threePointersMade: 1,
    threePointersAttempted: 3,
    freeThrowsMade: 1,
    freeThrowsAttempted: 1,
    plusMinus: 0,
  });
  // Ten players a side with identical box lines; two units each.
  const ids = (prefix: string) => Array.from({ length: 10 }, (_, i) => `${prefix}${i}`);
  const homeIds = ids("71");
  const awayIds = ids("72");
  const five = (list: string[], from: number) => [...list.slice(from, from + 5)].sort() as Five;
  const days: PlayerGamesDay[] = [];
  const stintDays: StintDay[] = [];
  for (let index = 0; index < 8; index += 1) {
    const etDate = `2026-10-${String(21 + index * 2).padStart(2, "0")}`;
    const gameId = `97${index}`;
    // Home's first unit beats away's first unit by 12 a stint; the second units break even.
    const stints: Stint[] = [];
    for (let k = 0; k < 4; k += 1) {
      stints.push({ period: k + 1, seconds: 360, home: five(homeIds, 0), away: five(awayIds, 0), homePossessions: 12, awayPossessions: 12, homePoints: 24, awayPoints: 12, startMargin: 0 });
      stints.push({ period: k + 1, seconds: 360, home: five(homeIds, 5), away: five(awayIds, 5), homePossessions: 12, awayPossessions: 12, homePoints: 14, awayPoints: 14, startMargin: 0 });
    }
    const homeScore = stints.reduce((sum, stint) => sum + stint.homePoints, 0);
    const awayScore = stints.reduce((sum, stint) => sum + stint.awayPoints, 0);
    const day: PlayerGamesDay = { version: 1, etDate, athletes: {}, games: {} };
    const teams: PlayerGamesDay["games"][string]["teams"] = {};
    for (const [teamId, list] of [[home, homeIds], [away, awayIds]] as const) {
      for (const id of list) day.athletes[id] = { name: id, position: null };
      teams[teamId] = { lines: list.map((id) => toStoredLine(line(id))), didNotPlay: [] };
    }
    day.games[gameId] = { gameId, etDate, homeId: home, awayId: away, homeScore, awayScore, teams };
    days.push(day);
    const stintDay = emptyStintDay(etDate);
    stintDay.games[gameId] = {
      gameId,
      etDate,
      kind: "regular",
      homeId: home,
      awayId: away,
      homeScore,
      awayScore,
      audit: { source: "substitutions", wrongCountPlays: 0, maxPlusMinusGap: 0, plusMinusMisses: 0, maxMinutesGap: 0, homePointsGap: 0, awayPointsGap: 0, rejected: null },
      stints: stints.map(storeStint),
    };
    stintDays.push(stintDay);
  }
  const prior = new Map<string, PriorPiece[]>([[homeIds[0], [{ season: season - 1, teamId: home, possessions: 3000, minutes: 1500, rating: 1 }]]]);
  const carried = new Map<string, number>([[homeIds[9], 0.8], ["7999", -1.5]]);
  const input = {
    season,
    days,
    stintDays,
    prior,
    carried,
    coefficients: SCORE_COEFFICIENTS,
    book: SCORE_BOOK,
    params: SCORE_ON_COURT,
    checkpointDays: SCORE_CHECKPOINT_DAYS,
    replacement: SCORE_ON_COURT_REPLACEMENT,
  };
  const late = liveOnCourt({ ...input, today: "2026-11-30" });
  assert.equal(late.checkpoint, "2026-11-11", "The on-court part comes from the latest checkpoint, every 21 days from the first game.");
  assert.ok(late.rows > 0 && late.stintGames === 8, "The checkpoint solves with the stints of games before it.");
  for (const id of five(homeIds, 0)) {
    assert.ok((late.ratings.get(id)?.delta ?? 0) > 0, `A lineup that outscores its box values gets a positive on-court part (${id}).`);
  }
  for (const id of five(awayIds, 0)) {
    assert.ok((late.ratings.get(id)?.delta ?? 0) < 0, `Its opponents get a negative on-court part (${id}).`);
  }
  const published = publishedOnCourt(late);
  assert.deepEqual(onCourtProblems(published), [], "Synthetic Stage 2 scores must be finite, bounded and the sum of their parts.");
  const early = liveOnCourt({ ...input, today: "2026-11-10" });
  assert.equal(early.checkpoint, null, "Before the first checkpoint there is none.");
  assert.ok(
    [...early.ratings].every(([id, value]) => value.delta === (carried.get(id) ?? 0) * SCORE_ON_COURT.rho),
    "Before the first checkpoint the on-court part is ρ times the carried value.",
  );
  const bad = new Map(published);
  bad.set("x", { score: 3, share: 0.5, box: 1, onCourt: 1 });
  assert.ok(onCourtProblems(bad).length > 0, "A score that is not the sum of its parts must be caught.");
  bad.set("x", { score: 12, share: 0.5, box: 1, onCourt: 11 });
  assert.ok(onCourtProblems(bad).length > 0, `An on-court part outside ±${ON_COURT_BOUND} must be caught.`);

  const full = scoresWithOnCourt({ season, today: "2026-11-30", days, prior, stintDays, carried });
  assert.ok(full.model === SCORE_MODEL_VERSION_S2 && full.problem === null && full.checkpoint === "2026-11-11", `Stage 2 must compute: ${full.problem}`);
  assert.equal(
    scoresWithOnCourt({ season, today: "2026-11-30", days, prior, stintDays: [], carried }).checkpoint,
    null,
    "A checkpoint with no stints of this season leaves the carried value and names no checkpoint.",
  );
  const noCarried = scoresWithOnCourt({ season, today: "2026-11-30", days, prior, stintDays, carried: null, carriedProblem: "no δ" });
  assert.ok(
    noCarried.model === SCORE_MODEL_VERSION &&
      noCarried.label === SCORE_LABEL_BOX &&
      /no δ/.test(noCarried.problem ?? "") &&
      [...(noCarried.scores ?? [])].every(([, value]) => value.onCourt === null && value.box === value.score),
    "Without the carried δ the index carries box scores alone, and says why.",
  );
  const noStints = scoresWithOnCourt({ season, today: "2026-11-30", days, prior, stintDays: null, stintProblem: "unreadable", carried });
  assert.ok(noStints.model === SCORE_MODEL_VERSION && /unreadable/.test(noStints.problem ?? ""), "Without readable stints the index carries box scores alone.");
  const none = scoresWithOnCourt({ season, today: "2026-11-30", days, prior: null, priorProblem: "no prior", stintDays, carried });
  assert.ok(none.model === null && none.scores === null && none.problem === "no prior", "Without the prior there is no score.");
  const empty = scoresWithOnCourt({ season, today: "2026-11-30", days, prior, stintDays: [], carried });
  assert.ok(
    empty.model === SCORE_MODEL_VERSION_S2 &&
      [...(empty.scores ?? [])].every(([id, value]) => value.onCourt === Number(((carried.get(id) ?? 0) * SCORE_ON_COURT.rho).toFixed(3))),
    "With no stints stored, Stage 2 is published with the carried on-court part.",
  );
}

/** The fields written only with the on-court part (Stage 2): absent from files written before it. */
function withoutOnCourtFields(index: PlayerIndexFile): unknown {
  const { scoreCheckpoint: _checkpoint, ...rest } = index;
  void _checkpoint;
  return {
    ...rest,
    players: index.players.map((player) => {
      const { scoreBox: _box, scoreOnCourt: _onCourt, ...kept } = player;
      void _box;
      void _onCourt;
      return kept;
    }),
  };
}

/** A player index as files written before the 548 score have it: no score keys. */
function withoutScoreFields(index: PlayerIndexFile): unknown {
  const { scoreLabel: _label, scoreModel: _model, scoreCheckpoint: _checkpoint, ...rest } = index;
  void _label;
  void _model;
  void _checkpoint;
  return {
    ...rest,
    players: index.players.map((player) => {
      const { score: _score, scoreShare: _share, scoreBox: _box, scoreOnCourt: _onCourt, ...kept } = player;
      void _score;
      void _share;
      void _box;
      void _onCourt;
      return kept;
    }),
  };
}

/**
 * The stored stints (display only): every day file well formed, five distinct players a
 * side, accepted games adding up to their final score, rejections with a reason. Returns
 * them for the 548 score's recomputation (an empty store when none is stored yet), or the
 * reason they cannot be read. The caller fails only when a published Stage 2 score was
 * computed from them: otherwise the job has already fallen back to box scores alone and
 * reported `scoreProblem`, and a stint problem must not fail the run.
 */
function readStintStore(label: string): { days: StintDay[]; problem: null } | { days: null; problem: string } {
  let days: Map<string, StintDay>;
  try {
    days = loadStintDays(label, path.join(process.cwd(), "data/live/stints", label));
  } catch (error) {
    return { days: null, problem: error instanceof Error ? error.message : String(error) };
  }
  const games = [...days.values()].flatMap((day) => Object.values(day.games));
  const accepted = games.filter((game) => game.stints !== null);
  console.log(
    games.length === 0
      ? "No 548 score stints stored yet."
      : `548 score stints well formed: ${games.length} games over ${days.size} days, ${accepted.length} accepted (${accepted.reduce((sum, game) => sum + (game.stints?.length ?? 0), 0)} stints), ${games.length - accepted.length} rejected with a reason.`,
  );
  return { days: [...days.values()], problem: null };
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
  // The 548 score. Four shapes:
  //  - written before the score: no score keys, compared without them;
  //  - Stage 2 (`SCORE_MODEL_VERSION_S2`): every score, box part and on-court part exactly
  //    what src/lib/score/live-on-court.ts gives from the stored days, the stored stints,
  //    the committed prior and carried δ, on the published slate date;
  //  - Stage 1 (`SCORE_MODEL_VERSION`, box scores alone, as the job publishes it when the
  //    on-court part cannot be computed, or as files written before Stage 2 have it, without
  //    the part keys): every score exactly what src/lib/score/live.ts gives;
  //  - no score model (the job could not compute any score): every score null.
  const stints = readStintStore(label);
  const legacy = !("scoreModel" in index);
  const scoreModel = legacy ? null : index.scoreModel;
  const beforeParts = !legacy && !("scoreCheckpoint" in index);
  type Expected = { score: number; share: number; box?: number; onCourt?: number | null };
  let expectedScores: Map<string, Expected> | null = null;
  let scoreLabel = SCORE_LABEL;
  let scoreCheckpoint: string | null = null;
  let priorIds = new Set<string>();
  if (scoreModel !== null) {
    assert.ok(
      scoreModel === SCORE_MODEL_VERSION || scoreModel === SCORE_MODEL_VERSION_S2,
      `The player index must carry one of the code's 548 score models, not ${scoreModel}.`,
    );
    const loaded = loadScorePrior(LIVE_SEASON);
    assert.ok(loaded.prior, `A published 548 score needs the prior it came from: ${loaded.problem}`);
    priorIds = new Set(loaded.prior.keys());
    if (scoreModel === SCORE_MODEL_VERSION_S2) {
      assert.ok(!beforeParts, "A Stage 2 player index must carry the score's parts.");
      assert.ok(stints.days, `A published Stage 2 score needs well-formed stints: ${stints.problem}`);
      const stintDays = stints.days;
      const carried = loadCarriedDelta(LIVE_SEASON);
      assert.ok(carried.carried, `A published Stage 2 score needs the carried δ it came from: ${carried.problem}`);
      const computed = scoresWithOnCourt({ season: LIVE_SEASON, today: state.slateEtDate, days, prior: loaded.prior, stintDays, carried: carried.carried });
      assert.ok(computed.scores && computed.model === SCORE_MODEL_VERSION_S2, `The Stage 2 548 score must recompute: ${computed.problem}`);
      expectedScores = computed.scores;
      scoreCheckpoint = computed.checkpoint;
    } else {
      const computed = scoresFrom(LIVE_SEASON, days, loaded.prior);
      assert.ok(computed.scores, `The 548 score must recompute: ${computed.problem}`);
      expectedScores = computed.scores;
      scoreLabel = SCORE_LABEL_BOX;
    }
  }
  if (stints.problem !== null && scoreModel !== SCORE_MODEL_VERSION_S2) {
    console.log(`548 score stints unreadable (${stints.problem}); the index carries no on-court part, as the job reported.`);
  }
  // Files written before the on-court part carry the box-only label whatever their model.
  if (beforeParts) scoreLabel = SCORE_LABEL_BOX;
  const derived = derivePlayerFiles({
    season: LIVE_SEASON,
    seasonLabel: label,
    days,
    listings,
    impact: (athleteId) => impact.get(athleteId) ?? null,
    score: (athleteId) => expectedScores?.get(athleteId) ?? null,
    scoreModel,
    scoreLabel,
    scoreCheckpoint,
    nameOf: (athleteId) => names.get(athleteId),
  });
  assert.equal(
    legacy
      ? JSON.stringify(withoutScoreFields(derived.index))
      : beforeParts
        ? JSON.stringify(withoutOnCourtFields(derived.index))
        : siteFileContent(derived.index),
    legacy || beforeParts ? JSON.stringify(index) : siteFileContent(index),
    "The player index must be what the stored player lines (and, for the 548 score, the prior, the stints and the carried δ) give.",
  );
  assert.deepEqual([...derived.teams.keys()].sort(), [...teams.keys()].sort(), "Every team with stored lines has a player file, and no other.");
  for (const [teamId, file] of derived.teams) {
    assert.equal(siteFileContent(file), siteFileContent(teams.get(teamId)), `Team ${teamId}'s player file must be what the stored lines give.`);
  }
  for (const player of index.players) {
    assert.ok(player.impact === null || player.impact >= 0, "A 548 impact is never negative.");
    if (legacy) continue;
    assert.ok(
      player.score === null || (Number.isFinite(player.score) && Math.abs(player.score) <= SCORE_BOUND),
      `${player.name}'s 548 score must be finite and within ±${SCORE_BOUND}.`,
    );
    assert.ok(
      (player.score === null) === (player.scoreShare === null) &&
        (player.scoreShare === null || (player.scoreShare >= 0 && player.scoreShare <= 1)),
      `${player.name}'s 548 score share must be in [0, 1], and present exactly when the score is.`,
    );
    if (scoreModel !== null && player.games === 0 && !priorIds.has(player.athleteId)) {
      assert.equal(player.score, null, `${player.name} has no games this season and no prior piece, so no 548 score.`);
    }
    if (beforeParts) continue;
    assert.ok(
      (player.score === null) === (player.scoreBox === null) && (player.scoreOnCourt === null || player.score !== null),
      `${player.name}'s 548 score parts must be present exactly when the score is.`,
    );
    if (scoreModel === SCORE_MODEL_VERSION_S2 && player.score !== null) {
      assert.ok(
        player.scoreBox !== null &&
          player.scoreOnCourt !== null &&
          Number.isFinite(player.scoreBox) &&
          Number.isFinite(player.scoreOnCourt) &&
          Math.abs(player.scoreOnCourt) <= ON_COURT_BOUND &&
          Math.abs(player.score - (player.scoreBox + player.scoreOnCourt)) <= PARTS_TOLERANCE,
        `${player.name}'s 548 score must be his box part plus his on-court part, each finite and bounded.`,
      );
    } else if (player.score !== null) {
      assert.ok(player.scoreBox === player.score && player.scoreOnCourt === null, `${player.name}'s box-only 548 score has no on-court part.`);
    }
  }
  console.log(
    legacy
      ? "Player index predates the 548 score; compared without its fields."
      : scoreModel === null
        ? "Player index carries no 548 score this run (the job reported why); every score is null."
        : scoreModel === SCORE_MODEL_VERSION_S2
          ? `548 scores (box + on-court, ${scoreCheckpoint ? `checkpoint ${scoreCheckpoint}` : "on-court part carried from 2025-26"}) match the stored lines, stints, prior and carried δ (${index.players.filter((player) => player.score !== null).length} of ${index.players.length} players).`
          : `548 scores (box scores only${beforeParts ? ", written before the on-court part" : ""}) match the stored lines and the prior (${index.players.filter((player) => player.score !== null).length} of ${index.players.length} players).`,
  );
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

/**
 * The pre-final scores and the policy-revision breakdown, recomputed here from the
 * ledger without summarizeRecord's code path, then held against summarizeRecord and,
 * when the published state carries them, against the state.
 */
function checkRecordSplit(state: LiveState, ledgerRows: readonly LedgerRow[]): void {
  const summary = summarizeRecord(ledgerRows, LIVE_MODEL_VERSION, 0.5, { finalSeals: true });
  const results = new Map<string, { homeWon: number }>();
  for (const row of ledgerRows) {
    if (row.type === "result") results.set(row.gameId, { homeWon: row.homeScore > row.awayScore ? 1 : 0 });
  }
  const byGame = new Map<string, SealRow[]>();
  for (const row of ledgerRows) {
    if (row.type === "seal" && row.modelVersion === LIVE_MODEL_VERSION) {
      byGame.set(row.gameId, [...(byGame.get(row.gameId) ?? []), row]);
    }
  }
  const loss = (row: SealRow, homeWon: number) => (clampProbability(row.homeWinProbability) - homeWon) ** 2;
  const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
  const original: number[] = [];
  const reissued: number[] = [];
  const latest: number[] = [];
  const revisionOf = (row: SealRow) => row.policyRevision ?? policyRevisionAt(row.issuedAt);
  const byRevision = new Map(POLICY_REVISIONS.map((row) => [row.revision, { sealRows: 0, sealed: 0, scored: 0, losses: [] as number[] }]));
  for (const rows of byGame.values()) {
    const kind = (wanted: string) => rows.find((row) => sealKindOf(row) === wanted);
    const morning = kind("morning");
    const again = kind("reissued");
    const scoredOn = kind("final") ?? again ?? morning;
    assert.ok(scoredOn, `Game ${rows[0].gameId} has v2 rows but no seal to score.`);
    const result = results.get(rows[0].gameId);
    if (LIVE_MODEL_VERSION === POLICY_MODEL_VERSION) {
      for (const row of rows) byRevision.get(revisionOf(row))!.sealRows += 1;
      const entry = byRevision.get(revisionOf(scoredOn));
      assert.ok(entry, `Game ${rows[0].gameId} is scored on a seal outside the revision table.`);
      entry.sealed += 1;
      if (result) {
        entry.scored += 1;
        entry.losses.push(loss(scoredOn, result.homeWon));
      }
    }
    if (!result) continue;
    if (morning) original.push(loss(morning, result.homeWon));
    if (again) reissued.push(loss(again, result.homeWon));
    if (again ?? morning) latest.push(loss((again ?? morning)!, result.homeWon));
  }
  const close = (a: number | null | undefined, b: number | null, what: string) => {
    if (b === null) assert.equal(a, null, `${what} must be empty.`);
    else assert.ok(typeof a === "number" && Math.abs(a - b) < 1e-12, `${what} must match its own seals.`);
  };
  assert.equal(summary.originalMorningCount, original.length, "Original morning count must match its scored games.");
  assert.equal(summary.reissuedCount, reissued.length, "Reissued count must match its scored games.");
  assert.equal(summary.latestPreFinalCount, latest.length, "Latest pre-final count must match its scored games.");
  close(summary.originalMorningBrier, mean(original), "Original morning Brier");
  close(summary.reissuedBrier, mean(reissued), "Reissued Brier");
  close(summary.latestPreFinalBrier, mean(latest), "Latest pre-final Brier");
  assert.equal(summary.morningBrier, summary.latestPreFinalBrier, "morningBrier keeps its published meaning: the latest pre-final seal.");
  if (LIVE_MODEL_VERSION === POLICY_MODEL_VERSION) {
    const revisions = summary.policyRevisions ?? [];
    assert.deepEqual(revisions.map((row) => row.revision), POLICY_REVISIONS.map((row) => row.revision), "Every revision must be listed.");
    for (const row of revisions) {
      const expected = byRevision.get(row.revision)!;
      assert.equal(row.sealRows, expected.sealRows, `Revision ${row.revision} seal rows must match the ledger.`);
      assert.equal(row.sealed, expected.sealed, `Revision ${row.revision} games must match the ledger.`);
      assert.equal(row.scored, expected.scored, `Revision ${row.revision} scored games must match the ledger.`);
      close(row.brier, mean(expected.losses), `Revision ${row.revision} Brier`);
    }
    assert.equal(revisions.reduce((sum, row) => sum + row.sealed, 0), summary.sealed, "Revisions must cover every sealed game once.");
    assert.equal(revisions.reduce((sum, row) => sum + row.scored, 0), summary.scored, "Revisions must cover every scored game once.");
  }
  const published = state.records[LIVE_MODEL_VERSION];
  const split = [
    "originalMorningBrier", "originalMorningCount", "reissuedBrier", "reissuedCount",
    "latestPreFinalBrier", "latestPreFinalCount", "policyRevisions",
  ] as const;
  if (published.originalMorningCount !== undefined) {
    for (const key of split) assert.deepEqual(published[key], summary[key], `Published ${key} must match the ledger.`);
  }
  console.log(
    `Record split matches the ledger (${published.originalMorningCount === undefined ? "state predates the split" : "state checked"}): ` +
      `original morning n=${original.length}, reissued n=${reissued.length}, latest pre-final n=${latest.length}; ` +
      `revisions ${(summary.policyRevisions ?? []).map((row) => `${row.revision}:${row.sealed}/${row.scored}`).join(" ")} (games/scored).`,
  );
}

export function runLiveChecks(): void {
  const raw = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "data/live/state.json"), "utf-8"),
  ) as LiveState | (Omit<LiveState, "schemaVersion"> & { schemaVersion: 1 });

  checkFrozenInjuryInputs();
  checkInjuryInvariants();
  checkProjectionInvariants();
  checkScoreInvariants();
  checkOnCourtInvariants();

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
  if (raw.schemaVersion === 2) checkRecordSplit(raw, ledgerRows);
  checkSiteFiles();
  if (raw.schemaVersion === 2) checkModelViews(upgradeLiveState(state), storedGames, ledgerRows);
}

if (process.argv[1]?.endsWith("live-checks.ts")) {
  runLiveChecks();
  console.log("Live checks passed.");
}
