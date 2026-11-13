import { describe, expect, it } from "vitest";
import type { PlayerIndexEntry, PlayerIndexFile, PlayerLogEntry, TeamPlayer, TeamPlayersFile } from "@/lib/season/player-stats";
import { SCORE_LABEL } from "@/lib/season/player-stats";
import type { GameStatus } from "@/lib/season/types";
import type { AbsencePlayer, AbsenceSide, AbsenceSides } from "@/lib/view/injuries";
import { buildSquads, SQUAD_ROWS_SHOWN, type SquadSide } from "@/lib/view/squads";

const IND = "11";
const ATL = "1";
const GAME = "g9";

const line = (gameId: string, minutes: number, points: number, starter = true): PlayerLogEntry => ({
  gameId,
  etDate: "2026-11-01",
  opponentId: ATL,
  home: true,
  played: true,
  starter,
  minutes,
  points,
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
  plusMinus: 0,
});

const dnp = (gameId: string, reason: string | null): PlayerLogEntry => ({
  gameId,
  etDate: "2026-11-01",
  opponentId: ATL,
  home: true,
  played: false,
  reason,
});

const player = (athleteId: string, name: string, log: PlayerLogEntry[], position: string | null = "G"): TeamPlayer => ({
  athleteId,
  name,
  position,
  log,
  injuries: [],
});

const teamFile = (teamId: string, players: TeamPlayer[], gameIds: string[] = []): TeamPlayersFile => ({
  version: 1,
  season: 2027,
  seasonLabel: "2026-27",
  teamId,
  games: gameIds.map((gameId) => ({ gameId, etDate: "2026-11-01", opponentId: ATL, home: true, teamScore: 100, opponentScore: 90 })),
  players,
});

const entry = (athleteId: string, teamId: string, score: number | null): PlayerIndexEntry => ({
  athleteId,
  name: athleteId,
  position: "G",
  teamId,
  teamIds: [teamId],
  games: 1,
  starts: 1,
  didNotPlay: 0,
  perGame: null,
  totals: { fieldGoalsMade: 0, fieldGoalsAttempted: 0, threePointersMade: 0, threePointersAttempted: 0, freeThrowsMade: 0, freeThrowsAttempted: 0 },
  shooting: { fieldGoal: null, threePoint: null, freeThrow: null },
  reportListings: 0,
  reportListingsMissed: 0,
  impact: null,
  score,
  scoreShare: score === null ? null : 0.5,
  scoreBox: score,
  scoreOnCourt: score === null ? null : 0,
  lastEtDate: "2026-11-01",
});

const indexOf = (entries: PlayerIndexEntry[], extra: Partial<PlayerIndexFile> = {}): PlayerIndexFile => ({
  version: 1,
  season: 2027,
  seasonLabel: "2026-27",
  throughEtDate: "2026-11-12",
  storedGames: 10,
  impactLabel: "",
  scoreLabel: "Label from the index.",
  scoreModel: "score-test",
  scoreCheckpoint: null,
  players: entries,
  ...extra,
});

const absenceSide = (teamId: string, players: AbsencePlayer[]): AbsenceSide => ({
  teamId,
  points: 0,
  filing: "filed",
  players,
  groups: [],
  others: null,
});

const game = (status: GameStatus, absences: AbsenceSides | null = null) => ({
  id: GAME,
  status,
  homeId: IND,
  awayId: ATL,
  absences,
});

function roster(side: SquadSide) {
  if (side.kind !== "roster") throw new Error(`expected roster, got ${side.kind}`);
  return [...side.shown, ...side.more];
}

function playedOf(side: SquadSide) {
  if (side.kind !== "played") throw new Error(`expected played, got ${side.kind}`);
  return side;
}

describe("roster mode", () => {
  // File order is total minutes: A (3 x 20 = 60), B (2 x 25 = 50), C (1 x 25 = 25), D (no games), E (one DNP).
  const file = teamFile(IND, [
    player("a", "Alpha", [line("g1", 20, 10), line("g2", 20, 10), line("g3", 20, 10)]),
    player("b", "Bravo", [line("g1", 25, 12), line("g2", 25, 14)]),
    player("c", "Charlie", [line("g1", 25, 5)]),
    player("d", "Delta", []),
    player("e", "Echo", [dnp("g1", "REST")]),
  ]);
  const index = indexOf(["a", "b", "c", "d", "e"].map((id) => entry(id, IND, 1)));

  it("orders by minutes per game, ties by games played, players without a game last by name", () => {
    const squads = buildSquads({ game: game("scheduled"), index, awayFile: null, homeFile: file });
    const rows = roster(squads.home);
    expect(rows.map((row) => row.athleteId)).toEqual(["b", "c", "a", "d", "e"]);
    expect(rows[0]).toMatchObject({ minutes: 25, points: 13, games: 2 });
    expect(rows[3]).toMatchObject({ minutes: null, points: null, games: 0 });
    expect(squads.figures).toBe("season");
  });

  it("does not keep the file's total-minutes order", () => {
    const squads = buildSquads({ game: game("scheduled"), index, awayFile: null, homeFile: file });
    expect(roster(squads.home).map((row) => row.athleteId)).not.toEqual(file.players.map((row) => row.athleteId));
  });

  it("ties on minutes and games fall back to name, then athlete ID", () => {
    const tied = teamFile(IND, [
      player("z2", "Same", [line("g1", 30, 1)]),
      player("z1", "Same", [line("g1", 30, 1)]),
      player("y", "Able", [line("g1", 30, 1)]),
    ]);
    const squads = buildSquads({
      game: game("scheduled"),
      index: indexOf(["z1", "z2", "y"].map((id) => entry(id, IND, 0))),
      awayFile: null,
      homeFile: tied,
    });
    expect(roster(squads.home).map((row) => row.athleteId)).toEqual(["y", "z1", "z2"]);
  });

  it("drops a player the index places on another team, and one with no index entry", () => {
    const squads = buildSquads({
      game: game("scheduled"),
      index: indexOf([entry("a", IND, 1), entry("b", ATL, 1)]),
      awayFile: null,
      homeFile: file,
    });
    expect(roster(squads.home).map((row) => row.athleteId)).toEqual(["a"]);
  });

  it("shows ten rows and keeps the rest behind the toggle", () => {
    const many = teamFile(
      IND,
      Array.from({ length: 13 }, (_, i) => player(`p${i}`, `Player ${String(i).padStart(2, "0")}`, [line("g1", 40 - i, 1)])),
    );
    const squads = buildSquads({
      game: game("scheduled"),
      index: indexOf(many.players.map((row) => entry(row.athleteId, IND, 0))),
      awayFile: null,
      homeFile: many,
    });
    const side = squads.home;
    if (side.kind !== "roster") throw new Error("roster");
    expect(side.shown).toHaveLength(SQUAD_ROWS_SHOWN);
    expect(side.more.map((row) => row.athleteId)).toEqual(["p10", "p11", "p12"]);
  });

  it("is roster mode while the game is in progress", () => {
    const squads = buildSquads({ game: game("in-progress"), index, awayFile: null, homeFile: file });
    expect(squads.home.kind).toBe("roster");
    expect(squads.inProgress).toBe(true);
  });

  it("is unavailable without the index", () => {
    const squads = buildSquads({ game: game("scheduled"), index: null, awayFile: null, homeFile: file });
    expect(squads.home.kind).toBe("unavailable");
    expect(squads.away.kind).toBe("unavailable");
    expect(squads.showsScores).toBe(false);
  });

  it("reads an older index entry without score keys as no score", () => {
    const old = { ...entry("a", IND, 1) } as Partial<PlayerIndexEntry>;
    delete old.score;
    delete old.scoreShare;
    delete old.scoreBox;
    delete old.scoreOnCourt;
    const squads = buildSquads({
      game: game("scheduled"),
      index: indexOf([old as PlayerIndexEntry], { scoreLabel: "" }),
      awayFile: null,
      homeFile: file,
    });
    expect(roster(squads.home)[0].score).toBeNull();
    expect(squads.scoreLabel).toBe(SCORE_LABEL);
  });
});

describe("status tags", () => {
  const home = teamFile(IND, [
    player("a", "Alpha", [line("g1", 30, 1)]),
    player("b", "Bravo", [line("g1", 29, 1)]),
    player("c", "Charlie", [line("g1", 28, 1)]),
    player("d", "Delta", [line("g1", 27, 1)]),
    player("e", "Echo", [line("g1", 26, 1)]),
  ]);
  const away = teamFile(ATL, [player("x", "Xray", [line("g1", 30, 1)])]);
  const index = indexOf([...["a", "b", "c", "d", "e"].map((id) => entry(id, IND, 1)), entry("x", ATL, 1)]);
  const absences: AbsenceSides = {
    home: absenceSide(IND, [
      { athleteId: "a", name: "Alpha", status: "O", points: 2 },
      { athleteId: "b", name: "Bravo", status: null, points: 1 },
      { athleteId: "c", name: "Charlie", status: "A", points: 0 },
      { athleteId: null, name: "Delta", status: "Q", points: 0 },
      { athleteId: "zz", name: "Unknown", status: "D", points: 0 },
    ]),
    away: absenceSide(ATL, [{ athleteId: "e", name: "Echo", status: "O", points: 1 }]),
  };
  const squads = buildSquads({ game: game("scheduled", absences), index, awayFile: away, homeFile: home });
  const tag = (id: string) => roster(squads.home).find((row) => row.athleteId === id)?.tag ?? null;

  it("matches on athlete ID within the same side", () => {
    expect(tag("a")).toEqual({ label: "Out", tone: "bad" });
    expect(tag("c")).toEqual({ label: "Available", tone: "quiet" });
  });

  it("labels a box-score inference as missing the last game", () => {
    expect(tag("b")).toEqual({ label: "Missed last game", tone: "quiet" });
  });

  it("never matches a null athlete ID or the other side's list", () => {
    expect(tag("d")).toBeNull();
    expect(tag("e")).toBeNull();
  });

  it("gives an unmatched player no tag and shows no row for an unmatched listing", () => {
    expect(roster(squads.away)[0].tag).toBeNull();
    expect(roster(squads.home).map((row) => row.athleteId)).not.toContain("zz");
  });
});

describe("played mode", () => {
  const file = teamFile(
    IND,
    [
      player("bench1", "Zed", [line("g1", 40, 30), line(GAME, 22, 9, false)]),
      player("start1", "Moe", [line(GAME, 30, 14, true)]),
      player("start2", "Al", [line(GAME, 36, 20, true)]),
      player("bench2", "Bo", [line(GAME, 22, 4, false)]),
      player("sat1", "Cy", [dnp(GAME, "COACH'S DECISION")]),
      player("sat2", "Ab", [dnp(GAME, null)]),
      player("other", "Not In This Game", [line("g1", 30, 10)]),
    ],
    ["g1", GAME],
  );

  it("lists starters then bench by minutes, ties by name, with this game's figures", () => {
    const squads = buildSquads({
      game: game("final"),
      index: indexOf([entry("start2", IND, 2.5)]),
      awayFile: null,
      homeFile: file,
    });
    const side = playedOf(squads.home);
    expect(side.played.map((row) => row.athleteId)).toEqual(["start2", "start1", "bench2", "bench1"]);
    expect(side.played[0]).toMatchObject({ minutes: 36, points: 20, starter: true, score: 2.5 });
    expect(side.played[3]).toMatchObject({ minutes: 22, points: 9, starter: false, score: null });
    expect(squads.figures).toBe("game");
  });

  it("separates did-not-play rows and handles a null reason", () => {
    const side = playedOf(buildSquads({ game: game("final"), index: null, awayFile: null, homeFile: file }).home);
    expect(side.didNotPlay).toEqual([
      { athleteId: "sat2", name: "Ab", position: "G", reason: null },
      { athleteId: "sat1", name: "Cy", position: "G", reason: "Coach's decision" },
    ]);
  });

  it("keeps a player who has since moved teams", () => {
    const side = playedOf(
      buildSquads({ game: game("final"), index: indexOf([entry("start1", ATL, 1)]), awayFile: null, homeFile: file }).home,
    );
    expect(side.played.find((row) => row.athleteId === "start1")?.score).toBe(1);
  });

  it("works without the index, with no scores", () => {
    const squads = buildSquads({ game: game("final"), index: null, awayFile: null, homeFile: file });
    expect(playedOf(squads.home).played.every((row) => row.score === null)).toBe(true);
    expect(squads.away.kind).toBe("unavailable");
  });

  it("finds the game through a player's log when the games list lacks it", () => {
    const logOnly = { ...file, games: [] };
    expect(buildSquads({ game: game("final"), index: null, awayFile: null, homeFile: logOnly }).home.kind).toBe("played");
  });

  it("is not-stored, never the roster, for a final game without stored lines", () => {
    const later = teamFile(IND, [player("a", "Alpha", [line("g1", 30, 1)])], ["g1"]);
    const squads = buildSquads({ game: game("final"), index: indexOf([entry("a", IND, 1)]), awayFile: null, homeFile: later });
    expect(squads.home.kind).toBe("not-stored");
    expect(squads.figures).toBeNull();
  });

  it("is unavailable with no team file", () => {
    expect(buildSquads({ game: game("final"), index: null, awayFile: null, homeFile: null }).home.kind).toBe("unavailable");
  });
});
