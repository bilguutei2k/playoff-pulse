// The live shadow path must forecast a date with the same M5 scale the registered replay uses
// for that date: refreshed from every earlier regular-season game (Astra's review of PR #37).

import { describe, expect, it } from "vitest";
import { advanceTo, copyRosterState, refreshScale, replayRosterState } from "@/lib/season/roster-state";
import type { SeasonGame } from "@/lib/season/types";
import { PARAMS, syntheticWorld } from "./roster-state.test";

const TEAMS = ["1", "2", "3", "4"];
const rosters = () => new Map(TEAMS.map((teamId) => [teamId, Array.from({ length: 8 }, (_, index) => `${teamId}-${index}`)]));
const STATUS = { O: 0.999, D: 0.98, Q: 0.48, P: 0.19, A: 0.19 };

describe("v4 live scale", () => {
  it("copy, advance and refresh gives the scale the replay uses for the next date", () => {
    const world = syntheticWorld("scale");
    const regular = world.games.filter((game) => game.season === 2011 && game.kind === "regular");
    const dates = [...new Set(regular.map((game) => game.etDate))].sort();
    const last = dates[dates.length - 1];
    const before = regular.filter((game) => game.etDate < last);
    const next = regular.filter((game) => game.etDate === last);
    const replay = (games: SeasonGame[], state?: ReturnType<typeof replayRosterState>, seen?: number[]) =>
      replayRosterState({
        games,
        linesFor: (id) => world.lines.get(id),
        reportFor: () => null,
        openingRosters: rosters,
        params: PARAMS,
        statusTable: () => STATUS,
        ...(state ? { state } : {}),
        ...(seen ? { onForecast: (row: { forecast: { scale: number } }) => seen.push(row.forecast.scale) } : {}),
      });
    const state = replay(before);
    // Fill M5's window past its minimum so the scale is actually estimated.
    const entries = [...state.scaleWindow];
    while (state.scaleWindow.length < 1200) state.scaleWindow.push(...entries.map((entry) => ({ ...entry, y: (1 - entry.y) as 0 | 1 })), ...entries);
    state.scaleWindow.splice(1200);

    const live = copyRosterState(state);
    advanceTo(live, 2011, last, PARAMS, rosters);
    refreshScale(live);

    const seen: number[] = [];
    replay(next, copyRosterState(state), seen);
    expect(seen.length).toBeGreaterThan(0);
    for (const scale of seen) expect(live.scale).toBe(scale);

    const stale = copyRosterState(state);
    advanceTo(stale, 2011, last, PARAMS, rosters);
    expect(stale.scale).not.toBe(live.scale);
  });
});
