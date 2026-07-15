import type { ModelSettings, PlayoffConfig, Series, Team } from "@/lib/model/types";
import { MODEL_VERSION, RESEARCH_PROTOCOL_VERSION } from "@/lib/model/version";

export type ImpactScale = "manual_point_estimate" | "bpm_proxy";
export type RatingScale = "manual_rating_ensemble" | "srs_point_proxy";
export type InformationSet = "production_manual_snapshot" | "historical_pregame" | "preserved_demo";

export type InputProvenance = {
  impactScale: ImpactScale;
  ratingScale: RatingScale;
  rotationSource: "manual_projected_minutes" | "normalized_regular_season_mpg";
  availabilitySource: "manual_status" | "unknown_assumed_available";
};

export type PointInTimeForecastInput = {
  id: string;
  asOf: string;
  informationSet: InformationSet;
  modelVersion: string;
  researchProtocolVersion: string;
  provenance: InputProvenance;
  teams: Team[];
  series: Series;
  settings: ModelSettings;
};

export function productionPointInTimeInput(
  config: PlayoffConfig,
  series: Series,
  settings: ModelSettings,
  asOf: string,
  informationSet: InformationSet = "production_manual_snapshot",
  teams = config.teams,
): PointInTimeForecastInput {
  return {
    id: `${informationSet}:${series.id}:${asOf}`,
    asOf,
    informationSet,
    modelVersion: MODEL_VERSION,
    researchProtocolVersion: RESEARCH_PROTOCOL_VERSION,
    provenance: {
      impactScale: "manual_point_estimate",
      ratingScale: "manual_rating_ensemble",
      rotationSource: "manual_projected_minutes",
      availabilitySource: "manual_status",
    },
    teams,
    series,
    settings,
  };
}

export function assertCompatibleImpactScales(
  left: InputProvenance,
  right: InputProvenance,
): void {
  if (left.impactScale !== right.impactScale) {
    throw new Error(
      `Incompatible impact scales: ${left.impactScale} vs ${right.impactScale}.`,
    );
  }
}
