// The v3 invariants of plan step A5, one test each. The same checks run in verify:live.

import { describe, it } from "vitest";
import { V3_CHECKS } from "../scripts/verify/v3-invariants";

describe("v3 absence engine invariants", () => {
  for (const [name, check] of Object.entries(V3_CHECKS)) {
    it(name, () => check(), 120_000);
  }
});
