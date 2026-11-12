// Freezes the Stage 2 test: writes docs/score/freeze-stage2.json with the SHA-256 of
// docs/score/registration-stage2.md and of docs/score/fit-stage2.json, and the time. After
// this, evaluate-stage2.ts --era test runs only while both files still match (and Stage
// 1's own freeze still holds).
//
// Refuses while the registration is still a draft or has unfilled values, and refuses to
// freeze again once a Stage 2 test-era evaluation exists.
//
// Run: corepack pnpm exec tsx scripts/score/freeze-stage2.ts

import * as fs from "node:fs";
import { sha256File, writeJson, type FreezeRecord } from "./score-data";
import { EVALUATION_STAGE2_PATH, FIT_STAGE2_PATH, FREEZE_STAGE2_PATH, REGISTRATION_STAGE2_PATH } from "./stage2-data";

export type Stage2FreezeOptions = {
  registration?: string;
  fit?: string;
  freeze?: string;
  evaluation?: string;
  now?: () => Date;
};

export function freezeStage2(options: Stage2FreezeOptions = {}): FreezeRecord {
  const registration = options.registration ?? REGISTRATION_STAGE2_PATH;
  const fit = options.fit ?? FIT_STAGE2_PATH;
  const target = options.freeze ?? FREEZE_STAGE2_PATH;
  const evaluation = options.evaluation ?? EVALUATION_STAGE2_PATH;
  if (fs.existsSync(evaluation)) {
    throw new Error(`${evaluation} exists: the Stage 2 test has run, and its registration can no longer be re-frozen.`);
  }
  for (const file of [registration, fit]) if (!fs.existsSync(file)) throw new Error(`${file} is missing.`);
  const text = fs.readFileSync(registration, "utf-8");
  if (/\bTO BE FILLED\b/.test(text)) {
    throw new Error(`${registration} still has unfilled "TO BE FILLED" values.`);
  }
  if (/\*\*Status: draft/i.test(text)) {
    throw new Error(`${registration} is still a draft: the lead finalises its status before the freeze.`);
  }
  const record: FreezeRecord = {
    registrationSha256: sha256File(registration),
    fitSha256: sha256File(fit),
    frozenAt: (options.now ?? (() => new Date()))().toISOString(),
  };
  writeJson(target, record);
  return record;
}

if (process.argv[1]?.endsWith("freeze-stage2.ts")) {
  try {
    const record = freezeStage2();
    console.log(`[freeze-stage2] registration ${record.registrationSha256}`);
    console.log(`[freeze-stage2] fit          ${record.fitSha256}`);
    console.log(`[freeze-stage2] wrote ${FREEZE_STAGE2_PATH} at ${record.frozenAt}`);
  } catch (error) {
    console.error(`[freeze-stage2] FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
