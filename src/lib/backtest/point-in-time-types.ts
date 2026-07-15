import type {
  ForecastDriver,
  ProbabilityInterval,
} from "@/lib/model/types";
import type { InputProvenance } from "@/lib/model/point-in-time";

export type HistoricalPregameForecast = {
  id: string;
  seriesId: string;
  season: number;
  round: string;
  conference: string;
  gameNumber: number;
  forecastAsOf: string;
  snapshotAsOf: string;
  lastIncludedGameNumber: number;
  teamA: string;
  teamB: string;
  winsA: number;
  winsB: number;
  homeTeam: string;
  teamAGameWinProbability: number;
  teamASeriesWinProbability: number;
  expectedMarginForTeamA: number;
  uncertainty: ProbabilityInterval;
  finalScoreProbabilities: Record<string, number>;
  drivers: ForecastDriver[];
  actualGameWinner: string;
  actualSeriesWinner: string;
  provenance: InputProvenance;
  modelVersion: string;
};

export type HistoricalPregameArchive = {
  generatedAt: string;
  modelVersion: string;
  researchProtocolVersion: string;
  seasons: number[];
  records: HistoricalPregameForecast[];
};

export type PregameLeakageViolation = {
  id: string;
  issue: string;
};

export function findPregameLeakageViolations(
  archive: HistoricalPregameArchive,
): PregameLeakageViolation[] {
  return archive.records.flatMap((record) => {
    const issues: PregameLeakageViolation[] = [];
    if (record.lastIncludedGameNumber !== record.gameNumber - 1) {
      issues.push({
        id: record.id,
        issue: `Game ${record.gameNumber} included results through game ${record.lastIncludedGameNumber}.`,
      });
    }
    if (record.winsA + record.winsB !== record.lastIncludedGameNumber) {
      issues.push({
        id: record.id,
        issue: "Series score does not match the number of previously included games.",
      });
    }
    if (record.snapshotAsOf >= record.forecastAsOf) {
      issues.push({
        id: record.id,
        issue: `Input snapshot ${record.snapshotAsOf} is not before forecast date ${record.forecastAsOf}.`,
      });
    }
    return issues;
  });
}

export function assertPregameArchiveHasNoLeakage(
  archive: HistoricalPregameArchive,
): void {
  const violations = findPregameLeakageViolations(archive);
  if (violations.length) {
    throw new Error(
      `Pregame archive leakage detected:\n${violations
        .map((violation) => `${violation.id}: ${violation.issue}`)
        .join("\n")}`,
    );
  }
}
