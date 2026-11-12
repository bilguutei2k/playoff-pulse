import { describe, expect, it } from "vitest";
import { isAndOne, possessionEnds, type FreeThrowKind, type PlayEvent } from "@/lib/score/possessions";

// Hand-made play sequences: where each possession ends and for whom. Home is "1", away "2".

const HOME = "1";
const AWAY = "2";

function base(clock: number, teamId: string | null, period = 1) {
  return { period, clock, teamId, onFloor: [], points: 0, homeScore: 0, awayScore: 0 };
}
const shot = (clock: number, teamId: string, points: number): PlayEvent => ({
  ...base(clock, teamId),
  points,
  kind: "fieldGoal",
  made: points > 0,
});
const freeThrow = (clock: number, teamId: string, made: boolean, number: number, of: number, kind: FreeThrowKind = "regular"): PlayEvent => ({
  ...base(clock, teamId),
  points: made ? 1 : 0,
  kind: "freeThrow",
  made,
  freeThrow: kind,
  number,
  of,
});
const rebound = (clock: number, teamId: string, side: "offensive" | "defensive", byTeam = false): PlayEvent => ({
  ...base(clock, teamId),
  kind: "rebound",
  side,
  byTeam,
});
const turnover = (clock: number, teamId: string): PlayEvent => ({ ...base(clock, teamId), kind: "turnover" });
const foul = (clock: number, teamId: string): PlayEvent => ({ ...base(clock, teamId), kind: "foul" });
const periodEnd = (period = 1): PlayEvent => ({ ...base(0, null, period), kind: "periodEnd" });

/** "H" or "A" for each possession end, in order. */
function ends(events: PlayEvent[]): string {
  return possessionEnds(events, HOME, AWAY)
    .map((end) => (end.teamId === HOME ? "H" : "A"))
    .join("");
}

describe("possession ends", () => {
  it("ends on a made basket, a defensive rebound and a turnover, and not on an offensive rebound", () => {
    expect(
      ends([
        shot(700, HOME, 2),
        shot(680, AWAY, 0),
        rebound(678, AWAY, "offensive"),
        shot(670, AWAY, 0),
        rebound(668, HOME, "defensive"),
        turnover(650, HOME),
      ]),
    ).toBe("HAH");
  });

  it("ignores the dead-ball team rebound ESPN logs after a missed first free throw", () => {
    expect(
      ends([
        foul(600, AWAY),
        freeThrow(600, HOME, false, 1, 2),
        rebound(600, HOME, "offensive", true),
        freeThrow(600, HOME, true, 2, 2),
      ]),
    ).toBe("H");
    // A miss on the last free throw is live: the defence's rebound ends the possession.
    expect(ends([freeThrow(600, HOME, true, 1, 2), freeThrow(600, HOME, false, 2, 2), rebound(598, AWAY, "defensive")])).toBe("H");
  });

  it("counts an offensive foul once, by its turnover", () => {
    expect(ends([foul(500, HOME), turnover(500, HOME)])).toBe("H");
  });

  it("ends an and-one after its free throw, whichever order ESPN logs them in", () => {
    const inOrder = [shot(400, HOME, 2), foul(400, AWAY), freeThrow(400, HOME, true, 1, 1)];
    expect(ends(inOrder)).toBe("H");
    expect(possessionEnds(inOrder, HOME, AWAY)[0].index).toBe(2);
    expect(isAndOne(inOrder, 2)).toBe(true);
    const reversed = [foul(400, AWAY), freeThrow(400, HOME, true, 1, 1), shot(400, HOME, 2)];
    expect(ends(reversed)).toBe("H");
    expect(possessionEnds(reversed, HOME, AWAY)[0].index).toBe(2);
  });

  it("keeps the ball after technical, flagrant, take-foul and away-from-play free throws", () => {
    expect(ends([foul(300, AWAY), freeThrow(300, HOME, true, 1, 1, "technical")])).toBe("");
    // Flagrant free throws, then the same side's possession goes on and ends once.
    expect(
      ends([foul(300, AWAY), freeThrow(300, HOME, true, 1, 2, "flagrant"), freeThrow(300, HOME, true, 2, 2, "flagrant"), shot(290, HOME, 2)]),
    ).toBe("H");
    // A take foul: one free throw and the shooting side keeps the ball, then scores.
    expect(ends([foul(300, AWAY), freeThrow(300, HOME, true, 1, 1), shot(290, HOME, 2)])).toBe("H");
  });

  it("follows a team rebound's label, not ESPN's team on it", () => {
    // ESPN names the shooting team on a defensive team rebound in early seasons.
    expect(ends([shot(200, AWAY, 0), rebound(199, AWAY, "defensive", true), shot(190, HOME, 2)])).toBe("AH");
  });

  it("closes the possession a period ends in, but not one that never started", () => {
    expect(ends([shot(30, AWAY, 2), shot(1, HOME, 0), periodEnd()])).toBe("AH");
    expect(ends([shot(30, AWAY, 0), rebound(28, HOME, "defensive"), periodEnd()])).toBe("A");
    // No period-end play: the period closes at its last event.
    expect(ends([shot(5, HOME, 0), { ...shot(700, AWAY, 2), period: 2 }])).toBe("HA");
  });
});
