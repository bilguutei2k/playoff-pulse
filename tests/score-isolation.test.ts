// Isolation of the 548 score. Layers: nothing under src/lib/season/ or src/lib/model/
// imports src/lib/score/, and src/lib/score/ never imports the live-data adapter. Eras:
// fit-score.ts refuses any season after 2020, and evaluate-score.ts --era test throws
// before reading a season unless the freeze exists and still matches. Plus an end-to-end
// run of fit, freeze and both evaluations on a simulated league.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ScoreGame } from "@/lib/score/types";
import { runEvaluation } from "../scripts/score/evaluate-score";
import { runFit, type FitSettings } from "../scripts/score/fit-score";
import { freeze } from "../scripts/score/freeze-score";
import {
  METRICS,
  assertFrozen,
  assertTrainingSeason,
  loadTrainingGames,
  passConditions,
  writeJson,
} from "../scripts/score/score-data";
import { simulateSeasons } from "./support/score-league";

const ROOT = path.join(__dirname, "..");

function sourceFiles(directory: string): string[] {
  const output: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) output.push(full);
  }
  return output;
}

/** Every module specifier in import/export-from statements and dynamic imports. */
function specifiers(text: string): string[] {
  const found: string[] = [];
  const patterns = [/\bfrom\s+["']([^"']+)["']/g, /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, /\bimport\s+["']([^"']+)["']/g, /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) found.push(match[1]);
  return found;
}

function resolvesInto(file: string, specifier: string, target: string): boolean {
  if (specifier.startsWith("@/")) return path.join(ROOT, "src", specifier.slice(2)).startsWith(target);
  if (specifier.startsWith(".")) return path.resolve(path.dirname(file), specifier).startsWith(target);
  return false;
}

describe("layer isolation", () => {
  const score = path.join(ROOT, "src", "lib", "score");

  it("no file under src/lib/season/ or src/lib/model/ imports from src/lib/score/", () => {
    const offenders: string[] = [];
    for (const directory of ["season", "model"]) {
      for (const file of sourceFiles(path.join(ROOT, "src", "lib", directory))) {
        for (const specifier of specifiers(fs.readFileSync(file, "utf-8"))) {
          if (resolvesInto(file, specifier, score)) offenders.push(`${path.relative(ROOT, file)} → ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the scan catches both alias and relative imports", () => {
    const file = path.join(ROOT, "src", "lib", "season", "x.ts");
    expect(specifiers('import { a } from "@/lib/score/rapm";').some((s) => resolvesInto(file, s, score))).toBe(true);
    expect(specifiers('export * from "../score/book";').some((s) => resolvesInto(file, s, score))).toBe(true);
    expect(specifiers('const m = await import("../score/types");').some((s) => resolvesInto(file, s, score))).toBe(true);
    expect(specifiers('import type { X } from "@/lib/season/types";').some((s) => resolvesInto(file, s, score))).toBe(false);
  });

  it("src/lib/score/ imports neither the live-data adapter nor Node's file or network modules", () => {
    const liveData = path.join(ROOT, "src", "lib", "live-data");
    const offenders: string[] = [];
    // Files another agent owns are checked too: the rule binds the whole folder.
    for (const file of sourceFiles(score)) {
      for (const specifier of specifiers(fs.readFileSync(file, "utf-8"))) {
        if (resolvesInto(file, specifier, liveData) || /^(node:)?(fs|path|http|https|net|child_process)$/.test(specifier)) {
          offenders.push(`${path.relative(ROOT, file)} → ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("era guards", () => {
  it("the training era refuses any season after 2020, before reading it", () => {
    expect(() => assertTrainingSeason(2020)).not.toThrow();
    expect(() => assertTrainingSeason(2021)).toThrow(/not in the training era/);
    const asked: number[] = [];
    const loader = (season: number) => {
      asked.push(season);
      return [] as ScoreGame[];
    };
    expect(() => loadTrainingGames([2019, 2021], loader)).toThrow(/2021/);
    expect(asked).toEqual([]);
    expect(() => runFit({ loader, seasons: [2018, 2019, 2020, 2021] })).toThrow(/2021/);
    expect(asked).toEqual([]);
  });

  describe("a test-era evaluation", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "score-freeze-"));
    afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
    const paths = {
      registration: path.join(directory, "registration.md"),
      fit: path.join(directory, "fit.json"),
      freeze: path.join(directory, "freeze.json"),
    };
    const asked: number[] = [];
    const loader = (season: number) => {
      asked.push(season);
      return [] as ScoreGame[];
    };

    it("throws without a freeze, before loading any season", () => {
      expect(() => runEvaluation({ era: "test", loader, freezePaths: paths })).toThrow(/No freeze/);
      expect(asked).toEqual([]);
    });

    it("throws when the registration or fit changed since the freeze, or the freeze is malformed", () => {
      fs.writeFileSync(paths.registration, "# Registration\n");
      writeJson(paths.fit, { version: 1 });
      const evaluation = path.join(directory, "evaluation.json");
      freeze({ ...paths, evaluation, now: () => new Date("2026-11-12T00:00:00Z") });
      expect(assertFrozen(paths).frozenAt).toBe("2026-11-12T00:00:00.000Z");
      fs.appendFileSync(paths.registration, "Changed after the freeze.\n");
      expect(() => runEvaluation({ era: "test", loader, freezePaths: paths })).toThrow(/registration file changed/);
      fs.writeFileSync(paths.registration, "# Registration\n");
      expect(() => assertFrozen(paths)).not.toThrow();
      writeJson(paths.fit, { version: 2 });
      expect(() => runEvaluation({ era: "test", loader, freezePaths: paths })).toThrow(/fit file changed/);
      fs.writeFileSync(paths.freeze, "{}");
      expect(() => runEvaluation({ era: "test", loader, freezePaths: paths })).toThrow(/malformed/);
      expect(asked).toEqual([]);
    });

    it("refuses a fit passed in, and freezing refuses unfilled values or a finished test", () => {
      fs.writeFileSync(paths.registration, "# Registration\n");
      writeJson(paths.fit, { version: 1 });
      const evaluation = path.join(directory, "evaluation.json");
      freeze({ ...paths, evaluation });
      expect(() =>
        runEvaluation({ era: "test", loader, freezePaths: paths, fit: { version: 1 } as never }),
      ).toThrow(/never a fit passed in/);
      fs.writeFileSync(paths.registration, "| beta | TO BE FILLED |\n");
      expect(() => freeze({ ...paths, evaluation })).toThrow(/TO BE FILLED/);
      fs.writeFileSync(evaluation, "{}");
      fs.writeFileSync(paths.registration, "# Registration\n");
      expect(() => freeze({ ...paths, evaluation })).toThrow(/can no longer be re-frozen/);
      expect(asked).toEqual([]);
    });
  });
});

describe("the pass rule", () => {
  const base = { score: 9, comparatorUnfloored: 10, teamNetOnly: 9.5, lastSeasonNet: 9.5 };

  it("passes only when all three conditions hold", () => {
    const all = passConditions({ ...base, comparatorUnfloored: 10 / 0.9 + 0.1 });
    expect(all.barVsComparator.passed).toBe(true);
    expect(all.beatsTeamNetOnly.passed).toBe(true);
    expect(all.beatsLastSeasonNet.passed).toBe(true);
    expect(all.passed).toBe(true);
    // Exactly at the bar still meets (i).
    expect(passConditions({ ...base, comparatorUnfloored: 10 }).barVsComparator.passed).toBe(true);
  });

  it("fails on (i) alone even when the score beats both team baselines", () => {
    const result = passConditions({ ...base, comparatorUnfloored: 9.5 });
    expect(result.barVsComparator.ratio).toBeCloseTo(9 / 9.5, 12);
    expect(result.barVsComparator.passed).toBe(false);
    expect(result.beatsTeamNetOnly.passed && result.beatsLastSeasonNet.passed).toBe(true);
    expect(result.passed).toBe(false);
  });

  it("fails when team quality alone does as well: (ii) and (iii) are strict", () => {
    const tiedAblation = passConditions({ ...base, teamNetOnly: 9 });
    expect(tiedAblation.barVsComparator.passed).toBe(true);
    expect(tiedAblation.beatsTeamNetOnly.passed).toBe(false);
    expect(tiedAblation.passed).toBe(false);
    const lastSeasonBetter = passConditions({ ...base, lastSeasonNet: 8.9 });
    expect(lastSeasonBetter.barVsComparator.passed && lastSeasonBetter.beatsTeamNetOnly.passed).toBe(true);
    expect(lastSeasonBetter.beatsLastSeasonNet.passed).toBe(false);
    expect(lastSeasonBetter.passed).toBe(false);
  });
});

describe("the pipeline end to end on a simulated league", () => {
  const seasons = Array.from({ length: 16 }, (_, i) => 2011 + i);
  const games = simulateSeasons(seasons, {
    seed: "pipeline",
    teams: 6,
    playersPerTeam: 9,
    meetings: 4,
    stintsPerGame: 12,
    possessionsPerStint: 8,
    boxBeta: [0.6, -0.5, -0.15, 0.3, 0.5, -0.8, 0.4, 0.2, 1.2, 0.6, -0.3],
    churn: 0.3,
  });
  const bySeason = new Map(seasons.map((season) => [season, games.filter((game) => game.season === season)]));
  const asked: number[] = [];
  const loader = (season: number) => {
    asked.push(season);
    return bySeason.get(season) ?? [];
  };
  const settings: FitSettings = {
    folds: 3,
    rapmSeed: "s",
    rapmLadder: [250, 1000, 4000],
    rapmStep: 2,
    lineupSeed: "l",
    lineupAlphas: [0, 0.01],
    roleAlphas: [0.1, 1],
    roleMinimumMultiple: 10,
    crossCheckSeed: "c",
    crossCheckAlphas: [0, 0.01],
    crossCheckMinPossessions: 1000,
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "score-pipeline-"));
  afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));

  it("fits on the training era only, deterministically, and evaluates both eras", () => {
    const fit = runFit({ loader, settings });
    expect(Math.max(...asked)).toBe(2020);
    expect(JSON.stringify(runFit({ loader, settings }))).toBe(JSON.stringify(fit));
    expect(fit.trainingPairs).toBe(9 * 6);
    expect(fit.rapm.windows.map((w) => w.seasons[0])).toEqual([2012, 2015, 2018]);
    expect(Object.values(fit.primary.beta).every(Number.isFinite)).toBe(true);
    expect(fit.book.table.length).toBe(5 * 7 * 11);
    // The book is tuned on in-season game predictions; the season-to-season cost is kept beside it.
    expect(fit.book.table.every((row) => Number.isFinite(row.rmse) && Number.isFinite(row.endpointRmse))).toBe(true);
    expect(fit.teamLines.score.b).toBeGreaterThan(0);
    // The two added comparisons: the frame's single coefficient, and the four-term line.
    expect(Number.isFinite(fit.gameScoreFrame.s)).toBe(true);
    expect(fit.gameScoreFrame.rows).toBe(fit.primary.rows);
    expect(fit.gameScoreFrame.cv.map((cell) => cell.alpha)).toEqual(settings.lineupAlphas);
    expect(Number.isFinite(fit.teamLines.gameScorePlusTeamNet.d)).toBe(true);
    expect(fit.teamLines.comparatorUnfloored).not.toHaveProperty("d");
    // With a fourth regressor fitted on the same rows, in-sample error cannot rise.
    expect(fit.trainingRmse.gameScorePlusTeamNet).toBeLessThanOrEqual(fit.trainingRmse.comparatorUnfloored + 1e-9);
    for (const metric of METRICS) expect(Number.isFinite(fit.trainingRmse[metric])).toBe(true);

    asked.length = 0;
    const training = runEvaluation({ era: "training", loader, fit });
    expect(Math.max(...asked)).toBe(2020);
    expect(training.teamSeasons).toBe(54);
    expect(training.ownerChecks.length).toBe(6);
    expect(training.endpoint.passed).toBe(
      training.endpoint.barVsComparator.passed && training.endpoint.beatsTeamNetOnly.passed && training.endpoint.beatsLastSeasonNet.passed,
    );
    expect(training.endpoint.beatsTeamNetOnly.rmseTeamNetOnly).toBe(training.rmse.teamNetOnly);
    expect(training.endpoint.beatsLastSeasonNet.rmseLastSeasonNet).toBe(training.rmse.lastSeasonNet);
    // The frozen lines reproduce the fit's in-sample numbers, the new metrics included.
    for (const metric of METRICS) expect(training.rmse[metric]).toBeCloseTo(fit.trainingRmse[metric], 9);
    expect(training.rmseLeaveSeasonOut).not.toBeNull();
    for (const metric of METRICS) expect(Number.isFinite(training.rmseLeaveSeasonOut?.[metric])).toBe(true);
    expect(training.teams[0]).toHaveProperty("gameScoreFrame");
    expect(training.teams[0]).toHaveProperty("gameScorePlusTeamNet");

    const paths = {
      registration: path.join(directory, "registration.md"),
      fit: path.join(directory, "fit.json"),
      freeze: path.join(directory, "freeze.json"),
    };
    fs.writeFileSync(paths.registration, "# Registration (simulated)\n");
    writeJson(paths.fit, fit);
    const record = freeze({ ...paths, evaluation: path.join(directory, "evaluation.json") });
    asked.length = 0;
    const test = runEvaluation({ era: "test", loader, freezePaths: paths });
    expect(Math.max(...asked)).toBe(2026);
    expect(test.freeze).toEqual(record);
    expect(test.teamSeasons).toBe(36);
    expect(test.targetSeasons).toEqual([2021, 2022, 2023, 2024, 2025, 2026]);
    expect(Number.isFinite(test.endpoint.barVsComparator.ratio)).toBe(true);
    expect(test.rmseLeaveSeasonOut).toBeNull();
    expect(Number.isFinite(test.rmse.gameScoreFrame) && Number.isFinite(test.rmse.gameScorePlusTeamNet)).toBe(true);
    expect(test.bootstrap.season.low).toBeLessThanOrEqual(test.bootstrap.season.high);
    expect(test.gameLevel.score.games).toBe(6 * 60);
    console.log(
      `[pipeline sim] test RMSE score ${test.rmse.score.toFixed(2)}, comparator ${test.rmse.comparatorUnfloored.toFixed(2)}, ` +
        `ratio ${test.endpoint.barVsComparator.ratio.toFixed(3)}, pass ${test.endpoint.passed}; team-net-only ${test.rmse.teamNetOnly.toFixed(2)}, ` +
        `last-season ${test.rmse.lastSeasonNet.toFixed(2)}, zero ${test.rmse.allZero.toFixed(2)}; ` +
        `game MAE score ${test.gameLevel.score.meanAbsoluteError.toFixed(2)}, comparator ${test.gameLevel.comparatorUnfloored.meanAbsoluteError.toFixed(2)}`,
    );
  }, 300_000);
});
