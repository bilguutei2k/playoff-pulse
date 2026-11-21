// Which number a player's impact on /injuries and player pages comes from (registration-v4.md,
// W5). Today the published model is v2, so it is Game Score (`IMPACT_LABEL`); v4's own points
// are shown only once v4 is the published model. Pure.

import { V4_MODEL_VERSION } from "@/lib/season/params-v4";

export type ImpactSource = "game-score" | "v4";

/** "v4" only when the published model version is v4, else "game-score". */
export function impactSource(publishedModelVersion: string): ImpactSource {
  return publishedModelVersion === V4_MODEL_VERSION ? "v4" : "game-score";
}
