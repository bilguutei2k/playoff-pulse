// Writes data/season/v5/warm-2026.bin.gz: the v5 filter state after every stored game through
// 2025-26 (warm-state-v5.ts: v4's frozen parameters, observation 3 on with s3 = 25 throughout),
// so the live job replays only the live season. It is a state and nothing else: no forecast,
// error or score is computed, printed or stored. It prints the file's sha256, which
// src/lib/season/params-v5-live.ts pins (V5_WARM_SHA256).
//
// Run: corepack pnpm exec tsx scripts/live/v5-shadow/build-warm-checkpoint.ts

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { serializeRosterState } from "../v4/engine-run";
import { V5_WARM_CHECKPOINT } from "./checkpoint";
import { warmStateV5Through } from "./warm-state-v5";

const state = warmStateV5Through({ lastStoredSeason: 2026, throughEtDate: "2026-08-01" });
const body = zlib.gzipSync(serializeRosterState(state), { level: 9 });
const target = path.join(process.cwd(), V5_WARM_CHECKPOINT);
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, body);
console.log(createHash("sha256").update(body).digest("hex"));
