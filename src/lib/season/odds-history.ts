// The odds history, a model view the job publishes as site/{season}/odds-history.json:
// every team's season odds for each ET date of the live season, from the full season
// forecast the job stores per date (data/live/snapshots/{season}/{etDate}.json) and, for
// the slate date, the forecast it publishes in the same run. Derived display data only:
// never a model input, never sealed, never scored.
//
// Dates follow the rule `state.history` follows (`loadHistoryPoints` in
// scripts/live/pipeline.ts): every stored snapshot except the slate date's, in file-name
// order, then the slate date from the run's forecast. So the view's `champion` equals
// `state.history`'s on every date both have. A snapshot that cannot be read or does not
// validate leaves its date out and is reported; it never fails the view.
//
// Layout is columnar to stay small: `teamIds` once, `dates` once, and for each metric a
// matrix of dates × teams (row i is dates[i], column j is teamIds[j]). About 1.3 KB a
// date, so a 180-date season is about 230 KB, well under the 1.5 MB view limit.
// Values are copied exactly; they are rounded as state.json rounds them (probabilities to
// four decimals, projected wins to two, ratings to three), and a value that is not is
// rejected. Pure: no fetch, no file access.

import { SEASON_TEAMS } from "@/lib/season/teams";
import type { SeasonForecast, TeamHistoryPoint } from "@/lib/season/types";

export const ODDS_HISTORY_PROBABILITIES = ["makePlayoffs", "topSix", "playIn", "champion"] as const;
export const ODDS_HISTORY_METRICS = [...ODDS_HISTORY_PROBABILITIES, "projectedWins", "rating"] as const;
export type OddsHistoryMetric = (typeof ODDS_HISTORY_METRICS)[number];

/** Decimal places each metric is published with in state.json (`roundForecast` in pipeline.ts). */
export const ODDS_HISTORY_DIGITS: Record<OddsHistoryMetric, number> = {
  makePlayoffs: 4,
  topSix: 4,
  playIn: 4,
  champion: 4,
  projectedWins: 2,
  rating: 3,
};

/** The tolerance `verify:live` gives the published forecast's title-odds sum. */
export const ODDS_HISTORY_SUM_TOLERANCE = 0.01;

/** A regular season's games: the most a team can project to win. */
const SEASON_GAMES = 82;

export type OddsHistoryFile = {
  version: 1;
  season: number;
  seasonLabel: string;
  /** The 30 team ids, in `SEASON_TEAMS` order (the forecast's). */
  teamIds: string[];
  /** ET dates, ascending, ending with the slate date. */
  dates: string[];
} & Record<OddsHistoryMetric, number[][]>;

/** One stored snapshot file as the caller read it: its text, or null with the read error. */
export type OddsHistorySnapshot = { name: string; text: string | null; error?: string };

export type OddsHistorySkip = { name: string; reason: string };

const ET_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FILE_KEYS = ["version", "season", "seasonLabel", "teamIds", "dates", ...ODDS_HISTORY_METRICS].sort();

const isRounded = (value: number, digits: number) => Number(value.toFixed(digits)) === value;

/** Why one metric value is not publishable, or null. */
function valueProblem(metric: OddsHistoryMetric, value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return `${metric} is not a finite number`;
  if ((ODDS_HISTORY_PROBABILITIES as readonly string[]).includes(metric) && (value < 0 || value > 1)) {
    return `${metric} ${value} is outside [0, 1]`;
  }
  if (metric === "projectedWins" && (value < 0 || value > SEASON_GAMES)) return `projectedWins ${value} is outside [0, ${SEASON_GAMES}]`;
  if (!isRounded(value, ODDS_HISTORY_DIGITS[metric])) return `${metric} ${value} is not rounded to ${ODDS_HISTORY_DIGITS[metric]} places`;
  return null;
}

/** Why one date's values (one entry per team, in `teamIds` order) are not publishable. */
function rowProblems(values: Record<OddsHistoryMetric, readonly unknown[]>, teamIds: readonly string[]): string[] {
  const problems: string[] = [];
  for (const metric of ODDS_HISTORY_METRICS) {
    const row = values[metric];
    if (!Array.isArray(row) || row.length !== teamIds.length) {
      problems.push(`${metric} has ${Array.isArray(row) ? row.length : "no"} values for ${teamIds.length} teams`);
      continue;
    }
    row.forEach((value, index) => {
      const problem = valueProblem(metric, value);
      if (problem) problems.push(`team ${teamIds[index]}: ${problem}`);
    });
  }
  if (problems.length > 0) return problems;
  const champion = (values.champion as number[]).reduce((sum, value) => sum + value, 0);
  if (Math.abs(champion - 1) >= ODDS_HISTORY_SUM_TOLERANCE) problems.push(`champion sums to ${champion}, not 1`);
  teamIds.forEach((teamId, index) => {
    if ((values.makePlayoffs[index] as number) < (values.topSix[index] as number)) {
      problems.push(`team ${teamId}: makePlayoffs is below topSix`);
    }
  });
  return problems;
}

/** One date's values from a forecast, in `SEASON_TEAMS` order, or why the forecast cannot supply them. */
function forecastRow(
  forecast: unknown,
  season: number,
): { values: Record<OddsHistoryMetric, unknown[]>; problems: string[] } | { values: null; problems: string[] } {
  if (typeof forecast !== "object" || forecast === null) return { values: null, problems: ["not an object"] };
  const raw = forecast as { season?: unknown; teams?: unknown };
  if (raw.season !== season) return { values: null, problems: [`season ${String(raw.season)}, not ${season}`] };
  if (!Array.isArray(raw.teams)) return { values: null, problems: ["no teams"] };
  const byTeam = new Map<string, Record<string, unknown>>();
  for (const team of raw.teams as unknown[]) {
    if (typeof team !== "object" || team === null || typeof (team as { teamId?: unknown }).teamId !== "string") {
      return { values: null, problems: ["a team without a teamId"] };
    }
    const teamId = (team as { teamId: string }).teamId;
    if (byTeam.has(teamId)) return { values: null, problems: [`team ${teamId} appears twice`] };
    byTeam.set(teamId, team as Record<string, unknown>);
  }
  const teamIds = SEASON_TEAMS.map((team) => team.id);
  const unknown = [...byTeam.keys()].filter((teamId) => !teamIds.includes(teamId));
  const missing = teamIds.filter((teamId) => !byTeam.has(teamId));
  if (unknown.length > 0 || missing.length > 0) {
    return { values: null, problems: [`teams do not match the league (missing ${missing.join(",") || "none"}, unknown ${unknown.join(",") || "none"})`] };
  }
  const values = Object.fromEntries(
    ODDS_HISTORY_METRICS.map((metric) => [metric, teamIds.map((teamId) => byTeam.get(teamId)![metric])]),
  ) as Record<OddsHistoryMetric, unknown[]>;
  const problems = rowProblems(values, teamIds);
  return problems.length > 0 ? { values: null, problems } : { values, problems: [] };
}

/**
 * The odds history from the stored snapshots (the directory's files in any order; sorted
 * here by name, as `loadHistoryPoints` reads them) and the slate's forecast. Snapshots
 * that are unreadable, malformed, not named by an ET date, or dated after the slate are
 * left out and listed in `skipped`; the slate date's stored snapshot is replaced by the
 * run's forecast. Throws only when the slate's forecast itself is not publishable.
 */
export function buildOddsHistory(input: {
  season: number;
  seasonLabel: string;
  slate: string;
  forecast: SeasonForecast;
  snapshots: readonly OddsHistorySnapshot[];
}): { file: OddsHistoryFile; skipped: OddsHistorySkip[] } {
  const teamIds = SEASON_TEAMS.map((team) => team.id);
  const dates: string[] = [];
  const matrices = Object.fromEntries(ODDS_HISTORY_METRICS.map((metric) => [metric, [] as number[][]])) as Record<
    OddsHistoryMetric,
    number[][]
  >;
  const add = (date: string, values: Record<OddsHistoryMetric, unknown[]>) => {
    dates.push(date);
    for (const metric of ODDS_HISTORY_METRICS) matrices[metric].push(values[metric] as number[]);
  };
  const skipped: OddsHistorySkip[] = [];
  const names = [...input.snapshots].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const snapshot of names) {
    const date = snapshot.name.replace(".json", "");
    if (date === input.slate) continue;
    const skip = (reason: string) => skipped.push({ name: snapshot.name, reason });
    if (!ET_DATE.test(date) || snapshot.name !== `${date}.json`) {
      skip("not named by an ET date");
      continue;
    }
    if (date > input.slate) {
      skip(`dated after the slate ${input.slate}`);
      continue;
    }
    if (snapshot.text === null) {
      skip(`unreadable: ${snapshot.error ?? "no content"}`);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(snapshot.text);
    } catch (error) {
      skip(`not JSON: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const row = forecastRow(parsed, input.season);
    if (!row.values) {
      skip(`malformed: ${row.problems.slice(0, 3).join("; ")}`);
      continue;
    }
    add(date, row.values);
  }
  const slate = forecastRow(input.forecast, input.season);
  if (!slate.values) throw new Error(`the slate's forecast is not publishable: ${slate.problems.slice(0, 3).join("; ")}`);
  add(input.slate, slate.values);
  return {
    file: { version: 1, season: input.season, seasonLabel: input.seasonLabel, teamIds, dates, ...matrices },
    skipped,
  };
}

/**
 * Why a value is not a publishable odds history, or an empty list: the exact keys,
 * the season, the 30 teams in `SEASON_TEAMS` order, ET dates strictly ascending (so
 * unique), one row per date and one value per team in every metric, probabilities in
 * [0, 1], values rounded as state.json rounds them, title odds summing to 1 within
 * `ODDS_HISTORY_SUM_TOLERANCE` and playoff odds at least top-six odds on every date.
 */
export function oddsHistoryProblems(value: unknown, expected?: { season?: number; seasonLabel?: string }): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return ["not an object"];
  const raw = value as Record<string, unknown>;
  const keys = Object.keys(raw).sort();
  if (keys.join(",") !== FILE_KEYS.join(",")) return [`keys are ${keys.join(",")}, not ${FILE_KEYS.join(",")}`];
  const problems: string[] = [];
  if (raw.version !== 1) problems.push(`version ${String(raw.version)}, not 1`);
  if (typeof raw.season !== "number" || !Number.isInteger(raw.season)) problems.push("season is not an integer");
  if (typeof raw.seasonLabel !== "string") problems.push("seasonLabel is not a string");
  if (expected?.season !== undefined && raw.season !== expected.season) problems.push(`season ${String(raw.season)}, not ${expected.season}`);
  if (expected?.seasonLabel !== undefined && raw.seasonLabel !== expected.seasonLabel) {
    problems.push(`seasonLabel ${String(raw.seasonLabel)}, not ${expected.seasonLabel}`);
  }
  const teamIds = SEASON_TEAMS.map((team) => team.id);
  if (!Array.isArray(raw.teamIds) || raw.teamIds.join(",") !== teamIds.join(",") || raw.teamIds.length !== teamIds.length) {
    problems.push("teamIds are not the 30 teams in their fixed order");
  }
  if (!Array.isArray(raw.dates) || raw.dates.length === 0 || !raw.dates.every((date) => typeof date === "string" && ET_DATE.test(date))) {
    problems.push("dates are not a non-empty list of ET dates");
  }
  if (problems.length > 0) return problems;
  const dates = raw.dates as string[];
  dates.forEach((date, index) => {
    if (index > 0 && date <= dates[index - 1]) problems.push(`dates are not strictly ascending at ${date}`);
  });
  for (const metric of ODDS_HISTORY_METRICS) {
    const matrix = raw[metric];
    if (!Array.isArray(matrix) || matrix.length !== dates.length) {
      problems.push(`${metric} has ${Array.isArray(matrix) ? matrix.length : "no"} rows for ${dates.length} dates`);
    }
  }
  if (problems.length > 0) return problems;
  dates.forEach((date, index) => {
    const values = Object.fromEntries(
      ODDS_HISTORY_METRICS.map((metric) => [metric, (raw[metric] as unknown[])[index]]),
    ) as Record<OddsHistoryMetric, unknown[]>;
    for (const problem of rowProblems(values, teamIds)) problems.push(`${date}: ${problem}`);
  });
  return problems;
}

/**
 * Why a valid odds history does not agree with the state published beside it, or an
 * empty list: its last date is the state's slate date, its teams are in the forecast's
 * order, the slate date's values equal `state.forecast`, and `champion` equals
 * `state.history` on every date both have.
 */
export function oddsHistoryStateProblems(
  file: OddsHistoryFile,
  state: { slateEtDate: string; forecast: Pick<SeasonForecast, "teams">; history: readonly TeamHistoryPoint[] },
): string[] {
  const problems: string[] = [];
  if (file.dates.at(-1) !== state.slateEtDate) problems.push(`the last date is ${file.dates.at(-1)}, not the slate ${state.slateEtDate}`);
  const order = state.forecast.teams.map((team) => team.teamId);
  if (order.join(",") !== file.teamIds.join(",")) problems.push("teams are not in the forecast's order");
  if (problems.length > 0) return problems;
  const last = file.dates.length - 1;
  state.forecast.teams.forEach((team, index) => {
    for (const metric of ODDS_HISTORY_METRICS) {
      if (file[metric][last][index] !== team[metric]) {
        problems.push(`${state.slateEtDate} ${team.teamId} ${metric} is ${file[metric][last][index]}, the forecast's is ${team[metric]}`);
      }
    }
  });
  const row = new Map(file.dates.map((date, index) => [date, index]));
  for (const point of state.history) {
    const index = row.get(point.date);
    if (index === undefined) continue;
    file.teamIds.forEach((teamId, column) => {
      if (point.champion[teamId] !== file.champion[index][column]) {
        problems.push(`${point.date} ${teamId} champion is ${file.champion[index][column]}, state.history's is ${point.champion[teamId]}`);
      }
    });
  }
  return problems;
}

/** Parses and validates a published odds history; throws when it is not one. */
export function parseOddsHistory(text: string, expected?: { season?: number; seasonLabel?: string }): OddsHistoryFile {
  const raw: unknown = JSON.parse(text);
  const problems = oddsHistoryProblems(raw, expected);
  if (problems.length > 0) throw new Error(`odds history is malformed: ${problems.slice(0, 3).join("; ")}`);
  return raw as OddsHistoryFile;
}
