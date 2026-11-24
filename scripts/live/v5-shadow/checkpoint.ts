// Where v5's warm checkpoint lives, and its loader (the live job reads the state, nothing else).

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { V5_WARM_SHA256 } from "../../../src/lib/season/params-v5-live";
import type { RosterState } from "../../../src/lib/season/roster-state-v5";
import { deserializeRosterState } from "../v4/engine-run";

export const V5_WARM_CHECKPOINT = "data/season/v5/warm-2026.bin.gz";

export function loadWarmStateV5(root = process.cwd()): RosterState {
  const body = fs.readFileSync(path.join(root, V5_WARM_CHECKPOINT));
  if (createHash("sha256").update(body).digest("hex") !== V5_WARM_SHA256) {
    throw new Error("v5 warm checkpoint does not match V5_WARM_SHA256.");
  }
  return deserializeRosterState(zlib.gunzipSync(body));
}
