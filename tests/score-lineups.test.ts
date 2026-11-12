import { describe, expect, it } from "vitest";
import { pairHalfSubstitutions, parseClock, parsePlays } from "@/lib/live-data/espn-plays";
import { rebuildGame, type GameInput } from "@/lib/score/lineups";
import { periodSeconds, type FreeThrowKind, type PlayEvent } from "@/lib/score/possessions";
import type { PlayerBoxLine } from "@/lib/season/player-stats";

// Small hand-made games. Home is team "1" with players h1..h7, away is "2" with a1..a7;
// h1-h5 and a1-a5 start. Each test writes only the plays that matter.

const HOME = "1";
const AWAY = "2";
const HOME_FIVE = ["h1", "h2", "h3", "h4", "h5"];
const AWAY_FIVE = ["a1", "a2", "a3", "a4", "a5"];

function base(period: number, clock: number, teamId: string | null, onFloor: string[] = [], points = 0) {
  return { period, clock, teamId, onFloor, points, homeScore: 0, awayScore: 0 };
}
const sub = (period: number, clock: number, teamId: string, entering: string | null, leaving: string | null): PlayEvent => ({
  ...base(period, clock, teamId),
  kind: "substitution",
  entering,
  leaving,
});
/** A field goal; `points` 0 is a miss. */
const shot = (period: number, clock: number, teamId: string, shooter: string, points: number): PlayEvent => ({
  ...base(period, clock, teamId, [shooter], points),
  kind: "fieldGoal",
  made: points > 0,
});
const freeThrow = (
  period: number,
  clock: number,
  teamId: string,
  shooter: string,
  made: boolean,
  number: number,
  of: number,
  kind: FreeThrowKind = "regular",
): PlayEvent => ({
  ...base(period, clock, teamId, kind === "technical" ? [] : [shooter], made ? 1 : 0),
  kind: "freeThrow",
  made,
  freeThrow: kind,
  number,
  of,
});
const foul = (period: number, clock: number, teamId: string, player: string | null): PlayEvent => ({
  ...base(period, clock, teamId, player ? [player] : []),
  kind: "foul",
});
/** A play showing these players on the floor (a jump ball, a violation). */
const seen = (period: number, clock: number, teamId: string, players: string[]): PlayEvent => ({
  ...base(period, clock, teamId, players),
  kind: "other",
});
/** An ejection: names a player but is no evidence he is on the floor. */
const ejection = (period: number, clock: number, teamId: string): PlayEvent => ({ ...base(period, clock, teamId), kind: "other" });
const periodEnd = (period: number): PlayEvent => ({ ...base(period, 0, null), kind: "periodEnd" });

/** Fills ESPN's running score from each play's points. */
function withScores(events: PlayEvent[]): PlayEvent[] {
  let home = 0;
  let away = 0;
  return events.map((event) => {
    if (event.teamId === HOME) home += event.points;
    if (event.teamId === AWAY) away += event.points;
    return { ...event, homeScore: home, awayScore: away };
  });
}

function line(athleteId: string, starter: boolean, minutes: number, plusMinus: number): PlayerBoxLine {
  return {
    athleteId,
    name: athleteId,
    position: null,
    starter,
    minutes,
    points: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    threePointersMade: 0,
    threePointersAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    plusMinus,
  };
}

/** Box lines: [athleteId, minutes, plus-minus]; starters are h1-h5 and a1-a5. */
function box(home: Array<[string, number, number]>, away: Array<[string, number, number]>): GameInput["box"] {
  return {
    [HOME]: home.map(([id, minutes, pm]) => line(id, HOME_FIVE.includes(id), minutes, pm)),
    [AWAY]: away.map(([id, minutes, pm]) => line(id, AWAY_FIVE.includes(id), minutes, pm)),
  };
}

function game(events: PlayEvent[], lines: GameInput["box"]): GameInput {
  const scored = withScores(events);
  const last = scored[scored.length - 1];
  return { homeId: HOME, awayId: AWAY, homeScore: last.homeScore, awayScore: last.awayScore, box: lines, events: scored };
}

/** Periods with nothing but their end, for the given periods. */
const quiet = (...periods: number[]) => periods.map(periodEnd);

/** Periods in which all ten starters act (inference evidence), then end. */
const startersSeen = (...periods: number[]) =>
  periods.flatMap((period) => [
    seen(period, periodSeconds(period) - 10, HOME, HOME_FIVE),
    seen(period, periodSeconds(period) - 10, AWAY, AWAY_FIVE),
    periodEnd(period),
  ]);

const allAway = (minutes: number, pm: number): Array<[string, number, number]> => AWAY_FIVE.map((id) => [id, minutes, pm]);

describe("lineup rebuild", () => {
  it("splits a period at a plain substitution and credits points and possessions to each stint", () => {
    const result = rebuildGame(
      game(
        [
          shot(1, 700, HOME, "h1", 2),
          sub(1, 360, HOME, "h6", "h1"),
          shot(1, 300, AWAY, "a1", 3),
          periodEnd(1),
          sub(2, 720, HOME, "h1", "h6"),
          ...quiet(2, 3, 4),
        ],
        box(
          [["h1", 42, 2], ["h2", 48, -1], ["h3", 48, -1], ["h4", 48, -1], ["h5", 48, -1], ["h6", 6, -3]],
          allAway(48, 1),
        ),
      ),
    );
    expect(result.audit.rejected).toBeNull();
    const stints = result.stints ?? [];
    expect(stints).toHaveLength(5);
    expect(stints[0]).toMatchObject({ period: 1, seconds: 360, home: HOME_FIVE, homePoints: 2, homePossessions: 1, startMargin: 0 });
    expect(stints[1]).toMatchObject({
      period: 1,
      seconds: 360,
      home: ["h2", "h3", "h4", "h5", "h6"],
      awayPoints: 3,
      awayPossessions: 1,
      startMargin: 2,
    });
    expect(stints.slice(2).map((stint) => stint.seconds)).toEqual([720, 720, 720]);
  });

  it("knows a later period's five from ESPN's period-start substitutions", () => {
    const result = rebuildGame(
      game(
        // A game logs period-start substitutions when at least two later periods open with them.
        [
          shot(1, 700, HOME, "h1", 2),
          sub(1, 360, HOME, "h6", "h1"),
          periodEnd(1),
          sub(2, 720, HOME, "h1", "h6"),
          periodEnd(2),
          sub(3, 720, AWAY, "a6", "a1"),
          periodEnd(3),
          sub(4, 720, AWAY, "a1", "a6"),
          periodEnd(4),
        ],
        box(
          [["h1", 42, 2], ["h2", 48, 2], ["h3", 48, 2], ["h4", 48, 2], ["h5", 48, 2], ["h6", 6, 0]],
          [["a1", 36, -2], ["a2", 48, -2], ["a3", 48, -2], ["a4", 48, -2], ["a5", 48, -2], ["a6", 12, 0]],
        ),
      ),
    );
    expect(result.audit).toMatchObject({ source: "substitutions", rejected: null, maxPlusMinusGap: 0 });
    expect(result.diagnostics.periodStarts.substitutions).toBe(6);
    expect(result.stints?.[2].home).toEqual(HOME_FIVE);
  });

  it("infers a period's five from who acts or leaves before coming in", () => {
    const result = rebuildGame(
      game(
        [
          sub(1, 360, HOME, "h6", "h1"),
          periodEnd(1),
          // No period-start substitutions anywhere: h6 acts in period 2 before coming in.
          seen(2, 700, HOME, ["h2", "h3", "h4", "h5", "h6"]),
          seen(2, 700, AWAY, AWAY_FIVE),
          shot(2, 600, HOME, "h6", 2),
          periodEnd(2),
          // Period 3: h6 goes out before he is seen coming in, so he started it.
          seen(3, 700, HOME, ["h2", "h3", "h4", "h5"]),
          seen(3, 700, AWAY, AWAY_FIVE),
          sub(3, 600, HOME, "h1", "h6"),
          periodEnd(3),
          ...startersSeen(4),
        ],
        box(
          [["h1", 28, 0], ["h2", 48, 2], ["h3", 48, 2], ["h4", 48, 2], ["h5", 48, 2], ["h6", 20, 2]],
          allAway(48, -2),
        ),
      ),
    );
    expect(result.audit).toMatchObject({ source: "inferred", rejected: null, maxPlusMinusGap: 0 });
    expect(result.diagnostics.periodStarts.inferred).toBe(6);
    const third = (result.stints ?? []).filter((stint) => stint.period === 3);
    expect(third.map((stint) => [stint.seconds, stint.home.includes("h6")])).toEqual([[120, true], [600, false]]);
  });

  it("fills a five from a player silent all period only when the box score picks one choice", () => {
    const events = [
      ...startersSeen(1, 2),
      // h5 never appears in period 3; h7 (bench) does not either.
      seen(3, 700, HOME, ["h1", "h2", "h3", "h4"]),
      seen(3, 700, AWAY, AWAY_FIVE),
      shot(3, 500, HOME, "h1", 2),
      periodEnd(3),
      ...startersSeen(4),
    ];
    const right = rebuildGame(
      game(events, box([...HOME_FIVE.map((id): [string, number, number] => [id, 48, 2]), ["h7", 0, 0]], allAway(48, -2))),
    );
    expect(right.audit.rejected).toBeNull();
    expect(right.diagnostics).toMatchObject({ assignmentsTried: 2, assignmentsReconciled: 1 });
    expect(right.diagnostics.periodStarts.fromBox).toBe(1);
    expect(right.stints?.find((stint) => stint.period === 3)?.home).toEqual(HOME_FIVE);

    // A box score that fits neither choice: the game is rejected, never guessed.
    const neither = rebuildGame(
      game(
        events,
        box(
          [["h1", 48, 2], ["h2", 48, 2], ["h3", 48, 2], ["h4", 48, 2], ["h5", 42, 2], ["h7", 6, 0]],
          allAway(48, -2),
        ),
      ),
    );
    expect(neither.stints).toBeNull();
    expect(neither.audit.rejected).toMatch(/^period-start: none of 2 assignments reconciles/);
  });

  it("credits free throws to the ten on the floor at the foul, not after the substitution", () => {
    const result = rebuildGame(
      game(
        [
          foul(1, 300, AWAY, "a1"),
          sub(1, 300, HOME, "h6", "h1"),
          freeThrow(1, 300, HOME, "h2", true, 1, 2),
          freeThrow(1, 300, HOME, "h2", true, 2, 2),
          periodEnd(1),
          sub(2, 720, HOME, "h1", "h6"),
          ...quiet(2, 3, 4),
        ],
        box(
          [["h1", 43, 2], ["h2", 48, 2], ["h3", 48, 2], ["h4", 48, 2], ["h5", 48, 2], ["h6", 5, 0]],
          allAway(48, -2),
        ),
      ),
    );
    expect(result.audit.rejected).toBeNull();
    const [atFoul, after] = result.stints ?? [];
    expect(atFoul).toMatchObject({ home: HOME_FIVE, seconds: 420, homePoints: 2, homePossessions: 1 });
    expect(after).toMatchObject({ seconds: 300, homePoints: 0, homePossessions: 0 });
  });

  it("gives a technical free throw to the floor at the technical and ends no possession", () => {
    const result = rebuildGame(
      game(
        [
          foul(1, 400, AWAY, null),
          sub(1, 400, HOME, "h6", "h1"),
          freeThrow(1, 400, HOME, "h2", true, 1, 1, "technical"),
          periodEnd(1),
          sub(2, 720, HOME, "h1", "h6"),
          ...quiet(2, 3, 4),
        ],
        box(
          [["h1", 42.7, 1], ["h2", 48, 1], ["h3", 48, 1], ["h4", 48, 1], ["h5", 48, 1], ["h6", 6.7, 0]],
          allAway(48, -1),
        ),
      ),
    );
    expect(result.audit.rejected).toBeNull();
    expect(result.stints?.[0]).toMatchObject({ home: HOME_FIVE, homePoints: 1, homePossessions: 0 });
    expect(result.diagnostics.possessions).toEqual({ [HOME]: 0, [AWAY]: 0 });
  });

  it("keeps an and-one together, in either order ESPN logs it, as one possession", () => {
    const lines = box(
      [["h1", 43, 3], ["h2", 48, 3], ["h3", 48, 3], ["h4", 48, 3], ["h5", 48, 3], ["h6", 5, 0]],
      allAway(48, -3),
    );
    const tail = [periodEnd(1), sub(2, 720, HOME, "h1", "h6"), ...quiet(2, 3, 4)];
    const inOrder = rebuildGame(
      game(
        [
          shot(1, 300, HOME, "h2", 2),
          foul(1, 300, AWAY, "a1"),
          sub(1, 300, HOME, "h6", "h1"),
          freeThrow(1, 300, HOME, "h2", true, 1, 1),
          ...tail,
        ],
        lines,
      ),
    );
    const reversed = rebuildGame(
      game(
        [
          foul(1, 300, AWAY, "a1"),
          sub(1, 300, HOME, "h6", "h1"),
          freeThrow(1, 300, HOME, "h2", true, 1, 1),
          shot(1, 300, HOME, "h2", 2),
          ...tail,
        ],
        lines,
      ),
    );
    for (const result of [inOrder, reversed]) {
      expect(result.audit.rejected).toBeNull();
      expect(result.stints?.[0]).toMatchObject({ home: HOME_FIVE, homePoints: 3, homePossessions: 1 });
      expect(result.diagnostics.possessions[HOME]).toBe(1);
    }
  });

  it("follows an ejection and the substitution after it, and ignores a bench ejection as evidence", () => {
    const result = rebuildGame(
      game(
        [
          ...startersSeen(1),
          // A bench player is ejected before anyone acts in period 2: he did not start it.
          ejection(2, 715, AWAY),
          ...startersSeen(2, 3),
          seen(4, 700, HOME, HOME_FIVE),
          seen(4, 700, AWAY, AWAY_FIVE),
          ejection(4, 120, AWAY),
          sub(4, 120, AWAY, "a6", "a2"),
          shot(4, 60, AWAY, "a6", 2),
          periodEnd(4),
        ],
        box(
          HOME_FIVE.map((id): [string, number, number] => [id, 48, -2]),
          [["a1", 48, 2], ["a2", 46, 0], ["a3", 48, 2], ["a4", 48, 2], ["a5", 48, 2], ["a6", 2, 2], ["a7", 0, 0]],
        ),
      ),
    );
    expect(result.audit).toMatchObject({ rejected: null, wrongCountPlays: 0 });
    expect(result.stints?.at(-1)).toMatchObject({ period: 4, seconds: 120, away: ["a1", "a3", "a4", "a5", "a6"] });
  });

  it("plays overtime as a five-minute period", () => {
    const result = rebuildGame(
      game(
        [...quiet(1, 2, 3, 4), sub(5, 300, HOME, "h6", "h1"), shot(5, 100, HOME, "h6", 2), periodEnd(5)],
        box(
          [["h1", 48, 0], ["h2", 53, 2], ["h3", 53, 2], ["h4", 53, 2], ["h5", 53, 2], ["h6", 5, 2]],
          allAway(53, -2),
        ),
      ),
    );
    expect(result.audit.rejected).toBeNull();
    expect(result.stints?.at(-1)).toMatchObject({ period: 5, seconds: 300, homePoints: 2 });
  });

  it("counts the possession a period ends in", () => {
    const result = rebuildGame(
      game(
        [shot(1, 30, AWAY, "a1", 2), shot(1, 1, HOME, "h1", 0), periodEnd(1), ...quiet(2, 3, 4)],
        box(HOME_FIVE.map((id): [string, number, number] => [id, 48, -2]), allAway(48, 2)),
      ),
    );
    expect(result.audit.rejected).toBeNull();
    expect(result.stints?.[0]).toMatchObject({ homePossessions: 1, awayPossessions: 1 });
  });

  it("rejects a game whose plays leave a side without five", () => {
    const result = rebuildGame(
      game(
        // h7 "replaces" h6, who is not on the floor: home has six.
        [...startersSeen(1, 2, 3), seen(4, 700, HOME, HOME_FIVE), seen(4, 700, AWAY, AWAY_FIVE), sub(4, 400, HOME, "h7", "h6"), periodEnd(4)],
        box([...HOME_FIVE.map((id): [string, number, number] => [id, 48, 0]), ["h7", 0, 0]], allAway(48, 0)),
      ),
    );
    expect(result.stints).toBeNull();
    expect(result.audit.rejected).toMatch(/^lineup-count:/);
    expect(result.audit.wrongCountPlays).toBeGreaterThan(0);
  });

  it("rejects on plus-minus, minutes or points that do not reconcile with the box score", () => {
    const events = [shot(1, 600, HOME, "h1", 2), ...quiet(1, 2, 3, 4)];
    const good = box(HOME_FIVE.map((id): [string, number, number] => [id, 48, 2]), allAway(48, -2));
    expect(rebuildGame(game(events, good)).audit.rejected).toBeNull();

    // ESPN's box plus-minus is sometimes wrong for a player or two; that alone is tolerated.
    const twoOff = box(
      [["h1", 48, 9], ["h2", 48, 9], ["h3", 48, 2], ["h4", 48, 2], ["h5", 48, 2]],
      allAway(48, -2),
    );
    expect(rebuildGame(game(events, twoOff)).audit).toMatchObject({ rejected: null, plusMinusMisses: 2, maxPlusMinusGap: 7 });

    const threeOff = box(
      [["h1", 48, 9], ["h2", 48, 9], ["h3", 48, 9], ["h4", 48, 2], ["h5", 48, 2]],
      allAway(48, -2),
    );
    expect(rebuildGame(game(events, threeOff)).audit.rejected).toMatch(/^plus-minus: 3 players/);

    const minutesOff = box(
      [["h1", 45, 2], ["h2", 48, 2], ["h3", 48, 2], ["h4", 48, 2], ["h5", 48, 2]],
      allAway(48, -2),
    );
    expect(rebuildGame(game(events, minutesOff)).audit).toMatchObject({ maxMinutesGap: 3 });
    expect(rebuildGame(game(events, minutesOff)).audit.rejected).toMatch(/^minutes:/);

    const input = game(events, good);
    const wrongFinal = rebuildGame({ ...input, homeScore: input.homeScore + 3 });
    expect(wrongFinal.audit).toMatchObject({ homePointsGap: -3, awayPointsGap: 0 });
    expect(wrongFinal.audit.rejected).toMatch(/^points:/);
  });
});

describe("ESPN play adapter", () => {
  it("reads every clock form ESPN uses", () => {
    expect(parseClock("12:00", 1, "g")).toBe(720);
    expect(parseClock("0:55.3", 4, "g")).toBe(55.3);
    expect(parseClock("55.3", 4, "g")).toBe(55.3);
    expect(parseClock("5:00", 5, "g")).toBe(300);
    expect(() => parseClock("6:00", 5, "g")).toThrow();
  });

  it("joins a substitution ESPN splits in two, and drops a half that repeats a full one", () => {
    const halves = pairHalfSubstitutions([
      sub(2, 720, HOME, "h6", null),
      sub(2, 720, HOME, null, "h1"),
      sub(2, 720, AWAY, "a6", null),
      sub(2, 720, AWAY, "a6", "a2"),
    ]);
    expect(halves).toHaveLength(2);
    expect(halves[0]).toMatchObject({ entering: "h6", leaving: "h1" });
    expect(halves[1]).toMatchObject({ entering: "a6", leaving: "a2" });
  });

  it("gives a blocked shot to the shooter's side and a free throw one point whatever its scoreValue", () => {
    const roster = new Map([
      ["h1", HOME],
      ["a1", AWAY],
    ]);
    const play = (type: string, text: string, participants: string[], extra: Record<string, unknown> = {}) => ({
      type: { text: type },
      text,
      period: { number: 1 },
      clock: { displayValue: "11:00" },
      homeScore: 0,
      awayScore: 0,
      team: { id: AWAY },
      participants: participants.map((id) => ({ athlete: { id } })),
      ...extra,
    });
    const events = parsePlays(
      {
        plays: [
          play("Layup Shot", "h1 blocks a1 's layup", ["a1", "h1"], { team: { id: AWAY }, shootingPlay: true }),
          play("Free Throw - 1 of 2", "h1 makes free throw 1 of 2", ["h1"], {
            team: { id: HOME },
            scoringPlay: true,
            scoreValue: 0,
            homeScore: 1,
          }),
          play("Offensive Rebound", "Team offensive team rebound", [], { team: { id: HOME } }),
        ],
      },
      "g",
      HOME,
      AWAY,
      roster,
    );
    expect(events[0]).toMatchObject({ kind: "fieldGoal", teamId: AWAY, made: false });
    expect(events[1]).toMatchObject({ kind: "freeThrow", teamId: HOME, made: true, points: 1, number: 1, of: 2 });
    expect(events[2]).toMatchObject({ kind: "rebound", side: "offensive", byTeam: true });
  });
});
