// Reads the published state whatever schema it was written in. Schema 1 came from v1,
// before the injury model; it can still be on disk for the few minutes between a deploy
// of this code and the job's first v2 run, so readers upgrade it instead of failing.

import type { LiveState, RecordSummary, SealRow } from "@/lib/season/types";

type SchemaOneState = Omit<
  LiveState,
  | "schemaVersion"
  | "referenceModelVersion"
  | "injury"
  | "availability"
  | "absences"
  | "absencePoints"
  | "currentRatings"
  | "seals"
  | "records"
  | "record"
> & {
  schemaVersion: 1;
  seals: Record<string, SealRow>;
  record: Omit<RecordSummary, "noFinalSeal" | "morningBrier" | "referenceBrier" | "referenceModelVersion">;
};

/**
 * A schema-1 state in the schema-2 shape. It says plainly what it is: the model is
 * v1, there is no injury model, and availability is marked missing.
 */
export function upgradeLiveState(raw: unknown): LiveState {
  const state = raw as LiveState | SchemaOneState;
  if (state.schemaVersion === 2) return state;
  if (state.schemaVersion !== 1) {
    throw new Error(`Unknown live state schema ${String((state as { schemaVersion?: unknown }).schemaVersion)}.`);
  }
  const record: RecordSummary = {
    ...state.record,
    noFinalSeal: null,
    morningBrier: null,
    referenceBrier: null,
    referenceModelVersion: null,
  };
  return {
    ...state,
    schemaVersion: 2,
    referenceModelVersion: state.modelVersion,
    injury: null,
    availability: { reportAt: null, stale: false, missing: true },
    absences: [],
    absencePoints: {},
    currentRatings: Object.fromEntries(
      state.forecast.teams.map((team) => [team.teamId, team.rating]),
    ),
    seals: Object.fromEntries(
      Object.entries(state.seals).map(([gameId, seal]) => [gameId, [seal]]),
    ),
    record,
    records: { [state.modelVersion]: record },
  };
}
