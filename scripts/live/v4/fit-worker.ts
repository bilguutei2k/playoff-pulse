// A child process of fit-ratings.ts: evaluates rating parameter sets on the open seasons.
// It resumes from an exact checkpoint of the same parameters and status tables when one
// exists (CHECKPOINT_DIRECTORY, outside the repository), and saves the end state of each
// evaluation and of 2020-21, so a later origin replays only its new seasons.

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { RosterState, StatusWeights, V4RatingParams } from "../../../src/lib/season/roster-state";
import { deserializeRosterState, openData, seasonScores, serializeRosterState } from "./engine-run";

type Scores = Record<number, { n: number; logLoss: number; brier: number }>;
type Job = { id: number; ratings: V4RatingParams; lastSeason: number; status: Record<string, StatusWeights> };
const fallback: StatusWeights = { O: 1, D: 1, Q: 1, P: 1, A: 1 };
const directory = process.env.V4_CHECKPOINT_DIRECTORY ?? "";
if (!directory || path.resolve(directory).startsWith(process.cwd())) throw new Error("V4_CHECKPOINT_DIRECTORY must be outside the repository.");
fs.mkdirSync(directory, { recursive: true });

const keyFor = (job: Job, season: number) => {
  const status = Object.fromEntries(Object.entries(job.status).filter(([key]) => Number(key) <= season));
  return createHash("sha256").update(JSON.stringify([job.ratings, season, status])).digest("hex").slice(0, 32);
};
const fileFor = (job: Job, season: number) => path.join(directory, `${keyFor(job, season)}.bin`);
const scoresFor = (job: Job, season: number) => path.join(directory, `${keyFor(job, season)}.json`);

openData();
process.on("message", (job: Job) => {
  let resume: number | null = null;
  for (let season = job.lastSeason - 1; season >= 2011; season -= 1) {
    if (fs.existsSync(fileFor(job, season)) && fs.existsSync(scoresFor(job, season))) {
      resume = season;
      break;
    }
  }
  const scores: Scores = resume === null ? {} : JSON.parse(fs.readFileSync(scoresFor(job, resume), "utf-8"));
  let state: RosterState | undefined = resume === null ? undefined : deserializeRosterState(fs.readFileSync(fileFor(job, resume)));
  const targets = [...((resume ?? 0) < 2021 && job.lastSeason > 2021 ? [2021] : []), job.lastSeason];
  for (const target of targets) {
    const part = seasonScores(
      {
        lastSeason: target,
        ratings: job.ratings,
        statusFor: (season: number) => job.status[String(season)] ?? fallback,
        reportSeasons: Object.keys(job.status).map(Number),
        state,
      },
      (snapshot) => {
        state = snapshot;
      },
    );
    Object.assign(scores, part);
    fs.writeFileSync(fileFor(job, target), serializeRosterState(state as RosterState));
    fs.writeFileSync(scoresFor(job, target), JSON.stringify(scores));
  }
  process.send?.({ id: job.id, scores });
});
process.send?.({ ready: true });
