// Writes data/season/v4/warm-2026.bin.gz: the v4 filter state after every stored game
// through 2025-26 (warm-state.ts, frozen parameters), so the live job replays only the live
// season. It is a state and nothing else: no forecast, error or score is computed, printed or
// stored. It prints the file's sha256, which params-v4.ts pins (V4_WARM_SHA256).
//
// Run: corepack pnpm exec tsx scripts/live/v4/build-warm-checkpoint.ts

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { V4_FROZEN } from "../../../src/lib/season/params-v4";
import { serializeRosterState } from "./engine-run";
import { warmStateThrough } from "./warm-state";

export const WARM_CHECKPOINT = "data/season/v4/warm-2026.bin.gz";
const state = warmStateThrough({ lastStoredSeason: 2026, throughEtDate: "2026-08-01", ratings: V4_FROZEN.ratings, statusTable: V4_FROZEN.statusTable });
const body = zlib.gzipSync(serializeRosterState(state), { level: 9 });
const target = path.join(process.cwd(), WARM_CHECKPOINT);
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, body);
console.log(createHash("sha256").update(body).digest("hex"));
