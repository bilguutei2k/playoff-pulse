// Player data for the live season: full box-score lines as ESPN's game summary gives
// them (with its did-not-play flag and reason), each player's listings on the stored NBA
// injury reports, and the compact files the site reads, derived from both. Pure: no
// fetch, no file access.
//
// None of this is a model input. The model reads only the compact store in
// `box-scores.ts` (data/live/boxscores/{year}.json), which this module never touches.
// Player identity is ESPN's athlete ID, as in the model. No photos are stored.
//
// Stored (by the job, data/live/players/{seasonLabel}/{etDate}.json): `PlayerGamesDay`.
// Derived for the site (data/live/site/{seasonLabel}/players/):
//   index.json            `PlayerIndexFile`: every player, per-game averages, shooting,
//                         injury-report listings, the model's "548 impact" and the
//                         experimental "548 score" (injected; this folder never imports
//                         src/lib/score/);
//   teams/{teamId}.json   `TeamPlayersFile`: the team's players with every game line or
//                         did-not-play row for that team, and their report listings.

import type { StatusCode } from "@/lib/season/availability";
import { etWallClockOf } from "@/lib/season/dates";
import { latestReport, type LiveReportDay } from "@/lib/season/live-reports";
import type { SeasonGame } from "@/lib/season/types";

// ---------------------------------------------------------------------------
// Full box-score lines
// ---------------------------------------------------------------------------

/** The counting stats of one player's game. Every value is a whole number except minutes. */
export type PlayerCounting = {
  minutes: number;
  points: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  threePointersMade: number;
  threePointersAttempted: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
  plusMinus: number;
};

/** One player who played, as parsed from ESPN's summary. */
export type PlayerBoxLine = PlayerCounting & {
  athleteId: string;
  name: string;
  position: string | null;
  starter: boolean;
};

/** One player ESPN lists as did not play, with its reason ("COACH'S DECISION", an injury). */
export type PlayerDidNotPlay = {
  athleteId: string;
  name: string;
  position: string | null;
  /** ESPN's reason, kept only when ESPN flags the player did-not-play. */
  reason: string | null;
};

/** A parsed game summary: per team ID, who played and who did not. */
export type PlayerBoxScore = Record<string, { lines: PlayerBoxLine[]; didNotPlay: PlayerDidNotPlay[] }>;

/** Column order of `StoredPlayerLine`, for readers of the stored files. */
export const PLAYER_LINE_COLUMNS = [
  "athleteId",
  "starter",
  "minutes",
  "points",
  "offensiveRebounds",
  "defensiveRebounds",
  "assists",
  "steals",
  "blocks",
  "turnovers",
  "fouls",
  "fieldGoalsMade",
  "fieldGoalsAttempted",
  "threePointersMade",
  "threePointersAttempted",
  "freeThrowsMade",
  "freeThrowsAttempted",
  "plusMinus",
] as const;

/** A stored line, in `PLAYER_LINE_COLUMNS` order; `starter` is 1 or 0, minutes to 0.1. */
export type StoredPlayerLine = [
  athleteId: string,
  starter: 0 | 1,
  minutes: number,
  points: number,
  offensiveRebounds: number,
  defensiveRebounds: number,
  assists: number,
  steals: number,
  blocks: number,
  turnovers: number,
  fouls: number,
  fieldGoalsMade: number,
  fieldGoalsAttempted: number,
  threePointersMade: number,
  threePointersAttempted: number,
  freeThrowsMade: number,
  freeThrowsAttempted: number,
  plusMinus: number,
];

/** A stored did-not-play row: athlete ID and ESPN's reason. */
export type StoredDidNotPlay = [athleteId: string, reason: string | null];

export type StoredPlayerGame = {
  gameId: string;
  etDate: string;
  homeId: string;
  awayId: string;
  homeScore: number;
  awayScore: number;
  /** Team ID to its players: lines of those who played, rows of those who did not. */
  teams: Record<string, { lines: StoredPlayerLine[]; didNotPlay: StoredDidNotPlay[] }>;
};

/** One ET date's stored games: data/live/players/{seasonLabel}/{etDate}.json. */
export type PlayerGamesDay = {
  version: 1;
  etDate: string;
  /** Display name and position of every athlete in the day's games. */
  athletes: Record<string, { name: string; position: string | null }>;
  /** Game ID to the stored game. */
  games: Record<string, StoredPlayerGame>;
};

export function emptyPlayerGamesDay(etDate: string): PlayerGamesDay {
  return { version: 1, etDate, athletes: {}, games: {} };
}

export function toStoredLine(line: PlayerBoxLine): StoredPlayerLine {
  return [
    line.athleteId,
    line.starter ? 1 : 0,
    Number(line.minutes.toFixed(1)),
    line.points,
    line.offensiveRebounds,
    line.defensiveRebounds,
    line.assists,
    line.steals,
    line.blocks,
    line.turnovers,
    line.fouls,
    line.fieldGoalsMade,
    line.fieldGoalsAttempted,
    line.threePointersMade,
    line.threePointersAttempted,
    line.freeThrowsMade,
    line.freeThrowsAttempted,
    line.plusMinus,
  ];
}

export function fromStoredLine(line: StoredPlayerLine): PlayerCounting & { athleteId: string; starter: boolean } {
  const [
    athleteId,
    starter,
    minutes,
    points,
    offensiveRebounds,
    defensiveRebounds,
    assists,
    steals,
    blocks,
    turnovers,
    fouls,
    fieldGoalsMade,
    fieldGoalsAttempted,
    threePointersMade,
    threePointersAttempted,
    freeThrowsMade,
    freeThrowsAttempted,
    plusMinus,
  ] = line;
  return {
    athleteId,
    starter: starter === 1,
    minutes,
    points,
    offensiveRebounds,
    defensiveRebounds,
    assists,
    steals,
    blocks,
    turnovers,
    fouls,
    fieldGoalsMade,
    fieldGoalsAttempted,
    threePointersMade,
    threePointersAttempted,
    freeThrowsMade,
    freeThrowsAttempted,
    plusMinus,
  };
}

/** Points in a team's stored lines miss its final score by more than this: not stored. */
export const MAX_PLAYER_POINT_GAP = 5;

/**
 * Checks a parsed summary against the game and returns it in stored form. Throws when it
 * names other teams, a team has nobody who played, or its points miss the final score.
 */
export function storePlayerGame(game: SeasonGame, box: PlayerBoxScore): StoredPlayerGame {
  if (game.homeScore === null || game.awayScore === null) throw new Error(`game ${game.id} has no final score`);
  const teams: StoredPlayerGame["teams"] = {};
  for (const [teamId, score] of [
    [game.homeId, game.homeScore],
    [game.awayId, game.awayScore],
  ] as const) {
    const team = box[teamId];
    if (!team) throw new Error(`team ${teamId} is not in the summary`);
    if (team.lines.length === 0) throw new Error(`team ${teamId} has nobody who played`);
    const points = team.lines.reduce((total, line) => total + line.points, 0);
    if (Math.abs(points - score) > MAX_PLAYER_POINT_GAP) {
      throw new Error(`team ${teamId} line points ${points}, final score ${score}`);
    }
    teams[teamId] = {
      lines: team.lines.map(toStoredLine),
      didNotPlay: team.didNotPlay.map((row) => [row.athleteId, row.reason]),
    };
  }
  const extra = Object.keys(box).filter((teamId) => teamId !== game.homeId && teamId !== game.awayId);
  if (extra.length > 0) throw new Error(`summary has other team(s) ${extra.join(", ")}`);
  return {
    gameId: game.id,
    etDate: game.etDate,
    homeId: game.homeId,
    awayId: game.awayId,
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    teams,
  };
}

/** Adds a stored game to its day, with its athletes' names and positions. */
export function addPlayerGame(day: PlayerGamesDay, stored: StoredPlayerGame, box: PlayerBoxScore): void {
  for (const team of Object.values(box)) {
    for (const row of [...team.lines, ...team.didNotPlay]) {
      day.athletes[row.athleteId] = { name: row.name, position: row.position };
    }
  }
  day.games[stored.gameId] = stored;
}

// ---------------------------------------------------------------------------
// Injury-report listings
// ---------------------------------------------------------------------------

/** A player listed on the last usable report before a finished game's tip. */
export type InjuryListing = {
  gameId: string;
  etDate: string;
  teamId: string;
  /** Header time of that report, Eastern wall clock. */
  reportAt: string;
  status: StatusCode;
  /** The report's reason text, verbatim. */
  reason: string;
  /** Whether he then played: a line in the stored box score. Null until it is stored. */
  played: boolean | null;
};

/** A listing with the athlete the printed name resolved to. */
export type ResolvedListing = InjuryListing & { athleteId: string };

/**
 * Every listing of a resolved player on the report that covered each finished game: the
 * latest usable report at or before tip in the game's ET-date file, the one the replay
 * learns from. Names the report prints that match nobody are left out.
 */
export function injuryListings(input: {
  games: readonly SeasonGame[];
  reportDay: (etDate: string) => LiveReportDay | null;
  resolve: (teamId: string, printed: string) => string | null;
  playedIn: (gameId: string, teamId: string, athleteId: string) => boolean | null;
}): ResolvedListing[] {
  const listings: ResolvedListing[] = [];
  for (const game of input.games) {
    if (game.status !== "final") continue;
    const found = latestReport(input.reportDay(game.etDate), etWallClockOf(game.tipUtc));
    if (!found) continue;
    for (const [teamId, printed, status, reason] of found.report.rows) {
      if (teamId !== game.homeId && teamId !== game.awayId) continue;
      const athleteId = input.resolve(teamId, printed);
      if (athleteId === null) continue;
      listings.push({
        athleteId,
        gameId: game.id,
        etDate: game.etDate,
        teamId,
        reportAt: found.at,
        status,
        reason,
        played: input.playedIn(game.id, teamId, athleteId),
      });
    }
  }
  return listings;
}

// ---------------------------------------------------------------------------
// Site files
// ---------------------------------------------------------------------------

/** The label the site must show beside a 548 impact number. */
export const IMPACT_LABEL =
  "548 impact: the model's estimate of the points of margin his team loses per game without him. Not validated per player.";

/**
 * The label the site must show beside a 548 score. The score is computed in
 * src/lib/score/live.ts and injected by the job; it is never a forecast input.
 */
export const SCORE_LABEL =
  "548 score: experimental, from box scores only. An estimate of the points per 100 possessions his team gains with him against an average player. Not validated per player, and not used by the forecast.";

export type PlayerAverages = {
  minutes: number;
  points: number;
  rebounds: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  plusMinus: number;
};

export type ShootingTotals = {
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  threePointersMade: number;
  threePointersAttempted: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
};

export type PlayerIndexEntry = {
  athleteId: string;
  name: string;
  position: string | null;
  /** His team in his latest stored game, played or not; for a report-only player, the listing team. */
  teamId: string;
  /** Every team he appeared for this season, first to last. */
  teamIds: string[];
  /** Games with a line (he played). */
  games: number;
  starts: number;
  /** Games ESPN listed him as did not play. */
  didNotPlay: number;
  /** Per game played, to one decimal; null with no games. */
  perGame: PlayerAverages | null;
  totals: ShootingTotals;
  /** Made over attempted, to three decimals; null with no attempts. */
  shooting: { fieldGoal: number | null; threePoint: number | null; freeThrow: number | null };
  /** Finished games he was listed on the covering injury report. */
  reportListings: number;
  /** Of those, games he then missed (no line in the stored box score). */
  reportListingsMissed: number;
  /**
   * 548 impact: the model's points of margin lost per game while he is out, beta times
   * `lostValue` in the published replay's player book, to three decimals. Null when the
   * model has no record of him. The model's estimate, never validated per player.
   */
  impact: number | null;
  /**
   * 548 score: points per 100 possessions against an average player, from box scores
   * (this season's to date and the last three seasons'), to three decimals. Null when he
   * has no box-score piece at all, or when the score could not be computed this run
   * (`scoreModel` null). Experimental; never validated per player; not a forecast input.
   */
  score: number | null;
  /** The share of the score's weight from this season, 0 to 1, three decimals; null with no score. */
  scoreShare: number | null;
  /** ET date of his latest stored game or listing. */
  lastEtDate: string;
};

export type PlayerIndexFile = {
  version: 1;
  season: number;
  seasonLabel: string;
  /** Latest ET date with a stored game; null before the first. */
  throughEtDate: string | null;
  /** Finished games of the season with a stored line set. */
  storedGames: number;
  impactLabel: string;
  scoreLabel: string;
  /** The score's model version (`SCORE_MODEL_VERSION`); null when no score was computed this run. */
  scoreModel: string | null;
  /** Sorted by name, then athlete ID. */
  players: PlayerIndexEntry[];
};

/** One game of a player's log for one team. */
export type PlayerLogEntry =
  | (PlayerCounting & {
      gameId: string;
      etDate: string;
      opponentId: string;
      home: boolean;
      played: true;
      starter: boolean;
    })
  | {
      gameId: string;
      etDate: string;
      opponentId: string;
      home: boolean;
      played: false;
      /** ESPN's did-not-play reason, such as "COACH'S DECISION" or an injury. */
      reason: string | null;
    };

export type TeamPlayer = {
  athleteId: string;
  name: string;
  position: string | null;
  /** Oldest first: every stored game in which ESPN lists him for this team. */
  log: PlayerLogEntry[];
  /** Oldest first: his listings for this team on the covering reports of finished games. */
  injuries: InjuryListing[];
};

export type TeamPlayersFile = {
  version: 1;
  season: number;
  seasonLabel: string;
  teamId: string;
  /** The team's stored games, oldest first. */
  games: Array<{
    gameId: string;
    etDate: string;
    opponentId: string;
    home: boolean;
    teamScore: number;
    opponentScore: number;
  }>;
  /** Most minutes first, then by name. */
  players: TeamPlayer[];
};

const one = (value: number) => Number(value.toFixed(1));
const three = (value: number) => Number(value.toFixed(3));
const ratio = (made: number, attempted: number) => (attempted > 0 ? three(made / attempted) : null);

/**
 * The player index and per-team files from the stored days and the report listings.
 * `impact` gives the 548 impact by athlete ID; `score` the 548 score and its share from
 * this season (both already rounded), under `scoreModel` (null: no score this run, so
 * every score is null); `nameOf` names report-only players.
 * Deterministic: the same inputs give the same bytes.
 */
export function derivePlayerFiles(input: {
  season: number;
  seasonLabel: string;
  days: readonly PlayerGamesDay[];
  listings: readonly ResolvedListing[];
  impact: (athleteId: string) => number | null;
  score: (athleteId: string) => { score: number; share: number } | null;
  scoreModel: string | null;
  nameOf: (athleteId: string) => string | undefined;
}): { index: PlayerIndexFile; teams: Map<string, TeamPlayersFile> } {
  const days = [...input.days].sort((a, b) => a.etDate.localeCompare(b.etDate));
  const athletes = new Map<string, { name: string; position: string | null }>();
  for (const day of days) for (const [id, athlete] of Object.entries(day.athletes)) athletes.set(id, athlete);
  const games = days
    .flatMap((day) => Object.values(day.games))
    .sort((a, b) => a.etDate.localeCompare(b.etDate) || a.gameId.localeCompare(b.gameId));

  type Accumulator = {
    athleteId: string;
    teamIds: string[];
    teamId: string;
    lastEtDate: string;
    games: number;
    starts: number;
    didNotPlay: number;
    sums: PlayerCounting;
    listings: number;
    listingsMissed: number;
  };
  const zero = (): PlayerCounting => ({
    minutes: 0,
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
    plusMinus: 0,
  });
  const players = new Map<string, Accumulator>();
  const touch = (athleteId: string, teamId: string, etDate: string): Accumulator => {
    let player = players.get(athleteId);
    if (!player) {
      player = {
        athleteId,
        teamIds: [],
        teamId,
        lastEtDate: etDate,
        games: 0,
        starts: 0,
        didNotPlay: 0,
        sums: zero(),
        listings: 0,
        listingsMissed: 0,
      };
      players.set(athleteId, player);
    }
    if (!player.teamIds.includes(teamId)) player.teamIds.push(teamId);
    if (etDate >= player.lastEtDate) {
      player.lastEtDate = etDate;
      player.teamId = teamId;
    }
    return player;
  };

  type TeamAccumulator = {
    file: TeamPlayersFile;
    players: Map<string, TeamPlayer & { minutes: number }>;
  };
  const teams = new Map<string, TeamAccumulator>();
  const teamOf = (teamId: string): TeamAccumulator => {
    let team = teams.get(teamId);
    if (!team) {
      team = {
        file: { version: 1, season: input.season, seasonLabel: input.seasonLabel, teamId, games: [], players: [] },
        players: new Map(),
      };
      teams.set(teamId, team);
    }
    return team;
  };
  const athleteName = (athleteId: string) =>
    athletes.get(athleteId)?.name ?? input.nameOf(athleteId) ?? athleteId;
  const teamPlayer = (team: TeamAccumulator, athleteId: string) => {
    let player = team.players.get(athleteId);
    if (!player) {
      player = {
        athleteId,
        name: athleteName(athleteId),
        position: athletes.get(athleteId)?.position ?? null,
        log: [],
        injuries: [],
        minutes: 0,
      };
      team.players.set(athleteId, player);
    }
    return player;
  };

  for (const game of games) {
    for (const [teamId, side] of Object.entries(game.teams)) {
      const home = teamId === game.homeId;
      const opponentId = home ? game.awayId : game.homeId;
      const team = teamOf(teamId);
      team.file.games.push({
        gameId: game.gameId,
        etDate: game.etDate,
        opponentId,
        home,
        teamScore: home ? game.homeScore : game.awayScore,
        opponentScore: home ? game.awayScore : game.homeScore,
      });
      for (const stored of side.lines) {
        const line = fromStoredLine(stored);
        const player = touch(line.athleteId, teamId, game.etDate);
        player.games += 1;
        if (line.starter) player.starts += 1;
        for (const key of Object.keys(player.sums) as Array<keyof PlayerCounting>) player.sums[key] += line[key];
        const entry = teamPlayer(team, line.athleteId);
        entry.minutes += line.minutes;
        const { athleteId: _athleteId, starter, ...counting } = line;
        void _athleteId;
        entry.log.push({ gameId: game.gameId, etDate: game.etDate, opponentId, home, played: true, starter, ...counting });
      }
      for (const [athleteId, reason] of side.didNotPlay) {
        const player = touch(athleteId, teamId, game.etDate);
        player.didNotPlay += 1;
        teamPlayer(team, athleteId).log.push({
          gameId: game.gameId,
          etDate: game.etDate,
          opponentId,
          home,
          played: false,
          reason,
        });
      }
    }
  }

  const listings = [...input.listings].sort(
    (a, b) => a.etDate.localeCompare(b.etDate) || a.gameId.localeCompare(b.gameId) || a.teamId.localeCompare(b.teamId),
  );
  // Athlete IDs come from resolving printed names; keep one listing per player per game.
  const seen = new Set<string>();
  for (const listing of listings) {
    const { athleteId } = listing;
    const key = `${listing.gameId}:${athleteId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const player = touch(athleteId, listing.teamId, listing.etDate);
    player.listings += 1;
    if (listing.played === false) player.listingsMissed += 1;
    teamPlayer(teamOf(listing.teamId), athleteId).injuries.push(stripAthlete(listing));
  }

  const entries: PlayerIndexEntry[] = [...players.values()].map((player) => {
    const sums = player.sums;
    const score = input.scoreModel === null ? null : input.score(player.athleteId);
    const per = (value: number) => one(value / player.games);
    return {
      athleteId: player.athleteId,
      name: athleteName(player.athleteId),
      position: athletes.get(player.athleteId)?.position ?? null,
      teamId: player.teamId,
      teamIds: player.teamIds,
      games: player.games,
      starts: player.starts,
      didNotPlay: player.didNotPlay,
      perGame:
        player.games === 0
          ? null
          : {
              minutes: per(sums.minutes),
              points: per(sums.points),
              rebounds: per(sums.offensiveRebounds + sums.defensiveRebounds),
              offensiveRebounds: per(sums.offensiveRebounds),
              defensiveRebounds: per(sums.defensiveRebounds),
              assists: per(sums.assists),
              steals: per(sums.steals),
              blocks: per(sums.blocks),
              turnovers: per(sums.turnovers),
              fouls: per(sums.fouls),
              plusMinus: per(sums.plusMinus),
            },
      totals: {
        fieldGoalsMade: sums.fieldGoalsMade,
        fieldGoalsAttempted: sums.fieldGoalsAttempted,
        threePointersMade: sums.threePointersMade,
        threePointersAttempted: sums.threePointersAttempted,
        freeThrowsMade: sums.freeThrowsMade,
        freeThrowsAttempted: sums.freeThrowsAttempted,
      },
      shooting: {
        fieldGoal: ratio(sums.fieldGoalsMade, sums.fieldGoalsAttempted),
        threePoint: ratio(sums.threePointersMade, sums.threePointersAttempted),
        freeThrow: ratio(sums.freeThrowsMade, sums.freeThrowsAttempted),
      },
      reportListings: player.listings,
      reportListingsMissed: player.listingsMissed,
      impact: input.impact(player.athleteId),
      score: score ? score.score : null,
      scoreShare: score ? score.share : null,
      lastEtDate: player.lastEtDate,
    };
  });
  entries.sort((a, b) => a.name.localeCompare(b.name) || a.athleteId.localeCompare(b.athleteId));

  const teamFiles = new Map<string, TeamPlayersFile>();
  for (const teamId of [...teams.keys()].sort()) {
    const team = teams.get(teamId) as TeamAccumulator;
    team.file.players = [...team.players.values()]
      .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name) || a.athleteId.localeCompare(b.athleteId))
      .map((player) => ({
        athleteId: player.athleteId,
        name: player.name,
        position: player.position,
        log: player.log,
        injuries: player.injuries,
      }));
    teamFiles.set(teamId, team.file);
  }

  return {
    index: {
      version: 1,
      season: input.season,
      seasonLabel: input.seasonLabel,
      throughEtDate: days.filter((day) => Object.keys(day.games).length > 0).at(-1)?.etDate ?? null,
      storedGames: games.length,
      impactLabel: IMPACT_LABEL,
      scoreLabel: SCORE_LABEL,
      scoreModel: input.scoreModel,
      players: entries,
    },
    teams: teamFiles,
  };
}

function stripAthlete(listing: ResolvedListing): InjuryListing {
  const { gameId, etDate, teamId, reportAt, status, reason, played } = listing;
  return { gameId, etDate, teamId, reportAt, status, reason, played };
}
