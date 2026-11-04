import { describe, expect, it } from "vitest";
import { parsePlayerBoxScore } from "@/lib/live-data/espn-season";
import { quarterReportNames, type ParsedReport } from "@/lib/live-data/nba-reports";
import {
  derivePlayerFiles,
  emptyPlayerGamesDay,
  addPlayerGame,
  injuryListings,
  storePlayerGame,
  type PlayerBoxScore,
} from "@/lib/season/player-stats";
import { pendingOrdinals } from "@/lib/season/projections";
import { emptyReportDay, type LiveReportDay } from "@/lib/season/live-reports";
import { SEASON_TEAMS } from "@/lib/season/teams";
import type { SeasonGame } from "@/lib/season/types";
import { nextGameDate, refreshReportSlates } from "../scripts/live/live-availability";

const [A, B, C, D] = SEASON_TEAMS;

function game(id: string, etDate: string, home: string, away: string, extra: Partial<SeasonGame> = {}): SeasonGame {
  return {
    id,
    season: 2027,
    kind: "regular",
    tipUtc: `${etDate}T23:30Z`,
    etDate,
    homeId: home,
    awayId: away,
    neutral: false,
    status: "scheduled",
    homeScore: null,
    awayScore: null,
    ...extra,
  };
}

/** A report listing one player per team of each given date, stamped `issuedEt`. */
function report(issuedEt: string, dates: Record<string, Array<[string, string]>>): ParsedReport {
  return {
    issuedEt,
    rows: Object.entries(dates).flatMap(([gameDate, teams]) =>
      teams.map(([teamName, player]) => ({
        gameDate,
        matchup: "X@Y",
        team: teamName,
        player,
        status: "Out" as const,
        reason: "Injury/Illness - Knee",
      })),
    ),
  };
}

describe("next-slate reports", () => {
  const now = "2026-11-04T01:05:00.000Z"; // 20:05 ET on 11-03
  const names = quarterReportNames("2026-11-03T20:05", 8);
  const today = [game("t1", "2026-11-03", A.id, B.id)];
  const tomorrow = [game("n1", "2026-11-04", C.id, D.id)];
  const evening = report("2026-11-03T20:00", {
    "2026-11-03": [[A.name, "Star, Home"]],
    "2026-11-04": [[C.name, "Star, Next"]],
  });
  const files = new Map<string, ParsedReport>([[names[0], evening]]);
  const fetchPdf = async (name: string) => (files.has(name) ? new TextEncoder().encode(name) : null);
  const parse = async (data: Uint8Array) => files.get(new TextDecoder().decode(data)) as ParsedReport;
  const pause = async () => {};

  it("serves both slates from one download and leaves the lead's outcome unchanged", async () => {
    const alone = await refreshReportSlates({
      nowIso: now,
      slates: [{ etDate: "2026-11-03", games: today, day: null }],
      parse,
      fetchPdf,
      pause,
    });
    const both = await refreshReportSlates({
      nowIso: now,
      slates: [
        { etDate: "2026-11-03", games: today, day: null },
        { etDate: "2026-11-04", games: tomorrow, day: null },
      ],
      parse,
      fetchPdf,
      pause,
    });
    expect(both.downloads).toBe(1);
    expect(both.slates[0]).toEqual(alone.slates[0]);
    const next = both.slates[1];
    expect(next.succeeded).toBe(true);
    expect(next.day.reports["2026-11-03T20:00"].rows).toEqual([[C.id, "Star, Next", "O", "Injury/Illness - Knee"]]);
    expect(both.slates[0].day.reports["2026-11-03T20:00"].rows).toEqual([[A.id, "Star, Home", "O", "Injury/Illness - Knee"]]);
  });

  it("never downloads a file twice for a slate and keeps the per-run budget", async () => {
    let requests = 0;
    const counting = async (name: string) => {
      requests += 1;
      return fetchPdf(name);
    };
    // The newest file lists only today: unusable for tomorrow, so tomorrow looks further
    // back, but only with what is left of the four downloads.
    files.set(names[0], report("2026-11-03T20:00", { "2026-11-03": [[A.name, "Star, Home"]] }));
    const first = await refreshReportSlates({
      nowIso: now,
      slates: [
        { etDate: "2026-11-03", games: today, day: null },
        { etDate: "2026-11-04", games: tomorrow, day: null },
      ],
      parse,
      fetchPdf: counting,
      pause,
    });
    expect(first.downloads).toBeLessThanOrEqual(4);
    expect(requests).toBe(first.downloads);
    expect(first.slates[1].day.files[names[0]]).toMatchObject({ usable: false });
    const again = await refreshReportSlates({
      nowIso: now,
      slates: [
        { etDate: "2026-11-03", games: today, day: first.slates[0].day },
        { etDate: "2026-11-04", games: tomorrow, day: first.slates[1].day },
      ],
      parse,
      fetchPdf: counting,
      pause,
    });
    // Refusals are retried (a file may appear later); nothing seen is downloaded again.
    const seen = Object.keys(first.slates[1].day.files);
    expect(seen).toContain(names[0]);
    expect(again.slates[0].succeeded).toBe(true);
    files.set(names[0], evening);
  });

  it("leads with the next slate when today has nothing left", async () => {
    const empty: LiveReportDay = emptyReportDay("2026-11-04");
    const run = await refreshReportSlates({
      nowIso: now,
      slates: [{ etDate: "2026-11-04", games: tomorrow, day: empty }],
      parse,
      fetchPdf,
      pause,
    });
    expect(run.slates[0].succeeded).toBe(true);
    expect(Object.keys(run.slates[0].day.reports)).toEqual(["2026-11-03T20:00"]);
  });

  it("finds the next ET date with games", () => {
    const games = [
      game("a", "2026-11-03", A.id, B.id),
      game("b", "2026-11-05", A.id, B.id, { status: "postponed" }),
      game("c", "2026-11-06", C.id, D.id),
    ];
    expect(nextGameDate(games, "2026-11-03")?.etDate).toBe("2026-11-06");
    expect(nextGameDate(games, "2026-11-06")).toBeNull();
  });
});

function summary(teams: Array<{ id: string; athletes: unknown[] }>) {
  const labels = ["MIN", "PTS", "FG", "3PT", "FT", "REB", "AST", "TO", "STL", "BLK", "OREB", "DREB", "PF", "+/-"];
  return {
    boxscore: {
      players: teams.map((team) => ({ team: { id: team.id }, statistics: [{ labels, athletes: team.athletes }] })),
    },
  };
}

const athlete = (id: string, stats: string[], extra: Record<string, unknown> = {}) => ({
  athlete: { id, displayName: `Player ${id}`, position: { abbreviation: "G" } },
  starter: false,
  didNotPlay: false,
  reason: "COACH'S DECISION",
  stats,
  ...extra,
});

describe("full player lines", () => {
  const payload = summary([
    {
      id: A.id,
      athletes: [
        athlete("1", ["34", "30", "10-17", "2-5", "8-9", "12", "7", "3", "1", "2", "1", "11", "3", "+12"], { starter: true }),
        athlete("2", ["14", "6", "3-6", "0-1", "0-0", "2", "1", "0", "0", "0", "0", "2", "1", "-4"]),
        athlete("3", [], { didNotPlay: true, reason: "RIGHT ANKLE SPRAIN" }),
        athlete("4", [], { didNotPlay: true }),
      ],
    },
    { id: B.id, athletes: [athlete("5", ["40", "33", "12-20", "3-8", "6-6", "5", "4", "2", "1", "0", "1", "4", "2", "-12"])] },
  ]);

  it("parses lines, plus/minus, starters and did-not-play reasons", () => {
    const box = parsePlayerBoxScore(payload, "g");
    expect(box[A.id].lines.map((line) => [line.athleteId, line.starter, line.points, line.threePointersMade, line.plusMinus])).toEqual([
      ["1", true, 30, 2, 12],
      ["2", false, 6, 0, -4],
    ]);
    expect(box[A.id].didNotPlay).toEqual([
      { athleteId: "3", name: "Player 3", position: "G", reason: "RIGHT ANKLE SPRAIN" },
      { athleteId: "4", name: "Player 4", position: "G", reason: "COACH'S DECISION" },
    ]);
  });

  it("rejects a changed layout", () => {
    const broken = summary([{ id: A.id, athletes: [athlete("1", ["34", "30", "10-17", "2-5", "8-9", "12", "7", "3", "1", "2", "1", "11", "3", "n/a"])] }, { id: B.id, athletes: [] }]);
    expect(() => parsePlayerBoxScore(broken, "g")).toThrow();
  });

  it("stores a game only when its points match the final", () => {
    const box: PlayerBoxScore = parsePlayerBoxScore(payload, "g");
    const final = game("g", "2026-11-02", A.id, B.id, { status: "final", homeScore: 36, awayScore: 33 });
    expect(storePlayerGame(final, box).teams[A.id].didNotPlay).toEqual([["3", "RIGHT ANKLE SPRAIN"], ["4", "COACH'S DECISION"]]);
    expect(() => storePlayerGame({ ...final, homeScore: 60 }, box)).toThrow(/final score/);
  });

  it("derives averages, shooting, logs and report listings", () => {
    const box = parsePlayerBoxScore(payload, "g");
    const final = game("g", "2026-11-02", A.id, B.id, { status: "final", homeScore: 36, awayScore: 33 });
    const day = emptyPlayerGamesDay(final.etDate);
    addPlayerGame(day, storePlayerGame(final, box), box);
    const reportDay: LiveReportDay = {
      etDate: final.etDate,
      files: {},
      reports: {
        "2026-11-02T18:00": { file: "x", notSubmitted: [], rows: [[A.id, "Three, Player", "Q", "Injury/Illness - Right Ankle; Sprain"]] },
      },
    };
    const listings = injuryListings({
      games: [final],
      reportDay: () => reportDay,
      resolve: (_teamId, printed) => (printed === "Three, Player" ? "3" : null),
      playedIn: () => false,
    });
    expect(listings).toHaveLength(1);
    const files = derivePlayerFiles({
      season: 2027,
      seasonLabel: "2026-27",
      days: [day],
      listings,
      impact: (athleteId) => (athleteId === "1" ? 4.2 : null),
      nameOf: () => undefined,
    });
    const star = files.index.players.find((player) => player.athleteId === "1");
    expect(star).toMatchObject({ games: 1, starts: 1, impact: 4.2, shooting: { fieldGoal: 0.588, threePoint: 0.4, freeThrow: 0.889 } });
    expect(star?.perGame?.rebounds).toBe(12);
    const injured = files.index.players.find((player) => player.athleteId === "3");
    expect(injured).toMatchObject({ games: 0, didNotPlay: 1, reportListings: 1, reportListingsMissed: 1, perGame: null });
    const team = files.teams.get(A.id);
    expect(team?.players.find((player) => player.athleteId === "3")?.log[0]).toMatchObject({ played: false, reason: "RIGHT ANKLE SPRAIN" });
    expect(team?.players.find((player) => player.athleteId === "3")?.injuries[0]).toMatchObject({ status: "Q", played: false });
  });
});

describe("projection ordinals", () => {
  it("count each team's pending regular games in tip order, as the simulator does", () => {
    const games = [
      game("final", "2026-11-01", A.id, B.id, { status: "final", homeScore: 1, awayScore: 0 }),
      game("live", "2026-11-02", A.id, C.id, { status: "in-progress" }),
      game("next", "2026-11-03", B.id, A.id),
      game("cup", "2026-11-04", A.id, D.id, { kind: "play-in" }),
      game("later", "2026-11-05", D.id, A.id),
    ];
    const ordinals = pendingOrdinals(games);
    expect(ordinals.get("live")).toEqual({ home: 0, away: 0 });
    expect(ordinals.get("next")).toEqual({ home: 0, away: 1 });
    expect(ordinals.get("later")).toEqual({ home: 0, away: 2 });
    expect(ordinals.has("cup")).toBe(false);
  });
});
