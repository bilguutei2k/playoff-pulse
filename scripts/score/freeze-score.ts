// Freezes the Stage 1 test: writes docs/score/freeze.json with the SHA-256 of
// docs/score/registration.md and of docs/score/fit.json, and the time. After this,
// evaluate-score.ts --era test runs only while both files still match.
//
// Refuses to freeze again once a test-era evaluation exists, so the registration cannot
// be changed after the test seasons are read.
//
// Run: corepack pnpm exec tsx scripts/score/freeze-score.ts

import * as fs from "node:fs";
import {
  EVALUATION_PATH,
  FIT_PATH,
  FREEZE_PATH,
  REGISTRATION_PATH,
  sha256File,
  writeJson,
  type FreezeRecord,
} from "./score-data";

export type FreezeOptions = {
  registration?: string;
  fit?: string;
  freeze?: string;
  evaluation?: string;
  now?: () => Date;
};

export function freeze(options: FreezeOptions = {}): FreezeRecord {
  const registration = options.registration ?? REGISTRATION_PATH;
  const fit = options.fit ?? FIT_PATH;
  const target = options.freeze ?? FREEZE_PATH;
  const evaluation = options.evaluation ?? EVALUATION_PATH;
  if (fs.existsSync(evaluation)) {
    throw new Error(`${evaluation} exists: the test has run, and the registration can no longer be re-frozen.`);
  }
  for (const file of [registration, fit]) if (!fs.existsSync(file)) throw new Error(`${file} is missing.`);
  const text = fs.readFileSync(registration, "utf-8");
  if (/\bTO BE FILLED\b/.test(text)) {
    throw new Error(`${registration} still has unfilled "TO BE FILLED" values; complete the Frozen values section first.`);
  }
  const record: FreezeRecord = {
    registrationSha256: sha256File(registration),
    fitSha256: sha256File(fit),
    frozenAt: (options.now ?? (() => new Date()))().toISOString(),
  };
  writeJson(target, record);
  return record;
}

if (process.argv[1]?.endsWith("freeze-score.ts")) {
  try {
    const record = freeze();
    console.log(`[freeze] registration ${record.registrationSha256}`);
    console.log(`[freeze] fit          ${record.fitSha256}`);
    console.log(`[freeze] wrote ${FREEZE_PATH} at ${record.frozenAt}`);
  } catch (error) {
    console.error(`[freeze] FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
