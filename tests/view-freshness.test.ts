// The page-level freshness decisions (src/lib/view/freshness.ts) behind FreshnessGuard.
import { describe, expect, it } from "vitest";
import { MAX_REFRESHES, NOTICE_AFTER_MS, freshnessNotice, serverIsNewer, shouldRefresh } from "@/lib/view/freshness";
import { OUT_DEFINITION, TILE_DEFINITION, tileHelp } from "@/lib/view/how-to-read";

const rendered = "2026-11-09T07:00:00.000Z";
const at = (minutesLater: number) => new Date(Date.parse(rendered) + minutesLater * 60_000).toISOString();
const now = (minutesLater: number) => Date.parse(rendered) + minutesLater * 60_000;

describe("server newer", () => {
  it("needs a material gap, and never counts a missing or unreadable stamp", () => {
    expect(serverIsNewer(rendered, at(1))).toBe(false);
    expect(serverIsNewer(rendered, at(1.01))).toBe(true);
    expect(serverIsNewer(rendered, at(-10))).toBe(false);
    expect(serverIsNewer(rendered, null)).toBe(false);
    expect(serverIsNewer(rendered, "garbage")).toBe(false);
    expect(serverIsNewer("garbage", at(10))).toBe(false);
  });

  it("asks for a fresh copy at most twice per gap", () => {
    expect(shouldRefresh({ renderedAt: rendered, serverAt: at(10), refreshes: 0 })).toBe(true);
    expect(shouldRefresh({ renderedAt: rendered, serverAt: at(10), refreshes: MAX_REFRESHES - 1 })).toBe(true);
    expect(shouldRefresh({ renderedAt: rendered, serverAt: at(10), refreshes: MAX_REFRESHES })).toBe(false);
    expect(shouldRefresh({ renderedAt: rendered, serverAt: at(0.5), refreshes: 0 })).toBe(false);
  });
});

describe("the body notice", () => {
  const base = { renderedAt: rendered, serverAt: null, checked: false, refreshes: 0 };

  it("stays silent for a copy up to twenty minutes old, whatever the server says", () => {
    expect(freshnessNotice({ ...base, nowMs: now(5) })).toBeNull();
    expect(freshnessNotice({ ...base, serverAt: at(4), checked: true, nowMs: now(20) })).toBeNull();
    expect(freshnessNotice({ ...base, nowMs: Date.parse(rendered) + NOTICE_AFTER_MS })).toBeNull();
  });

  it("says a newer copy is loading, then to reload once refreshing stopped helping", () => {
    expect(freshnessNotice({ ...base, serverAt: at(60), checked: true, nowMs: now(90) })).toEqual({ kind: "loading", ageMs: 90 * 60_000 });
    expect(freshnessNotice({ ...base, serverAt: at(60), checked: true, refreshes: MAX_REFRESHES, nowMs: now(90) })).toMatchObject({ kind: "reload" });
  });

  it("blames the job when the server has nothing newer, and says when it could not ask", () => {
    expect(freshnessNotice({ ...base, serverAt: rendered, checked: true, nowMs: now(45) })).toMatchObject({ kind: "nothing-newer" });
    expect(freshnessNotice({ ...base, checked: true, nowMs: now(45) })).toMatchObject({ kind: "unknown" });
    expect(freshnessNotice({ ...base, nowMs: now(45) })).toMatchObject({ kind: "unknown" });
  });

  it("is silent for an unreadable stamp rather than claiming an age", () => {
    expect(freshnessNotice({ ...base, renderedAt: "garbage", nowMs: now(45) })).toBeNull();
  });
});

describe("how-to-read copy is reused word for word", () => {
  it("keeps the published Tile and Out definitions", () => {
    expect(TILE_DEFINITION).toBe(
      "Solid: sealed before tip and scored. Outline: the live estimate, from the score and the clock. Dashed: never scored (a provisional number or a projection). Each game is sealed in the morning and again in the hour before tip; the final seal is the one scored.",
    );
    expect(OUT_DEFINITION).toBe(
      "Points of margin each side gives up to players on the NBA injury report, weighted by status. A team that has not filed counts the players who missed its last game. Unknown future injuries, minutes shifting to teammates and matchups are not modeled.",
    );
  });

  it("builds each tooltip from the same sentences", () => {
    expect(tileHelp("sealed")).toBe(
      "Sealed before tip and scored. Each game is sealed in the morning and again in the hour before tip; the final seal is the one scored.",
    );
    expect(tileHelp("live")).toBe("The live estimate, from the score and the clock.");
    expect(tileHelp("dash")).toBe("Never scored (a provisional number or a projection).");
  });
});
