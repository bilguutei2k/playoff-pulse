// Golden: the simulator's output for fixed inputs, without absences and with v2's
// `absences`, pinned by hash. Written before the v3 schedule touched simulate.ts; these
// hashes must never change. If one does, the v2 path (or the no-absence path) changed.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { simulateSeason } from "@/lib/season/simulate";
import { TEAM_COUNT } from "@/lib/season/teams";
import {
  fixtureGames,
  fixtureInput,
  fixturePostseasonInput,
  fixtureV2Absences,
  fixtureV2PostseasonAbsences,
} from "./support/simulation-fixture";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

describe("simulator golden (v2 path frozen)", () => {
  it("builds the fixture as described: 72 final and 8 scheduled games a team", () => {
    const final = new Map<string, number>();
    const scheduled = new Map<string, number>();
    const games = fixtureGames();
    expect(new Set(games.map((game) => game.id)).size).toBe(games.length);
    for (const game of games) {
      const target = game.status === "final" ? final : scheduled;
      for (const id of [game.homeId, game.awayId]) target.set(id, (target.get(id) ?? 0) + 1);
    }
    expect(final.size).toBe(TEAM_COUNT);
    expect([...final.values()].every((count) => count === 72)).toBe(true);
    expect([...scheduled.values()].every((count) => count === 8)).toBe(true);
  });

  it("regular season without absences", () => {
    expect(hash(simulateSeason(fixtureInput()))).toBe("4a5476fcdc90a5cc80453ca733d621d411edd0ce001ddd9da51c3645904078e9");
  });

  it("regular season with v2 absences", () => {
    expect(hash(simulateSeason({ ...fixtureInput(), absences: fixtureV2Absences() }))).toBe("f7824ac3437c0c251fe01e92eb6d9ca78ad1591a17a87edaa2d85925d29d3c55");
  });

  it("playoffs without absences", () => {
    expect(hash(simulateSeason(fixturePostseasonInput()))).toBe("b1c38d8865b513e9c7479a0075f8d594a1882fb102d9f845b51b701d9e5d4dbb");
  });

  it("playoffs with v2 absences", () => {
    expect(
      hash(simulateSeason({ ...fixturePostseasonInput(), absences: fixtureV2PostseasonAbsences() })),
    ).toBe("b77bdf2d558827b6512028eca56dd29b5b27f84bbb93faa40640a93fb36a9bcd");
  });
});
