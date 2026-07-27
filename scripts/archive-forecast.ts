import * as fs from "node:fs";
import * as path from "node:path";
import {
  dataLastUpdated,
  dataLastUpdatedTimestamp,
  playoffConfig,
} from "../src/lib/data/playoff-config";
import { defaultModelSettings } from "../src/lib/data/model-settings";
import { buildForecastSnapshot } from "../src/lib/model/forecast";
import { productionPointInTimeInput } from "../src/lib/model/point-in-time";
import {
  assertValidForecastIssuance,
  type ForecastIssuanceMetadata,
} from "../src/lib/model/forecast-issuance";
import type { LogisticModel } from "../src/lib/backtest/regression";
import { seriesProbabilityChallenger } from "../src/lib/backtest/prospective-challenger";

function argumentValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const prospective = process.argv.includes("--prospective");
const issuedAtArgument = argumentValue("--issued-at");
if (prospective && !issuedAtArgument) {
  throw new Error("Prospective issuance requires --issued-at <ISO timestamp>.");
}
const issuedAt = issuedAtArgument ?? dataLastUpdatedTimestamp;
const targetSeries = argumentValue("--target-series");
const targetGame = argumentValue("--target-game");
const targetStart = argumentValue("--target-start");
const issuance: ForecastIssuanceMetadata = prospective
  ? {
      type: "prospective_before_game",
      issuedAt,
      dataSnapshotAt: dataLastUpdatedTimestamp,
      target: {
        seriesId: targetSeries ?? "",
        gameId: targetGame ?? "",
        scheduledStart: targetStart ?? "",
      },
    }
  : {
      type: "retrospective_snapshot",
      issuedAt,
      dataSnapshotAt: dataLastUpdatedTimestamp,
    };
assertValidForecastIssuance(issuance);

const snapshot = buildForecastSnapshot(playoffConfig, defaultModelSettings);
const representativeSeries = playoffConfig.series[0];
if (!representativeSeries) throw new Error("Cannot archive a forecast without a configured series.");
const standardizedInput = productionPointInTimeInput(
  playoffConfig,
  representativeSeries,
  defaultModelSettings,
  issuedAt,
);
const registeredResearchForecasts = (() => {
  if (!prospective) return [];
  const series = playoffConfig.series.find((row) => row.id === targetSeries);
  if (!series) {
    throw new Error(`Prospective target series ${targetSeries} is not configured.`);
  }
  if (series.teamA === series.teamB || series.winsA >= 4 || series.winsB >= 4) {
    throw new Error("Prospective target series must be active with two distinct teams.");
  }
  const raw = snapshot.seriesForecasts.find(
    (forecast) => forecast.seriesId === series.id,
  );
  const teamA = playoffConfig.teams.find((team) => team.id === series.teamA);
  const teamB = playoffConfig.teams.find((team) => team.id === series.teamB);
  if (!raw || !teamA || !teamB) {
    throw new Error("Prospective challenger inputs are incomplete.");
  }
  const research = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), "docs", "backtest", "research.json"),
      "utf-8",
    ),
  ) as {
    primarySeriesChallenger: {
      registration: {
        id: string;
        frozenAt: string;
        firstPromotionEligibleSeason: number;
        formula: string;
      };
      finalModel: LogisticModel;
    };
  };
  const probability = seriesProbabilityChallenger(
    raw.teamASeriesWinProbability,
    teamB.seed - teamA.seed,
    research.primarySeriesChallenger.finalModel,
  );
  return [
    {
      candidateId: research.primarySeriesChallenger.registration.id,
      registration: research.primarySeriesChallenger.registration,
      seriesId: series.id,
      teamAId: series.teamA,
      teamBId: series.teamB,
      rawProductionProbabilityA: raw.teamASeriesWinProbability,
      candidateProbabilityA: probability,
      seedDifference: teamB.seed - teamA.seed,
      evaluationStatus: "sealed_before_outcome",
      caveat:
        "Research mapping is archived for prospective comparison only and does not replace the production estimate.",
    },
  ];
})();
const archive = {
  issuance,
  issuedAt,
  issuedForDataSnapshot: dataLastUpdatedTimestamp,
  model: snapshot.metadata,
  inputDefinition: {
    informationSet: standardizedInput.informationSet,
    provenance: standardizedInput.provenance,
  },
  settings: defaultModelSettings,
  inputSnapshot: {
    teams: playoffConfig.teams,
    series: playoffConfig.series,
    notes: playoffConfig.notes,
  },
  seriesForecasts: snapshot.seriesForecasts,
  bracketForecast: snapshot.bracketForecast,
  registeredResearchForecasts,
};
const directory = path.join(process.cwd(), "docs", "forecast-archive");
fs.mkdirSync(directory, { recursive: true });
const versionSlug = snapshot.metadata.modelVersion.replaceAll(/[^a-zA-Z0-9.-]/g, "-");
const issuedSlug = issuedAt.replaceAll(/[^a-zA-Z0-9.-]/g, "-");
const output = path.join(
  directory,
  `${dataLastUpdated}-${issuedSlug}-${versionSlug}.json`,
);
if (fs.existsSync(output)) {
  throw new Error(
    `Immutable forecast archive already exists: ${path.basename(output)}`,
  );
}
fs.writeFileSync(output, JSON.stringify(archive, null, 2), "utf-8");
console.log(
  `Archived ${snapshot.metadata.modelVersion} for ${dataLastUpdated} as ${issuance.type}.`,
);
