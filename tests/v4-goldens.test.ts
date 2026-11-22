// Goldens written before any v4 code touched simulate.ts (v4 plan, step 2): the simulator
// with v3's `absenceSchedule`, and a v2 seal row, for fixed inputs, pinned by hash. With
// tests/season-simulator-golden.test.ts (no absences, v2 `absences`) these must never
// change. If one does, a v1, v2 or v3 path changed.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { StoredLine } from "@/lib/season/box-scores";
import { etDateOf } from "@/lib/season/dates";
import type { ReportPoint } from "@/lib/season/injury-model";
import { sealInjuryGames, type InjuryModel, type InjurySealContext } from "@/lib/season/live-injury";
import { sealGames } from "@/lib/season/live-state";
import {
  INJURY_PARAMS,
  INJURY_STATUS_TABLE,
  INJURY_SURVIVAL,
  LIVE_MODEL_VERSION,
  LIVE_PARAMS,
  REFERENCE_MODEL_VERSION,
} from "@/lib/season/params";
import { simulateSeason, type AbsenceSchedule } from "@/lib/season/simulate";
import { SEASON_TEAMS } from "@/lib/season/teams";
import type { SeasonGame } from "@/lib/season/types";
import { fixtureInput, fixturePostseasonInput } from "../scripts/verify/simulation-fixture";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const [A, B, C, D] = SEASON_TEAMS.map((team) => team.id);

function schedule(): AbsenceSchedule {
  const curve = (start: number, decay: number) => Array.from({ length: 120 }, (_, index) => start * decay ** index);
  return {
    postseasonSchedule: true,
    players: [
      { teamId: A, athleteId: "a1", points: 3.2, survival: curve(0.999, 0.9), sampled: true },
      { teamId: A, athleteId: "a2", points: 1.1, survival: curve(0.48, 0.5), sampled: true },
      { teamId: B, athleteId: "b1", points: 4.5, survival: curve(0.999, 0.995), sampled: true },
      { teamId: C, athleteId: "c1", points: 2.0, survival: curve(0.9, 0.7), sampled: false },
    ],
  };
}

describe("v4 goldens: simulator with v3's schedule", () => {
  it("regular season", () => {
    expect(hash(simulateSeason({ ...fixtureInput(), absenceSchedule: schedule() }))).toBe(
      "7a71a66dd92c302ab8b183bc28c3d3c5cdf94ef61b601ba9eeaa536ef0b9361f",
    );
  });
  it("playoffs", () => {
    expect(hash(simulateSeason({ ...fixturePostseasonInput(), absenceSchedule: schedule() }))).toBe(
      "311178a8caadc6f9b11eb462aeb01b98beea3a3d64888aa6c4425a3ad22578ff",
    );
  });
});

function game(overrides: Partial<SeasonGame> & { id: string; tipUtc: string }): SeasonGame {
  return {
    season: 2027,
    kind: "regular",
    etDate: etDateOf(overrides.tipUtc),
    homeId: A,
    awayId: B,
    neutral: false,
    status: "scheduled",
    homeScore: null,
    awayScore: null,
    ...overrides,
  };
}

function sealContext(): InjurySealContext {
  const games: SeasonGame[] = [];
  const box = new Map<string, Record<string, StoredLine[]>>();
  for (let day = 0; day < 20; day += 1) {
    const tipUtc = new Date(Date.UTC(2026, 9, 21 + day, 23, 30)).toISOString();
    games.push(game({ id: `ab-${day}`, tipUtc, status: "final", homeScore: 105 + (day % 3), awayScore: 100 }));
    box.set(`ab-${day}`, {
      [A]: day < 15 ? [["a-star", 36, 26], ["a-wing", 30, 12]] : [["a-wing", 34, 13], ["a-sub", 20, 5]],
      [B]: [["b-star", 35, 22], ["b-wing", 30, 11]],
    });
    games.push(game({ id: `cd-${day}`, tipUtc, homeId: C, awayId: D, status: "final", homeScore: 99, awayScore: 101 }));
  }
  games.push(game({ id: "target", tipUtc: "2026-11-13T00:30:00Z" }));
  const model: InjuryModel = { params: LIVE_PARAMS, injury: INJURY_PARAMS, statusTable: INJURY_STATUS_TABLE, survival: INJURY_SURVIVAL };
  const report: ReportPoint = {
    at: "2026-11-12T17:30",
    notSubmitted: [B],
    rows: [
      { teamId: A, athleteId: "a-star", status: "O", reason: "Injury/Illness - Knee; Sprain" },
      { teamId: A, athleteId: "a-wing", status: "Q", reason: "Injury/Illness - Ankle; Soreness" },
    ],
  };
  return {
    history: [],
    seasonGames: games,
    model,
    modelVersion: LIVE_MODEL_VERSION,
    referenceModelVersion: REFERENCE_MODEL_VERSION,
    runId: "golden",
    nowIso: "2026-11-12T23:40:00Z",
    source: { boxScores: (id) => box.get(id), availability: () => null },
    report: { point: report, stale: false, missing: false },
    nameOf: (id) => `Name ${id}`,
    marketFor: () => null,
  };
}

describe("v4 goldens: seal rows", () => {
  const context = sealContext();
  const target = context.seasonGames.find((row) => row.id === "target") as SeasonGame;
  const decision = { game: target, inputsIncomplete: false, missingGameIds: [] };
  it("a v2 final seal", () => {
    expect(hash(sealInjuryGames([{ ...decision, kind: "final" }], context))).toBe("f2335db9439336bb5b7725e629cebd7239298000f9e4eac8be9b328e1824897b");
  });
  it("a v1 seal", () => {
    const rows = sealGames([decision], {
      history: [],
      seasonGames: context.seasonGames,
      params: LIVE_PARAMS,
      modelVersion: REFERENCE_MODEL_VERSION,
      runId: "golden",
      nowIso: context.nowIso,
      marketFor: () => null,
    });
    expect(hash(rows)).toBe("1c49be9677235b96542a38364be1678c68193d5ea4c3ef7526f9aa1d32b1e8e5");
  });
});
