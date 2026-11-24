import { describe, expect, it } from "vitest";
import { buildOddsHistoryView, VIEW_FILE_LIMIT_BYTES } from "../scripts/live/model-views";
import {
  buildOddsHistory,
  ODDS_HISTORY_METRICS,
  oddsHistoryProblems,
  oddsHistoryStateProblems,
  parseOddsHistory,
  type OddsHistoryFile,
  type OddsHistorySnapshot,
} from "@/lib/season/odds-history";
import { siteFileContent } from "@/lib/season/site-files";
import { SEASON_TEAMS } from "@/lib/season/teams";
import type { SeasonForecast, TeamHistoryPoint } from "@/lib/season/types";
import { etDates, syntheticForecast } from "./support/odds-history-fixtures";

const SEASON = 2027;
const LABEL = "2026-27";
const TEAM_IDS = SEASON_TEAMS.map((team) => team.id);

const snapshot = (date: string, forecast: SeasonForecast): OddsHistorySnapshot => ({ name: `${date}.json`, text: `${JSON.stringify(forecast)}\n` });

/** `state.history` as `loadHistoryPoints` builds it from the same snapshots and forecast. */
function historyOf(snapshots: readonly { date: string; forecast: SeasonForecast }[], slate: string, forecast: SeasonForecast): TeamHistoryPoint[] {
  const champion = (value: SeasonForecast) => Object.fromEntries(value.teams.map((team) => [team.teamId, team.champion]));
  return [
    ...snapshots.filter((entry) => entry.date !== slate).map((entry) => ({ date: entry.date, champion: champion(entry.forecast) })),
    { date: slate, champion: champion(forecast) },
  ];
}

function season(days: number) {
  const dates = etDates("2026-10-21", days);
  const stored = dates.map((date, index) => ({ date, forecast: syntheticForecast(SEASON, index + 1) }));
  const slate = dates.at(-1)!;
  const forecast = syntheticForecast(SEASON, 999);
  return { dates, stored, slate, forecast, snapshots: stored.map((entry) => snapshot(entry.date, entry.forecast)) };
}

describe("building the odds history", () => {
  it("has every stored date in order, then the slate from the run's forecast, values copied exactly", () => {
    const { dates, stored, slate, forecast, snapshots } = season(5);
    // Directory order is not relied on; the slate's stored snapshot is replaced by the forecast.
    const { file, skipped } = buildOddsHistory({ season: SEASON, seasonLabel: LABEL, slate, forecast, snapshots: [...snapshots].reverse() });
    expect(skipped).toEqual([]);
    expect(file.dates).toEqual(dates);
    expect(file.teamIds).toEqual(TEAM_IDS);
    for (const metric of ODDS_HISTORY_METRICS) {
      expect(file[metric][0]).toEqual(stored[0].forecast.teams.map((team) => team[metric]));
      expect(file[metric].at(-1)).toEqual(forecast.teams.map((team) => team[metric]));
    }
    expect(oddsHistoryProblems(file, { season: SEASON, seasonLabel: LABEL })).toEqual([]);
    expect(oddsHistoryStateProblems(file, { slateEtDate: slate, forecast, history: historyOf(stored, slate, forecast) })).toEqual([]);
  });

  it("puts teams in the fixed order whatever order a snapshot lists them in", () => {
    const { slate, forecast, stored } = season(2);
    const shuffled = { ...stored[0].forecast, teams: [...stored[0].forecast.teams].reverse() };
    const { file } = buildOddsHistory({ season: SEASON, seasonLabel: LABEL, slate, forecast, snapshots: [snapshot(stored[0].date, shuffled)] });
    expect(file.teamIds).toEqual(TEAM_IDS);
    expect(file.champion[0]).toEqual(stored[0].forecast.teams.map((team) => team.champion));
  });

  it("leaves out a bad snapshot's date and reports it, without failing the view", () => {
    const { stored, slate, forecast, snapshots } = season(10);
    const bad = (index: number, change: (value: SeasonForecast) => unknown): OddsHistorySnapshot => ({
      name: `${stored[index].date}.json`,
      text: JSON.stringify(change(structuredClone(stored[index].forecast))),
    });
    const broken: OddsHistorySnapshot[] = [
      { name: `${stored[0].date}.json`, text: "{not json" },
      { name: `${stored[1].date}.json`, text: null, error: "EACCES" },
      bad(2, (value) => ({ ...value, teams: value.teams.slice(1) })),
      bad(3, (value) => ((value.teams[4].champion = 1.2), value)),
      bad(4, (value) => ((value.teams[0].makePlayoffs = value.teams[0].topSix - 0.1), value)),
      bad(5, (value) => ((value.teams[0].projectedWins = 41.123456), value)),
      bad(6, (value) => ({ ...value, season: SEASON - 1 })),
      bad(7, (value) => {
        delete (value.teams[2] as Partial<SeasonForecast["teams"][number]>).playIn;
        return value;
      }),
      snapshots[8],
      { name: "notes.txt", text: "x" },
      snapshot("2099-01-01", stored[0].forecast),
    ];
    const { file, skipped } = buildOddsHistory({ season: SEASON, seasonLabel: LABEL, slate, forecast, snapshots: broken });
    expect(file.dates).toEqual([stored[8].date, slate]);
    expect(skipped.map((skip) => skip.name)).toEqual([...stored.slice(0, 8).map((entry) => `${entry.date}.json`), "2099-01-01.json", "notes.txt"]);
    expect(skipped.find((skip) => skip.name === `${stored[1].date}.json`)?.reason).toContain("EACCES");
    expect(skipped.find((skip) => skip.name === "2099-01-01.json")?.reason).toContain("after the slate");
    expect(oddsHistoryProblems(file)).toEqual([]);
  });

  it("is the slate alone with an empty snapshot directory", () => {
    const forecast = syntheticForecast(SEASON, 7);
    const { file, skipped } = buildOddsHistory({ season: SEASON, seasonLabel: LABEL, slate: "2026-10-21", forecast, snapshots: [] });
    expect(skipped).toEqual([]);
    expect(file.dates).toEqual(["2026-10-21"]);
    expect(file.champion).toEqual([forecast.teams.map((team) => team.champion)]);
    expect(oddsHistoryProblems(file)).toEqual([]);
  });

  it("throws when the slate's own forecast is not publishable", () => {
    const forecast = syntheticForecast(SEASON, 7);
    forecast.teams[0].champion = Number.NaN;
    expect(() => buildOddsHistory({ season: SEASON, seasonLabel: LABEL, slate: "2026-10-21", forecast, snapshots: [] })).toThrow(/slate's forecast/);
  });
});

describe("validating the odds history", () => {
  const valid = (): OddsHistoryFile => {
    const { slate, forecast, snapshots } = season(4);
    return buildOddsHistory({ season: SEASON, seasonLabel: LABEL, slate, forecast, snapshots }).file;
  };

  it.each<[string, (file: OddsHistoryFile) => unknown, RegExp]>([
    ["dates out of order", (file) => ([file.dates[0], file.dates[1]] = [file.dates[1], file.dates[0]]), /strictly ascending/],
    ["a repeated date", (file) => (file.dates[1] = file.dates[0]), /strictly ascending/],
    ["a date that is not an ET date", (file) => (file.dates[0] = "Nov 1"), /ET dates/],
    ["teams in another order", (file) => file.teamIds.reverse(), /fixed order/],
    ["29 teams on one date", (file) => file.rating[2].pop(), /29 values for 30 teams/],
    ["a missing row", (file) => file.playIn.pop(), /3 rows for 4 dates/],
    ["a probability above 1", (file) => (file.topSix[1][3] = 1.5), /outside \[0, 1\]/],
    ["a negative probability", (file) => (file.playIn[1][3] = -0.1), /outside \[0, 1\]/],
    ["title odds not summing to 1", (file) => (file.champion[0][0] = Number((file.champion[0][0] + 0.05).toFixed(4))), /sums to/],
    ["playoff odds below top-six odds", (file) => (file.makePlayoffs[0][5] = Number((file.topSix[0][5] - 0.01).toFixed(4))), /below topSix/],
    ["an unrounded value", (file) => (file.rating[0][0] = 1.23456), /not rounded/],
    ["an extra key", (file) => Object.assign(file, { generatedAt: "x" }), /keys are/],
    ["another version", (file) => Object.assign(file, { version: 2 }), /version/],
  ])("rejects %s", (_, change, problem) => {
    const file = valid();
    change(file);
    expect(oddsHistoryProblems(file).join("; ")).toMatch(problem);
    expect(() => parseOddsHistory(JSON.stringify(file))).toThrow(/malformed/);
  });

  it("rejects another season", () => {
    expect(oddsHistoryProblems(valid(), { seasonLabel: "2025-26" }).join("; ")).toMatch(/seasonLabel/);
  });

  it("parses what the builder writes", () => {
    const file = valid();
    expect(parseOddsHistory(siteFileContent(file), { season: SEASON, seasonLabel: LABEL })).toEqual(file);
  });

  it("reports disagreement with the state: slate, forecast and history", () => {
    const { stored, slate, forecast, snapshots } = season(4);
    const { file } = buildOddsHistory({ season: SEASON, seasonLabel: LABEL, slate, forecast, snapshots });
    const history = historyOf(stored, slate, forecast);
    expect(oddsHistoryStateProblems(file, { slateEtDate: "2026-12-01", forecast, history }).join()).toMatch(/not the slate/);
    const other = syntheticForecast(SEASON, 5);
    expect(oddsHistoryStateProblems(file, { slateEtDate: slate, forecast: other, history }).join()).toMatch(/the forecast's is/);
    const changed = structuredClone(history);
    changed[1].champion[TEAM_IDS[0]] = 0.5;
    expect(oddsHistoryStateProblems(file, { slateEtDate: slate, forecast, history: changed }).join()).toMatch(/state\.history's is 0\.5/);
  });
});

describe("the job's odds history view", () => {
  it("stays well under the view limit for a 180-date season", () => {
    const { stored, slate, forecast, snapshots } = season(180);
    const view = buildOddsHistoryView({ season: SEASON, seasonLabel: LABEL, slate, forecast, history: historyOf(stored, slate, forecast), snapshots });
    const bytes = Buffer.byteLength(view.content);
    expect(view.file.dates).toHaveLength(180);
    expect(view.relative).toBe(`site/${LABEL}/odds-history.json`);
    // About 1.2 KB a date: about 220 KB for the season, under a sixth of the limit.
    expect(bytes).toBeLessThan(260_000);
    expect(bytes).toBeLessThan(VIEW_FILE_LIMIT_BYTES / 5);
  });

  it("throws over the size limit, so the view is not published", () => {
    const { stored, slate, forecast, snapshots } = season(30);
    const input = { season: SEASON, seasonLabel: LABEL, slate, forecast, history: historyOf(stored, slate, forecast), snapshots };
    expect(() => buildOddsHistoryView({ ...input, limitBytes: 10_000 })).toThrow(/over 10000/);
  });

  it("throws when it disagrees with state.history", () => {
    const { stored, slate, forecast, snapshots } = season(3);
    const history = historyOf(stored, slate, forecast);
    history[0].champion[TEAM_IDS[3]] = 0.25;
    expect(() => buildOddsHistoryView({ season: SEASON, seasonLabel: LABEL, slate, forecast, history, snapshots })).toThrow(/state\.history/);
  });

  it("publishes with a bad snapshot left out and listed", () => {
    const { stored, slate, forecast, snapshots } = season(3);
    const view = buildOddsHistoryView({
      season: SEASON,
      seasonLabel: LABEL,
      slate,
      forecast,
      history: historyOf(stored.slice(1), slate, forecast),
      snapshots: [{ name: snapshots[0].name, text: "[]" }, ...snapshots.slice(1)],
    });
    expect(view.file.dates).toEqual([stored[1].date, slate]);
    expect(view.skipped).toEqual([{ name: snapshots[0].name, reason: expect.stringContaining("malformed") }]);
  });
});
