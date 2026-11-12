import { describe, expect, it } from "vitest";
import type { PlayerIndexFile, PlayerLogEntry, TeamPlayersFile } from "@/lib/season/player-stats";
import type { GameProjection, ProjectionsFile, TeamInjuriesFile, TeamInjuryList } from "@/lib/season/projections";
import { basisSummary, blockFromList, buildInjuryReport, listPoints } from "@/lib/view/injury-report";
import {
  buildPlayerPage,
  espnReason,
  formatScore,
  formatShooting,
  logTotals,
  playerTableRows,
  reportReason,
  scoreShareText,
  statusSourceLabel,
  statusSourceText,
  statusView,
  teamRoster,
} from "@/lib/view/players";
import { fromPublished } from "@/lib/view/projection";

const IND = "11";
const ATL = "1";
const DET = "8";
const PHI = "20";
const ORL = "19";

const played = (gameId: string, etDate: string, points: number, extra: Partial<PlayerLogEntry> = {}): PlayerLogEntry => ({
  gameId,
  etDate,
  opponentId: ATL,
  home: true,
  played: true,
  starter: true,
  minutes: 30,
  points,
  offensiveRebounds: 1,
  defensiveRebounds: 4,
  assists: 3,
  steals: 1,
  blocks: 0,
  turnovers: 2,
  fouls: 2,
  fieldGoalsMade: 5,
  fieldGoalsAttempted: 10,
  threePointersMade: 1,
  threePointersAttempted: 4,
  freeThrowsMade: 0,
  freeThrowsAttempted: 0,
  plusMinus: 3,
  ...(extra as object),
} as PlayerLogEntry);

const teamFile: TeamPlayersFile = {
  version: 1,
  season: 2027,
  seasonLabel: "2026-27",
  teamId: IND,
  games: [
    { gameId: "g1", etDate: "2026-11-01", opponentId: ATL, home: true, teamScore: 110, opponentScore: 100 },
    { gameId: "g2", etDate: "2026-11-02", opponentId: ATL, home: true, teamScore: 104, opponentScore: 108 },
  ],
  players: [
    {
      athleteId: "100",
      name: "Pascal Siakam",
      position: "F",
      log: [
        played("g1", "2026-11-01", 20),
        { gameId: "g2", etDate: "2026-11-02", opponentId: ATL, home: true, played: false, reason: "REST" },
      ],
      injuries: [
        { gameId: "g2", etDate: "2026-11-02", teamId: IND, reportAt: "2026-11-02T19:30", status: "O", reason: "Rest", played: false },
      ],
    },
    { athleteId: "101", name: "Johnny Furphy", position: "G", log: [], injuries: [] },
  ],
};

const index: PlayerIndexFile = {
  version: 1,
  season: 2027,
  seasonLabel: "2026-27",
  throughEtDate: "2026-11-02",
  storedGames: 2,
  impactLabel: "",
  scoreLabel: "",
  scoreModel: "score-test",
  scoreCheckpoint: "2026-11-11",
  players: [
    {
      athleteId: "100",
      name: "Pascal Siakam",
      position: "F",
      teamId: IND,
      teamIds: [IND],
      games: 1,
      starts: 1,
      didNotPlay: 1,
      perGame: { minutes: 30, points: 20, rebounds: 5, offensiveRebounds: 1, defensiveRebounds: 4, assists: 3, steals: 1, blocks: 0, turnovers: 2, fouls: 2, plusMinus: 3 },
      totals: { fieldGoalsMade: 5, fieldGoalsAttempted: 10, threePointersMade: 1, threePointersAttempted: 4, freeThrowsMade: 0, freeThrowsAttempted: 0 },
      shooting: { fieldGoal: 0.5, threePoint: 0.25, freeThrow: null },
      reportListings: 1,
      reportListingsMissed: 1,
      impact: 2.359,
      score: -1.25,
      scoreShare: 0.3,
      scoreBox: -0.75,
      scoreOnCourt: -0.5,
      lastEtDate: "2026-11-02",
    },
  ],
};

const list = (teamId: string, overrides: Partial<TeamInjuryList> = {}): TeamInjuryList => ({
  teamId,
  nextGame: { gameId: "g3", etDate: "2026-11-04", tipUtc: "2026-11-05T00:00Z", opponentId: teamId === IND ? ATL : IND, home: teamId === IND },
  basis: { kind: "report", reportAt: "2026-11-04T01:30", stale: false },
  report: { at: "2026-11-04T01:30", file: "2026-11-04_01_30AM", stale: false },
  filing: "filed",
  absencePoints: 0,
  rows: [],
  ...overrides,
});

const lists: TeamInjuriesFile = {
  version: 1,
  season: 2027,
  seasonLabel: "2026-27",
  modelVersion: "v2",
  teams: [
    list(IND, {
      absencePoints: 1.2,
      rows: [
        { athleteId: "200", name: "Tyrese Haliburton", source: "report", status: "O", reason: "Injury/Illness - Left Hamstring Strain", gamesMissed: 3, points: 1.2 },
        { athleteId: null, name: "Veesaar, Henri", source: "report", status: "Q", reason: "G League - Two-Way", gamesMissed: 0, points: 0 },
        { athleteId: "100", name: "Pascal Siakam", source: "box-score", status: null, reason: null, gamesMissed: 1, points: 0 },
      ],
    }),
    list(ATL, { filing: "not-yet-submitted", absencePoints: 0.7, rows: [{ athleteId: "300", name: "Jalen Johnson", source: "box-score", status: null, reason: null, gamesMissed: 2, points: 0.7 }] }),
    list(ORL, {
      nextGame: { gameId: "g9", etDate: "2026-11-06", tipUtc: "2026-11-07T00:00Z", opponentId: DET, home: true },
      basis: { kind: "current-absences" },
      report: null,
      filing: null,
      absencePoints: 2.6,
      rows: [{ athleteId: "400", name: "Paolo Banchero", source: "box-score", status: "O", reason: "Injury/Illness - Right High Ankle Sprain", gamesMissed: 2, points: 2.6 }],
    }),
    // Plays on both days: its list covers the first game only.
    list(PHI, { nextGame: { gameId: "g4", etDate: "2026-11-04", tipUtc: "2026-11-05T00:30Z", opponentId: DET, home: true } }),
    list(DET, { nextGame: { gameId: "g4", etDate: "2026-11-04", tipUtc: "2026-11-05T00:30Z", opponentId: PHI, home: false } }),
  ],
};

const projection = (gameId: string, etDate: string, homeId: string, awayId: string, extra: Partial<GameProjection> = {}): GameProjection => ({
  gameId,
  etDate,
  tipUtc: `${etDate}T23:00Z`,
  homeId,
  awayId,
  neutral: false,
  kind: "regular",
  homeWinProbability: 0.6,
  awayWinProbability: 0.4,
  expectedMargin: 3,
  homeOnBackToBack: false,
  awayOnBackToBack: false,
  basis: { kind: "report", reportAt: "2026-11-04T01:30", stale: false },
  absencePoints: { home: 0, away: 0 },
  unfiled: { home: false, away: false },
  drivers: { home: [], away: [] },
  driversComplete: true,
  ...extra,
});

const projections: ProjectionsFile = {
  version: 1,
  season: 2027,
  seasonLabel: "2026-27",
  modelVersion: "v2",
  label: "",
  fromEtDate: "2026-11-04",
  throughEtDate: "2026-11-10",
  ratingsHash: "x",
  ratingsThroughUtc: null,
  games: [
    projection("g3", "2026-11-04", IND, ATL, { tipUtc: "2026-11-05T00:00Z" }),
    projection("g4", "2026-11-04", PHI, DET, { tipUtc: "2026-11-05T00:30Z" }),
    projection("g5", "2026-11-05", PHI, IND, {
      basis: { kind: "current-absences" },
      absencePoints: { home: 0.5, away: 0 },
      drivers: { home: [{ athleteId: "500", name: "Joel Embiid", status: null, points: 0.5 }], away: [] },
    }),
    projection("g9", "2026-11-06", ORL, DET, { basis: { kind: "current-absences" } }),
  ],
};

describe("player statuses", () => {
  it("reads report statuses, earlier reports and box-score inferences", () => {
    expect(statusView({ status: "O", source: "report", gamesMissed: 0 })).toMatchObject({ label: "Out", tone: "bad", filter: "O" });
    expect(statusView({ status: "O", source: "box-score", gamesMissed: 2 }).label).toBe("Out (earlier report)");
    expect(statusView({ status: "A", source: "report", gamesMissed: 0 }).filter).toBe("P");
    expect(statusView({ status: null, source: "box-score", gamesMissed: 1 })).toMatchObject({ label: "Missed last game", short: "Missed 1", filter: "missed" });
    expect(statusView({ status: null, source: "box-score", gamesMissed: 3 }).label).toBe("Missed last 3 games");
  });
  it("names the same source in the tag, the source column and the line under the tag", () => {
    expect(statusSourceLabel({ status: "O", source: "report" })).toBe("NBA report");
    expect(statusSourceLabel({ status: "O", source: "earlier-report" })).toBe("Earlier report");
    // A box-score row with a status took it from an earlier report.
    expect(statusSourceLabel({ status: "O", source: "box-score" })).toBe("Earlier report");
    expect(statusSourceLabel({ status: null, source: "box-score" })).toBe("Box scores");
    expect(statusSourceText({ status: "O", source: "report", gamesMissed: 0 }, "5:30 PM ET")).toBe(
      "the NBA injury report of 5:30 PM ET covering this game",
    );
    const earlier = statusSourceText({ status: "O", source: "box-score", gamesMissed: 7 }, null);
    expect(earlier).toMatch(/^his team's latest earlier NBA injury report/);
    expect(earlier).toContain("missed his team's last 7 games");
    expect(earlier).not.toContain("not on the report");
    expect(statusSourceText({ status: null, source: "box-score", gamesMissed: 1 }, "1:30 AM ET")).toBe(
      "box scores, the model's inference: he missed his team's last game, and he is not on the report of 1:30 AM ET",
    );
  });
  it("cleans ESPN's capitals and the report's category prefix", () => {
    expect(espnReason("COACH'S DECISION")).toBe("Coach's decision");
    expect(espnReason("RIGHT ACL TEAR")).toBe("Right ACL tear");
    expect(espnReason(null)).toBe("No reason given");
    expect(reportReason("Injury/Illness - Left Ankle Sprain")).toBe("Left Ankle Sprain");
    expect(reportReason("G League - Two-Way")).toBe("G League - Two-Way");
    expect(formatShooting(0.5)).toBe("50.0");
    expect(formatShooting(null)).toBe("–");
  });
});

describe("player tables", () => {
  it("averages a team's own lines and leaves a player with no games empty", () => {
    const totals = logTotals(teamFile.players[0].log);
    expect(totals).toMatchObject({ games: 1, starts: 1, didNotPlay: 1 });
    expect(totals.perGame).toMatchObject({ minutes: 30, points: 20, rebounds: 5 });
    expect(totals.shooting).toEqual({ fieldGoal: 0.5, threePoint: 0.25, freeThrow: null });
    const roster = teamRoster(teamFile, index, lists);
    expect(roster.map((row) => row.athleteId)).toEqual(["100", "101"]);
    expect(roster[0]).toMatchObject({ impact: 2.359, score: -1.25, status: { label: "Missed last game" } });
    expect(roster[1]).toMatchObject({ games: 0, perGame: null, impact: null, score: null, status: null });
  });
  it("gives every index player his status on his own team's list", () => {
    const rows = playerTableRows(index, lists);
    expect(rows[0]).toMatchObject({ teamCode: "IND", status: { short: "Missed 1" } });
    expect(playerTableRows(index, null)[0].status).toBeNull();
  });
  it("builds the player page newest first with listings and the current status", () => {
    const page = buildPlayerPage({ athleteId: "100", index, teamFiles: [teamFile], lists });
    expect(page?.log.map((row) => row.gameId)).toEqual(["g2", "g1"]);
    expect(page?.log[0].entry.played).toBe(false);
    expect(page?.log[1].result).toEqual({ won: true, teamScore: 110, opponentScore: 100 });
    expect(page?.listings[0]).toMatchObject({ status: "O", played: false, opponentId: ATL });
    expect(page?.status).toMatchObject({ source: "box-score", points: 0 });
    expect(page).toMatchObject({ score: -1.25, scoreShare: 0.3, scorePublished: true });
    // Known only from a list: still a page; unknown everywhere: none.
    expect(buildPlayerPage({ athleteId: "200", index, teamFiles: [], lists })?.name).toBe("Tyrese Haliburton");
    expect(buildPlayerPage({ athleteId: "999", index, teamFiles: [teamFile], lists })).toBeNull();
  });
});

describe("548 score", () => {
  it("prints signed to one decimal with a true minus sign, and a dash without a score", () => {
    expect(formatScore(5.432)).toBe("+5.4");
    expect(formatScore(-1.249)).toBe("−1.2");
    expect(formatScore(-0.04)).toBe("0.0");
    expect(formatScore(0)).toBe("0.0");
    expect(formatScore(null)).toBe("–");
  });

  it("says how much of it comes from this season", () => {
    expect(scoreShareText(null)).toBeNull();
    expect(scoreShareText(0)).toMatch(/^None of it comes from this season/);
    expect(scoreShareText(0.004)).toMatch(/^Less than 1% of its weight/);
    expect(scoreShareText(0.418)).toMatch(/^About 42% of its weight/);
  });

  it("reads an index from before the score as no score, and a page says it is not published", () => {
    const { scoreLabel: _label, scoreModel: _model, ...older } = index;
    void _label;
    void _model;
    const legacy = { ...older, players: index.players.map(({ score: _s, scoreShare: _h, ...player }) => (void _s, void _h, player)) } as unknown as PlayerIndexFile;
    expect(playerTableRows(legacy, null)[0].score).toBeNull();
    expect(buildPlayerPage({ athleteId: "100", index: legacy, teamFiles: [teamFile], lists })).toMatchObject({
      score: null,
      scoreShare: null,
      scorePublished: false,
    });
  });
});

describe("injury lists", () => {
  it("prints points as the lists do", () => {
    expect(listPoints(2.117)).toBe("−2.1");
    expect(listPoints(0.034)).toBe("<0.1");
    expect(listPoints(0)).toBe("0");
  });
  it("names the source of each team's list", () => {
    const filed = blockFromList(lists.teams[0])!;
    expect(filed.sourceLabel).toBe("NBA report, 1:30 AM ET");
    expect(filed.note).toBeNull();
    expect(filed.rows.map((row) => [row.name, row.source, row.reason])).toEqual([
      ["Tyrese Haliburton", "report", "Left Hamstring Strain"],
      ["Henri Veesaar", "report", "G League - Two-Way"],
      ["Pascal Siakam", "box-score", null],
    ]);
    const unfiled = blockFromList(lists.teams[1])!;
    expect(unfiled).toMatchObject({ unfiled: true, sourceLabel: "Not yet submitted" });
    const noReport = blockFromList(lists.teams[2])!;
    expect(noReport.sourceLabel).toBe("No report yet");
    expect(noReport.rows[0].reason).toBe("Right High Ankle Sprain");
    expect(blockFromList({ ...lists.teams[0], nextGame: null })).toBeNull();
  });
  it("groups the next two dates by game and puts every other team below", () => {
    const view = buildInjuryReport({ lists, projections });
    expect(view.slates.map((slate) => [slate.etDate, slate.games.map((game) => game.gameId)])).toEqual([
      ["2026-11-04", ["g3", "g4"]],
      ["2026-11-05", ["g5"]],
    ]);
    // PHI's list covers its Nov 4 game; its Nov 5 side comes from the projection.
    const later = view.slates[1].games[0];
    expect(later.home).toMatchObject({ complete: false, rows: [{ name: "Joel Embiid", source: "projection", pointsText: "−0.5" }] });
    expect(later.away.complete).toBe(false);
    expect(view.others.map((block) => block.teamId)).toEqual([ORL]);
    expect(view.latestReportAt).toBe("2026-11-04T01:30");
  });
  it("still groups by game when projections are not published", () => {
    const view = buildInjuryReport({ lists, projections: null });
    expect(view.slates[0].games.map((game) => [game.awayId, game.homeId])).toEqual([
      [ATL, IND],
      [DET, PHI],
    ]);
    // DET's list covers Nov 4, so its Nov 6 side waits for that game.
    expect(view.slates[1].games.map((game) => game.gameId)).toEqual(["g9"]);
    expect(view.slates[1].games[0].away).toMatchObject({ complete: false, rows: [], sourceLabel: "Not published yet" });
    expect(view.others).toEqual([]);
  });
  it("states a day's basis", () => {
    const report = { kind: "report" as const, reportAt: "2026-11-04T01:30", stale: false };
    expect(basisSummary([report, report], "2026-11-04")).toMatch(/report of 1:30 AM ET, counted as a seal/);
    expect(basisSummary([report, { kind: "current-absences" }], "2026-11-04")).toMatch(/current absences otherwise/);
    expect(basisSummary([{ kind: "current-absences" }], "2026-11-05")).toMatch(/No NBA injury report covers this day yet/);
  });
  it("carries a published projection's injury term onto the page", () => {
    const shown = fromPublished(projections.games[2]);
    expect(shown).toMatchObject({ withInjuries: true, absencePoints: { home: 0.5, away: 0 }, basis: { kind: "current-absences" } });
  });
});
