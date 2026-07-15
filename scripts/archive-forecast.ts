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

function argumentValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const issuedAt = argumentValue("--issued-at") ?? dataLastUpdatedTimestamp;

const snapshot = buildForecastSnapshot(playoffConfig, defaultModelSettings);
const representativeSeries = playoffConfig.series[0];
if (!representativeSeries) throw new Error("Cannot archive a forecast without a configured series.");
const standardizedInput = productionPointInTimeInput(
  playoffConfig,
  representativeSeries,
  defaultModelSettings,
  issuedAt,
);
const archive = {
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
};
const directory = path.join(process.cwd(), "docs", "forecast-archive");
fs.mkdirSync(directory, { recursive: true });
const versionSlug = snapshot.metadata.modelVersion.replaceAll(/[^a-zA-Z0-9.-]/g, "-");
const issuedSlug = issuedAt.replaceAll(/[^a-zA-Z0-9.-]/g, "-");
fs.writeFileSync(
  path.join(directory, `${dataLastUpdated}-${issuedSlug}-${versionSlug}.json`),
  JSON.stringify(archive, null, 2),
  "utf-8",
);
console.log(`Archived ${snapshot.metadata.modelVersion} for ${dataLastUpdated}.`);
