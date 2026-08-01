import * as fs from "node:fs";
import * as path from "node:path";

import type {
  BacktestPrediction,
  HistoricalRound,
  HistoricalSeries,
} from "./types";
import { loadSeries } from "./build-snapshots";
import type { ExternalSeriesBenchmark } from "../../src/lib/backtest/input-observations";

const SOURCE_COMMIT = "f6d5b2e1d6da2889345d381c41431f9a4ee208dd";
const SOURCE_URL =
  `https://raw.githubusercontent.com/fivethirtyeight/checking-our-work-data/${SOURCE_COMMIT}/nba_playoffs.csv`;
const OUTPUT_DATA = path.join(
  process.cwd(),
  "data",
  "historical",
  "external-series-benchmarks.json",
);
const OUTPUT_REPORT = path.join(
  process.cwd(),
  "docs",
  "backtest",
  "external-benchmark-538.json",
);
const PREDICTIONS_PATH = path.join(
  process.cwd(),
  "docs",
  "backtest",
  "predictions.json",
);

const TEAM_CODE_BY_538_NAME: Record<string, string> = {
  "76ers": "PHI",
  Bucks: "MIL",
  Bulls: "CHI",
  Cavaliers: "CLE",
  Celtics: "BOS",
  Clippers: "LAC",
  Grizzlies: "MEM",
  Hawks: "ATL",
  Heat: "MIA",
  Hornets: "CHO",
  Jazz: "UTA",
  Kings: "SAC",
  Knicks: "NYK",
  Lakers: "LAL",
  Magic: "ORL",
  Mavericks: "DAL",
  Nets: "BRK",
  Nuggets: "DEN",
  Pacers: "IND",
  Pelicans: "NOP",
  Pistons: "DET",
  Raptors: "TOR",
  Rockets: "HOU",
  Spurs: "SAS",
  Suns: "PHO",
  Thunder: "OKC",
  Timberwolves: "MIN",
  "Trail Blazers": "POR",
  Warriors: "GSW",
  Wizards: "WAS",
};

type ForecastField =
  | "make_conf_semis"
  | "make_conf_finals"
  | "make_finals"
  | "win_finals";

type SourceRow = {
  season: number;
  forecastDate: string;
  teamId: string;
  probabilities: Record<ForecastField, number | null>;
};

type MatchedBenchmark = ExternalSeriesBenchmark & {
  round: HistoricalRound;
  field: ForecastField;
  modelEra: "CARM_ELO_CARMELO" | "RAPTOR";
  rawTeamAAdvancementProbability: number;
  rawTeamBAdvancementProbability: number;
  actualOutcome: 0 | 1;
  playoffPulseProbability: number;
};

function fieldForRound(round: HistoricalRound): ForecastField {
  switch (round) {
    case "First Round":
      return "make_conf_semis";
    case "Conference Semifinal":
      return "make_conf_finals";
    case "Conference Final":
      return "make_finals";
    case "NBA Finals":
      return "win_finals";
  }
}

function parseProbability(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parse538PlayoffCsv(csv: string): SourceRow[] {
  const [headerLine, ...lines] = csv.trim().split(/\r?\n/);
  const header = headerLine.split(",");
  const required = [
    "season",
    "forecast_date",
    "team",
    "make_conf_semis",
    "make_conf_finals",
    "make_finals",
    "win_finals",
  ] as const;
  const indices = Object.fromEntries(
    required.map((column) => {
      const index = header.indexOf(column);
      if (index < 0) throw new Error(`FiveThirtyEight source is missing ${column}.`);
      return [column, index];
    }),
  ) as Record<(typeof required)[number], number>;

  return lines.map((line, lineIndex) => {
    const cells = line.split(",");
    if (cells.length !== header.length) {
      throw new Error(
        `FiveThirtyEight CSV row ${lineIndex + 2} has ${cells.length} columns; expected ${header.length}.`,
      );
    }
    const teamName = cells[indices.team];
    const teamId = TEAM_CODE_BY_538_NAME[teamName];
    if (!teamId) throw new Error(`Unmapped FiveThirtyEight team name: ${teamName}.`);
    return {
      season: Number(cells[indices.season]),
      forecastDate: cells[indices.forecast_date],
      teamId,
      probabilities: {
        make_conf_semis: parseProbability(cells[indices.make_conf_semis]),
        make_conf_finals: parseProbability(cells[indices.make_conf_finals]),
        make_finals: parseProbability(cells[indices.make_finals]),
        win_finals: parseProbability(cells[indices.win_finals]),
      },
    };
  });
}

function boundProbability(probability: number, label: string): number {
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) {
    throw new Error(`${label} must be strictly inside (0, 1); got ${probability}.`);
  }
  return probability;
}

function logLoss(probability: number, outcome: number): number {
  return -(outcome * Math.log(probability) + (1 - outcome) * Math.log(1 - probability));
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function seasonClusteredBootstrap(rows: MatchedBenchmark[], iterations = 10000) {
  const seasons = [...new Set(rows.map((row) => row.season))].sort();
  const bySeason = new Map(
    seasons.map((season) => [season, rows.filter((row) => row.season === season)]),
  );
  const random = createRandom(0x5382022);
  const differences: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sampled = Array.from({ length: seasons.length }, () => {
      const season = seasons[Math.floor(random() * seasons.length)];
      return bySeason.get(season) ?? [];
    }).flat();
    differences.push(
      mean(
        sampled.map(
          (row) =>
            (row.playoffPulseProbability - row.actualOutcome) ** 2 -
            (row.teamAWinProbability - row.actualOutcome) ** 2,
        ),
      ),
    );
  }
  differences.sort((a, b) => a - b);
  return {
    iterations,
    direction: "playoffPulseMinusFiveThirtyEightBrier",
    pointEstimate: mean(
      rows.map(
        (row) =>
          (row.playoffPulseProbability - row.actualOutcome) ** 2 -
          (row.teamAWinProbability - row.actualOutcome) ** 2,
      ),
    ),
    ci95: [differences[249], differences[9749]],
  };
}

function selectBenchmark(
  series: HistoricalSeries,
  sourceRows: SourceRow[],
  playoffPulseProbability: number,
): MatchedBenchmark | null {
  const field = fieldForRound(series.round);
  const rowsByDate = new Map<string, Map<string, SourceRow>>();
  for (const row of sourceRows) {
    if (row.season !== series.season || row.forecastDate >= series.seriesStartDate) continue;
    const byTeam = rowsByDate.get(row.forecastDate) ?? new Map<string, SourceRow>();
    byTeam.set(row.teamId, row);
    rowsByDate.set(row.forecastDate, byTeam);
  }
  const qualifying = [...rowsByDate.entries()]
    .filter(([, byTeam]) => {
      const qA = byTeam.get(series.teamA)?.probabilities[field];
      const qB = byTeam.get(series.teamB)?.probabilities[field];
      return qA !== null && qA !== undefined && qA > 0 && qB !== null && qB !== undefined && qB > 0;
    })
    .sort(([dateA], [dateB]) => dateB.localeCompare(dateA));
  const selected = qualifying[0];
  if (!selected) return null;
  const [forecastDate, byTeam] = selected;
  const qA = byTeam.get(series.teamA)!.probabilities[field]!;
  const qB = byTeam.get(series.teamB)!.probabilities[field]!;
  const teamAWinProbability = boundProbability(
    qA / (qA + qB),
    `${series.id} normalized FiveThirtyEight probability`,
  );
  const modelEra = series.season <= 2019 ? "CARM_ELO_CARMELO" : "RAPTOR";
  return {
    season: series.season,
    seriesId: series.id,
    observedAt: `${forecastDate}T00:00:00Z`,
    sourceUrl: SOURCE_URL,
    sourceLabel: `FiveThirtyEight ${modelEra} next-round pair normalization`,
    method: "public_probability",
    teamAWinProbability,
    round: series.round,
    field,
    modelEra,
    rawTeamAAdvancementProbability: qA,
    rawTeamBAdvancementProbability: qB,
    actualOutcome: series.winner === series.teamA ? 1 : 0,
    playoffPulseProbability,
  };
}

async function build538Benchmark(): Promise<void> {
  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`FiveThirtyEight fetch failed: ${response.status} ${response.statusText}.`);
  }
  const sourceRows = parse538PlayoffCsv(await response.text());
  const predictions = JSON.parse(
    fs.readFileSync(PREDICTIONS_PATH, "utf8"),
  ) as BacktestPrediction[];
  const productionBySeries = new Map(
    predictions
      .filter((row) => row.modelName === "playoff_pulse")
      .map((row) => [row.seriesId, row.predictedProbabilityA]),
  );
  const eligibleSeries = Array.from({ length: 7 }, (_, index) => 2016 + index)
    .flatMap((season) => loadSeries(season));
  const matched = eligibleSeries.flatMap((series) => {
    const production = productionBySeries.get(series.id);
    if (production === undefined) throw new Error(`Missing Playoff Pulse prediction for ${series.id}.`);
    const row = selectBenchmark(series, sourceRows, production);
    return row ? [row] : [];
  });
  const observations: ExternalSeriesBenchmark[] = matched.map((row) => ({
    season: row.season,
    seriesId: row.seriesId,
    observedAt: row.observedAt,
    sourceUrl: row.sourceUrl,
    sourceLabel: row.sourceLabel,
    method: row.method,
    teamAWinProbability: row.teamAWinProbability,
  }));
  const metric = (probability: (row: MatchedBenchmark) => number) => ({
    n: matched.length,
    brier: mean(matched.map((row) => (probability(row) - row.actualOutcome) ** 2)),
    logLoss: mean(matched.map((row) => logLoss(probability(row), row.actualOutcome))),
  });
  const report = {
    generatedAt: new Date().toISOString(),
    source: {
      url: SOURCE_URL,
      commit: SOURCE_COMMIT,
      rows: sourceRows.length,
      seasons: [Math.min(...sourceRows.map((row) => row.season)), Math.max(...sourceRows.map((row) => row.season))],
      modelEras: {
        CARM_ELO_CARMELO: [2016, 2019],
        RAPTOR: [2020, 2022],
      },
      shutdown: "FiveThirtyEight sports forecasts stopped updating June 13, 2023; this pinned file ends in 2022.",
    },
    mappingRule: "docs/backtest/external-benchmark-mapping.md",
    coverage: {
      eligibleSeasons: [2016, 2022],
      eligibleSeries: eligibleSeries.length,
      matchedSeries: matched.length,
      missingSeries: eligibleSeries.length - matched.length,
      coverage: matched.length / eligibleSeries.length,
      bySeason: Object.fromEntries(
        Array.from({ length: 7 }, (_, index) => 2016 + index).map((season) => [
          season,
          {
            eligible: eligibleSeries.filter((row) => row.season === season).length,
            matched: matched.filter((row) => row.season === season).length,
          },
        ]),
      ),
      byModelEra: {
        CARM_ELO_CARMELO: matched.filter((row) => row.modelEra === "CARM_ELO_CARMELO").length,
        RAPTOR: matched.filter((row) => row.modelEra === "RAPTOR").length,
      },
    },
    metrics: {
      playoffPulse: metric((row) => row.playoffPulseProbability),
      fiveThirtyEight: metric((row) => row.teamAWinProbability),
    },
    pairedSeasonClusteredBootstrap: seasonClusteredBootstrap(matched),
    interpretation: {
      benchmarkType: "external_model_not_market",
      noVigMarketContractSatisfied: false,
      modelGenerationLimitation: "The pooled comparison crosses CARM-Elo/CARMELO and RAPTOR eras.",
    },
    matched,
  };
  fs.writeFileSync(OUTPUT_DATA, JSON.stringify(observations, null, 2), "utf8");
  fs.writeFileSync(OUTPUT_REPORT, JSON.stringify(report, null, 2), "utf8");
  console.log(
    `Mapped ${matched.length}/${eligibleSeries.length} series; ` +
      `Playoff Pulse Brier ${report.metrics.playoffPulse.brier.toFixed(6)}, ` +
      `FiveThirtyEight ${report.metrics.fiveThirtyEight.brier.toFixed(6)}.`,
  );
}

if (typeof require !== "undefined" && require.main === module) {
  build538Benchmark().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
