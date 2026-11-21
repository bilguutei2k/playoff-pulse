// A child process of fit-ratings.ts: evaluates rating parameter sets on the open seasons.

import type { StatusWeights, V4RatingParams } from "../../../src/lib/season/roster-state";
import { openData, seasonScores } from "./engine-run";

type Job = { id: number; ratings: V4RatingParams; lastSeason: number; status: Record<string, StatusWeights> };
const fallback: StatusWeights = { O: 1, D: 1, Q: 1, P: 1, A: 1 };

openData();
process.on("message", (job: Job) => {
  const scores = seasonScores({
    lastSeason: job.lastSeason,
    ratings: job.ratings,
    statusFor: (season) => job.status[String(season)] ?? fallback,
    reportSeasons: Object.keys(job.status).map(Number),
  });
  process.send?.({ id: job.id, scores });
});
process.send?.({ ready: true });
