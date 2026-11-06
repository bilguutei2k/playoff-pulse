// /api/live/health decides "game day" from the published games file and today's slate
// date, never from the state's own nextSlateEtDate, which is as stale as the state.
import { afterEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  games: [] as { etDate: string; status: string }[],
  generatedAt: "2026-11-05T00:00:00Z",
}));
vi.mock("@/lib/live-data/published", () => ({
  getLiveHealthSnapshot: async () => ({
    liveState: { generatedAt: fixtures.generatedAt, nextSlateEtDate: "2026-11-02", modelVersion: "test", notes: [] },
    games: fixtures.games,
    data: { source: "network" },
  }),
}));
import { GET } from "@/app/api/live/health/route";

afterEach(() => vi.useRealTimers());
// 20:00 UTC on 2026-11-05 is 3 PM ET: slate 2026-11-05. The state is 20 hours old, past the
// 12-hour game-day limit and inside the 36-hour allowance for a day without games.
const at = (iso: string) => vi.useFakeTimers({ toFake: ["Date"] }).setSystemTime(new Date(iso));

describe("health uses the published schedule", () => {
  it("is stale on today's ET game day even when nextSlateEtDate is stale", async () => {
    at("2026-11-05T20:00:00Z");
    fixtures.games = [{ etDate: "2026-11-05", status: "scheduled" }];
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "stale", slate: "2026-11-05" });
  });

  it.each(["canceled", "postponed"])("keeps the non-game-day allowance when today's only game is %s", async (status) => {
    at("2026-11-05T20:00:00Z");
    fixtures.games = [{ etDate: "2026-11-05", status }, { etDate: "2026-11-06", status: "scheduled" }];
    expect((await GET()).status).toBe(200);
  });

  it("uses the slate date, so 2 AM ET still belongs to the previous day's games", async () => {
    at("2026-11-06T07:00:00Z");
    fixtures.games = [{ etDate: "2026-11-05", status: "final" }];
    expect(await (await GET()).json()).toMatchObject({ slate: "2026-11-05", status: "stale" });
  });

  it("is stale when the state's timestamp cannot be read", async () => {
    at("2026-11-05T20:00:00Z");
    fixtures.games = [];
    fixtures.generatedAt = "garbage";
    expect((await GET()).status).toBe(503);
    fixtures.generatedAt = "2026-11-05T00:00:00Z";
  });
});
