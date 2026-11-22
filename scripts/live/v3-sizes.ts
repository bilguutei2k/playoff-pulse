// Size report for v3 (plan step A7): how much each fix alone and all three together move
// the published state's playoff and title odds, and the unfiled-side seal terms. Local,
// offline, publishes nothing. Run only in a throwaway clone whose data/live comes from
// origin/live-data (git archive), never in a shared worktree:
//
//   corepack pnpm exec tsx scripts/live/v3-sizes.ts <output.json>
//
// The inputs are rebuilt as scripts/live/pipeline.ts builds them for the state in
// data/live/state.json: stored games, box scores and report days, the published ratings
// replay (as of the slate), the report in use (state.availability.reportAt), then the
// season simulation. v2 is checked against the published forecast first. The v3 gap hook
// runs on the live season's games only (the tracker restarts each season, so this is the
// same tracker), so no v3 code touches an earlier season.

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { daysBetween, etWallClockOf } from "../../src/lib/season/dates";
import { seasonLabel } from "../../src/lib/season/formats";
import { replayInjuryModel, type AvailabilityTracker, type ReportPoint } from "../../src/lib/season/injury-model";
import {
  applyLatestWord,
  buildAbsenceSchedule,
  createGapTracker,
  currentAbsencesV3,
  gapHook,
  nextGameAbsenceDetailV3,
  V3_ALL_OFF,
  type GapTracker,
  type HazardTable,
  type V3Model,
  type V3Switches,
} from "../../src/lib/season/injury-v3";
import {
  applyLatestReport,
  forgetEarlierSeasonReports,
  nextGameAbsenceDetail,
  replayFullStrength,
  seasonAvailability,
  unfiledOn,
  type InjuryModel,
} from "../../src/lib/season/live-injury";
import { latestReport, toReportPoint, type LiveReportDay } from "../../src/lib/season/live-reports";
import type { LiveState } from "../../src/lib/season/types";
import {
  INJURY_PARAMS,
  INJURY_STATUS_TABLE,
  INJURY_SURVIVAL,
  LIVE_PARAMS,
  LIVE_SIMULATION_ITERATIONS,
  SIMULATOR_UNCERTAINTY_SCALE,
} from "../../src/lib/season/params";
import { buildObservedPostseason, detectPhase } from "../../src/lib/season/postseason";
import { advanceDays, createFilterState, isRatable } from "../../src/lib/season/ratings";
import { simulateSeason, type SimulationInput } from "../../src/lib/season/simulate";
import { SEASON_TEAMS, teamById } from "../../src/lib/season/teams";
import type { SeasonForecast, SeasonGame } from "../../src/lib/season/types";
import { compareGames, gamesPath, LIVE_SEASON, loadHistory } from "./game-store";
import { loadLiveAvailability, loadLiveBoxScores } from "./live-availability";

const ITERATIONS = 100_000;
const SEASON = LIVE_SEASON;
const LABEL = seasonLabel(SEASON);
const root = process.cwd();
const target = process.argv[2];
if (!target) throw new Error("Usage: v3-sizes.ts <output.json>");

const MODEL: InjuryModel = { params: LIVE_PARAMS, injury: INJURY_PARAMS, statusTable: INJURY_STATUS_TABLE, survival: INJURY_SURVIVAL };
const hazards = (JSON.parse(fs.readFileSync(path.join(root, "docs/live/v3-fit.json"), "utf-8")) as { hazards: HazardTable }).hazards;
const v3Model = (switches: V3Switches): V3Model => ({
  injury: INJURY_PARAMS,
  statusTable: INJURY_STATUS_TABLE,
  hazards,
  v2Survival: INJURY_SURVIVAL,
  switches,
});

const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, "utf-8")) as T;
const state = readJson<LiveState>(path.join(root, "data/live/state.json"));
const slate = state.slateEtDate;
const nowIso = state.generatedAt;
const seasonGames = readJson<SeasonGame[]>(gamesPath(SEASON)).sort(compareGames);
const history = loadHistory(SEASON - 1).sort(compareGames);
const liveBox = loadLiveBoxScores(SEASON);
const reportDirectory = path.join(root, "data/live/reports", LABEL);
const reportDays = new Map<string, LiveReportDay>();
for (const file of fs.readdirSync(reportDirectory).sort()) {
  if (!file.endsWith(".json")) continue;
  const day = readJson<LiveReportDay>(path.join(reportDirectory, file));
  reportDays.set(day.etDate, day);
}
const live = loadLiveAvailability(SEASON, liveBox, seasonGames, (etDate) => reportDays.get(etDate) ?? null);
const phase = detectPhase(seasonGames, SEASON);
const observed = phase === "regular-season" ? undefined : buildObservedPostseason(seasonGames);

function pointAt(etDate: string, at: string | null): ReportPoint | null {
  const day = reportDays.get(etDate) ?? null;
  const chosen = at ? (day?.reports[at] ? { at, report: day.reports[at] } : null) : latestReport(day, etWallClockOf(nowIso));
  if (!chosen) return null;
  return toReportPoint(chosen.report, chosen.at, (teamId, printed) => live.resolve(SEASON, teamId, printed));
}
const reportInUse = state.availability?.missing ? null : pointAt(slate, state.availability?.reportAt ?? null);

/** replayFullStrength's replay, with the v3 gap hook on the live season's games. */
function replayWithGaps(options: { throughEtDate?: string; asOfEtDate?: string }) {
  const games = [...history, ...seasonGames];
  const gaps = createGapTracker();
  const hook = gapHook(gaps, live.source);
  const first = games.find(isRatable);
  const replay = replayInjuryModel({
    games,
    state: createFilterState(LIVE_PARAMS),
    stateSeason: first?.season ?? 0,
    params: LIVE_PARAMS,
    injury: INJURY_PARAMS,
    statusTable: INJURY_STATUS_TABLE,
    boxScores: live.source.boxScores,
    availability: live.source.availability,
    throughEtDate: options.throughEtDate,
    onAbsences: (game, teamId, absences) => {
      if (game.season === SEASON) hook(game, teamId, absences);
    },
  });
  const included = games.filter((game) => isRatable(game) && (options.throughEtDate === undefined || game.etDate < options.throughEtDate));
  const last = included.at(-1);
  if (options.asOfEtDate && last) advanceDays(replay.state, daysBetween(last.etDate, options.asOfEtDate), LIVE_PARAMS);
  // The hook must leave v2's replay as replayFullStrength makes it.
  const reference = replayFullStrength(games, MODEL, live.source, options);
  assert.deepStrictEqual(Array.from(replay.state.mean), Array.from(reference.state.mean));
  assert.deepStrictEqual(replay.tracker.missed, reference.tracker.missed);
  return { ...replay, gaps };
}

// ---------------------------------------------------------------------------
// Season odds: the published state's inputs
// ---------------------------------------------------------------------------

const display = replayWithGaps({ asOfEtDate: slate });
forgetEarlierSeasonReports(display.tracker, seasonGames, live.source);
const unfinishedSlateTeams = seasonGames
  .filter((game) => game.etDate === slate && game.status !== "postponed" && game.status !== "canceled" && game.status !== "final")
  .flatMap((game) => [game.homeId, game.awayId]);
applyLatestReport(display.tracker, reportInUse, unfinishedSlateTeams);
applyLatestWord(display.gaps, reportInUse, unfinishedSlateTeams);

const base = (iterations: number): SimulationInput => ({
  season: SEASON,
  phase,
  observed,
  games: seasonGames,
  state: display.state,
  params: LIVE_PARAMS,
  asOfEtDate: slate,
  lastGameEtDate: display.lastGameEtDate,
  iterations,
  uncertaintyScale: SIMULATOR_UNCERTAINTY_SCALE,
});
const v2Availability = seasonAvailability(display.tracker, MODEL, seasonGames);

// Reproduce the published forecast first (same iterations, rounded as published).
const check = simulateSeason({ ...base(LIVE_SIMULATION_ITERATIONS), absences: v2Availability.simulation });
const r4 = (value: number) => Number(value.toFixed(4));
let reproduced = true;
for (const team of state.forecast.teams) {
  const mine = check.teams.find((row) => row.teamId === team.teamId);
  if (!mine || r4(mine.makePlayoffs) !== team.makePlayoffs || r4(mine.champion) !== team.champion) reproduced = false;
}

const variants: Record<string, V3Switches> = {
  expiryOnly: { expiry: true, hazards: false, postseasonSchedule: false },
  hazardsOnly: { expiry: false, hazards: true, postseasonSchedule: false },
  postseasonScheduleOnly: { expiry: false, hazards: false, postseasonSchedule: true },
  allThree: { expiry: true, hazards: true, postseasonSchedule: true },
};
const schedule = (switches: V3Switches) =>
  buildAbsenceSchedule(currentAbsencesV3(display.tracker, display.gaps, SEASON, v3Model(switches)).current, v3Model(switches));

// All switches off is v2, bit for bit (a short run).
assert.deepStrictEqual(
  simulateSeason({ ...base(2000), absenceSchedule: schedule(V3_ALL_OFF) }),
  simulateSeason({ ...base(2000), absences: v2Availability.simulation }),
  "v3 with every switch off must equal v2.",
);

const runs: Record<string, SeasonForecast> = {
  v2: simulateSeason({ ...base(ITERATIONS), absences: v2Availability.simulation }),
};
for (const [name, switches] of Object.entries(variants)) {
  runs[name] = simulateSeason({ ...base(ITERATIONS), absenceSchedule: schedule(switches) });
}

const abbr = (teamId: string) => teamById(teamId).abbreviation;
const pct = (value: number) => Math.round(value * 1000) / 10;
function movements(name: string) {
  const rows = SEASON_TEAMS.map((team) => {
    const before = runs.v2.teams.find((row) => row.teamId === team.id) as SeasonForecast["teams"][number];
    const after = runs[name].teams.find((row) => row.teamId === team.id) as SeasonForecast["teams"][number];
    return {
      team: abbr(team.id),
      playoffs: { v2: pct(before.makePlayoffs), v3: pct(after.makePlayoffs), points: pct(after.makePlayoffs - before.makePlayoffs) },
      title: { v2: pct(before.champion), v3: pct(after.champion), points: pct(after.champion - before.champion) },
    };
  });
  const top = (key: "playoffs" | "title") =>
    [...rows].sort((a, b) => Math.abs(b[key].points) - Math.abs(a[key].points) || a.team.localeCompare(b.team)).slice(0, 5);
  return {
    largestPlayoffMoves: top("playoffs"),
    largestTitleMoves: top("title"),
    meanAbsolutePoints: {
      playoffs: Math.round((rows.reduce((sum, row) => sum + Math.abs(row.playoffs.points), 0) / rows.length) * 100) / 100,
      title: Math.round((rows.reduce((sum, row) => sum + Math.abs(row.title.points), 0) / rows.length) * 100) / 100,
    },
    teams: rows,
  };
}

// Who is counted, by variant.
const counted = (switches: V3Switches) => currentAbsencesV3(display.tracker, display.gaps, SEASON, v3Model(switches));
const allOn = counted(variants.allThree);
const absencesSummary = {
  v2Players: v2Availability.current.filter((row) => row.points > 0).length,
  v3Players: allOn.current.length,
  v3NoLongerCounted: allOn.noLongerCounted.map((row) => ({ team: abbr(row.teamId), athleteId: row.athleteId, name: live.nameOf(row.athleteId) ?? null, gamesMissed: row.gamesMissed })),
  droppedByExpiry: v2Availability.current
    .filter((row) => !allOn.current.some((entry) => entry.teamId === row.teamId && entry.athleteId === row.athleteId))
    .map((row) => ({ team: abbr(row.teamId), name: live.nameOf(row.athleteId) ?? row.athleteId, v2GamesMissed: row.gamesMissed, points: Math.round(row.points * 1000) / 1000 })),
};

// ---------------------------------------------------------------------------
// Unfiled-side seal terms, for every game still to be sealed on the slate and the next date
// ---------------------------------------------------------------------------

const v3All = v3Model(variants.allThree);
const nextDates = [...new Set(seasonGames.filter((game) => game.etDate >= slate).map((game) => game.etDate))].sort().slice(0, 2);
const sealTerms: Array<Record<string, unknown>> = [];
for (const etDate of nextDates) {
  // A seal's tracker is the replay through the previous ET date, as sealInjuryGames builds it.
  const point = etDate === slate ? reportInUse : pointAt(etDate, null);
  const pending = seasonGames.filter((game) => game.etDate === etDate && game.status === "scheduled");
  if (!point || pending.length === 0) continue;
  const frozen = replayWithGaps({ throughEtDate: etDate });
  for (const game of pending) {
    for (const teamId of [game.homeId, game.awayId]) {
      if (!unfiledOn(point, teamId)) continue;
      const tracker: AvailabilityTracker = frozen.tracker;
      const gaps: GapTracker = frozen.gaps;
      const v2 = nextGameAbsenceDetail(point, teamId, tracker, MODEL, live.nameOf);
      const v3 = nextGameAbsenceDetailV3(point, teamId, tracker, gaps, SEASON, v3All);
      sealTerms.push({
        etDate,
        gameId: game.id,
        team: abbr(teamId),
        reportAt: point.at,
        v2Points: Math.round(v2.absence * INJURY_PARAMS.beta * 1000) / 1000,
        v3Points: Math.round(v3.absence * INJURY_PARAMS.beta * 1000) / 1000,
        v3Drivers: v3.drivers.map((row) => ({ name: live.nameOf(row.athleteId) ?? row.athleteId, points: Math.round(row.points * 1000) / 1000 })),
      });
    }
  }
}

const output = {
  note: "Size report for live-2026.27-v3 on the published state. Local and offline; nothing published, nothing chosen.",
  state: { generatedAt: state.generatedAt, slate, phase, reportAt: reportInUse?.at ?? null, liveDataCommit: process.env.LIVE_DATA_COMMIT ?? null },
  iterations: ITERATIONS,
  publishedForecastReproduced: reproduced,
  absences: absencesSummary,
  variants: Object.fromEntries(Object.keys(variants).map((name) => [name, movements(name)])),
  unfiledSealTerms: sealTerms,
};
fs.writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`, "utf-8");
const brief = Object.fromEntries(
  Object.entries(output.variants).map(([name, value]) => [
    name,
    { mean: value.meanAbsolutePoints, playoffs: value.largestPlayoffMoves.map((r) => `${r.team} ${r.playoffs.points}`), title: value.largestTitleMoves.map((r) => `${r.team} ${r.title.points}`) },
  ]),
);
console.log(JSON.stringify({ reproduced, absences: { ...absencesSummary }, brief, sealTerms }, null, 1));
