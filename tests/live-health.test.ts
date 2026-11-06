import { afterEach, describe, expect, it, vi } from "vitest";
const fixtures = vi.hoisted(() => ({ games: [] as { etDate: string; status: string }[] }));
vi.mock("@/lib/live-data/published", () => ({
  getLiveState: async () => ({
    generatedAt: "2026-11-05T00:00:00Z", nextSlateEtDate: "2026-11-02",
    modelVersion: "test", notes: [],
  }),
  getSeasonGames: async () => fixtures.games,
  getLiveDataStatus: async () => ({ source: "network" }),
}));
import { GET } from "@/app/api/live/health/route";
afterEach(() => vi.useRealTimers());
describe("health uses the published schedule", () => {
  it("is stale on today's ET game day even when nextSlateEtDate is stale", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-11-05T20:00:00Z"));
    fixtures.games = [{ etDate: "2026-11-05", status: "scheduled" }];
    expect((await GET()).status).toBe(503);
  });
  it("retains the non-game-day allowance for canceled games and another ET date", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-11-05T20:00:00Z"));
    fixtures.games = [{ etDate: "2026-11-05", status: "canceled" }, { etDate: "2026-11-06", status: "scheduled" }];
    expect((await GET()).status).toBe(200);
  });
});
