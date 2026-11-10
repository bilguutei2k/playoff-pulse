// Players for the players table, the player page, team rosters and every player link.
// Display and box-score arithmetic only: sums and per-game averages of stored lines, and
// made-over-attempted shooting. The 548 impact and every injury number are the published
// files' own (src/lib/season/player-stats.ts, src/lib/season/projections.ts).

import type { StatusCode } from "@/lib/season/availability";
import type {
  InjuryListing,
  PlayerIndexEntry,
  PlayerIndexFile,
  PlayerLogEntry,
  TeamPlayersFile,
} from "@/lib/season/player-stats";
import type { TeamInjuriesFile, TeamInjuryList, TeamInjuryRow } from "@/lib/season/projections";
import { STATUS_LABELS } from "@/lib/utils/injuries";
import type { Tone } from "@/lib/view/card";
import { teamDisplay } from "@/lib/view/teams";

export function playerHref(athleteId: string): string {
  return `/players/${athleteId}`;
}

// ---------------------------------------------------------------------------
// Current status: a player's row on his team's list for its next game
// ---------------------------------------------------------------------------

export type CurrentStatus = {
  teamId: string;
  status: StatusCode | null;
  source: TeamInjuryRow["source"];
  reason: string | null;
  gamesMissed: number;
  /** The model's points for the next game. */
  points: number;
  nextGame: NonNullable<TeamInjuryList["nextGame"]>;
  /** Header time of the report covering that game, Eastern wall clock; null without one. */
  reportAt: string | null;
};

/** Each listed player's row on his team's list for its next game, by athlete ID. */
export function currentStatuses(lists: TeamInjuriesFile | null): Map<string, CurrentStatus> {
  const statuses = new Map<string, CurrentStatus>();
  for (const team of lists?.teams ?? []) {
    if (!team.nextGame) continue;
    for (const row of team.rows) {
      if (row.athleteId === null || statuses.has(row.athleteId)) continue;
      statuses.set(row.athleteId, {
        teamId: team.teamId,
        status: row.status,
        source: row.source,
        reason: row.reason,
        gamesMissed: row.gamesMissed,
        points: row.points,
        nextGame: team.nextGame,
        reportAt: team.report?.at ?? null,
      });
    }
  }
  return statuses;
}

export type StatusFilterKey = "O" | "D" | "Q" | "P" | "missed";

export type StatusView = {
  /** "Out", "Questionable", "Missed last 2 games". */
  label: string;
  /** For narrow cells: "Out", "Q", "Missed 2". */
  short: string;
  tone: Tone;
  /** Out first, then doubtful, questionable, missed, probable and available. */
  order: number;
  filter: StatusFilterKey;
};

const STATUS_ORDER: Record<StatusCode, number> = { O: 0, D: 1, Q: 2, P: 4, A: 5 };
const STATUS_TONE: Record<StatusCode, Tone> = { O: "bad", D: "warn", Q: "warn", P: "quiet", A: "quiet" };

function missedText(games: number): string {
  if (games <= 1) return "Missed last game";
  return `Missed last ${games} games`;
}

/**
 * How a list row's status reads. The label names where the status word comes from:
 * the report covering the game ("Out"), the team's latest earlier report ("Out (earlier
 * report)"; a box-score row carries a status only from an earlier report, when no report
 * covers the game), or, with no status at all, the box scores ("Missed last 2 games").
 */
export function statusView(row: Pick<TeamInjuryRow, "status" | "source" | "gamesMissed">): StatusView {
  if (row.status === null) {
    return {
      label: row.gamesMissed > 0 ? missedText(row.gamesMissed) : "Not listed",
      short: row.gamesMissed > 0 ? `Missed ${row.gamesMissed}` : "Not listed",
      tone: "quiet",
      order: 3,
      filter: "missed",
    };
  }
  const word = STATUS_LABELS[row.status];
  const fromCoveringReport = row.source === "report";
  return {
    label: fromCoveringReport ? word : `${word} (earlier report)`,
    short: word,
    tone: STATUS_TONE[row.status],
    order: STATUS_ORDER[row.status],
    filter: row.status === "A" ? "P" : row.status,
  };
}

/** Where a row's status comes from, as its source column reads: "NBA report", "Earlier report" or "Box scores". */
export function statusSourceLabel(row: Pick<TeamInjuryRow, "status" | "source">): "NBA report" | "Earlier report" | "Box scores" {
  if (row.source === "report") return "NBA report";
  return row.status !== null ? "Earlier report" : "Box scores";
}

/**
 * The sentence under a player's status tag: where the status comes from, in the same
 * terms as the tag. `reportTime` is the covering report's time as printed ("7:00 PM ET").
 */
export function statusSourceText(
  status: Pick<CurrentStatus, "status" | "source" | "gamesMissed">,
  reportTime: string | null,
): string {
  const missed =
    status.gamesMissed > 1
      ? `he missed his team's last ${status.gamesMissed} games`
      : status.gamesMissed === 1
        ? "he missed his team's last game"
        : null;
  if (status.source === "report") {
    return `the NBA injury report${reportTime ? ` of ${reportTime}` : ""} covering this game`;
  }
  if (status.status !== null) {
    return `his team's latest earlier NBA injury report, since no report covers this game yet${missed ? `; box scores also show ${missed}` : ""}`;
  }
  const notOn = reportTime ? `he is not on the report of ${reportTime}` : "no report covers this game yet";
  return `box scores, the model's inference: ${missed ?? "he missed recent games"}, and ${notOn}`;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** "53.2" for a made-over-attempted ratio, "–" with no attempts. */
export function formatShooting(ratio: number | null): string {
  return ratio === null ? "–" : (ratio * 100).toFixed(1);
}

/** A per-game average to one decimal, "–" with no games. */
export function formatAverage(value: number | null): string {
  return value === null ? "–" : value.toFixed(1);
}

/** 548 impact to one decimal, "–" when the model has no record of him. */
export function formatImpact(impact: number | null): string {
  return impact === null ? "–" : impact.toFixed(1);
}

/** Box-score minutes: whole minutes print whole, partial ones to one decimal. */
export function formatMinutes(minutes: number): string {
  return Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1);
}

/** "8–15" made and attempted. */
export function madeAttempted(made: number, attempted: number): string {
  return `${made}–${attempted}`;
}

const UPPER_WORDS = new Set(["ACL", "MCL", "PCL", "LCL", "AC", "MRI", "NBA", "G", "II", "III", "IV"]);

/** ESPN prints did-not-play reasons in capitals: "COACH'S DECISION" reads "Coach's decision". */
export function espnReason(reason: string | null): string {
  if (!reason) return "No reason given";
  const words = reason.trim().split(/(\s+)/);
  return words
    .map((word, index) => {
      const bare = word.replace(/[^A-Za-z]/g, "");
      if (UPPER_WORDS.has(bare.toUpperCase()) && bare.length > 0 && bare === bare.toUpperCase()) return word;
      const lower = word.toLowerCase();
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join("");
}

/** The NBA report's reason without its "Injury/Illness - " prefix; other categories stay whole. */
export function reportReason(reason: string | null): string | null {
  if (!reason) return null;
  return reason.replace(/^Injury\/Illness\s*-\s*/i, "").trim() || reason;
}

// ---------------------------------------------------------------------------
// Table rows: the players page and team rosters
// ---------------------------------------------------------------------------

export type StatLine = {
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
};

export type PlayerTableRow = {
  athleteId: string;
  name: string;
  position: string | null;
  teamId: string;
  teamCode: string;
  games: number;
  starts: number;
  /** Per game played; null with no games. */
  perGame: StatLine | null;
  shooting: { fieldGoal: number | null; threePoint: number | null; freeThrow: number | null };
  impact: number | null;
  /** On his team's list for its next game; null when not listed. */
  status: StatusView | null;
  /** On a team page: he has since played for another team (its code). */
  nowWith: string | null;
  /** That team's ID, for its link. */
  nowWithId: string | null;
};

function statusFor(statuses: Map<string, CurrentStatus>, athleteId: string, teamId: string): StatusView | null {
  const current = statuses.get(athleteId);
  if (!current || current.teamId !== teamId) return null;
  return statusView(current);
}

/** Every player in the index, for the players table. */
export function playerTableRows(index: PlayerIndexFile, lists: TeamInjuriesFile | null): PlayerTableRow[] {
  const statuses = currentStatuses(lists);
  return index.players.map((player) => ({
    athleteId: player.athleteId,
    name: player.name,
    position: player.position,
    teamId: player.teamId,
    teamCode: teamDisplay(player.teamId).code,
    games: player.games,
    starts: player.starts,
    perGame: player.perGame
      ? {
          minutes: player.perGame.minutes,
          points: player.perGame.points,
          rebounds: player.perGame.rebounds,
          assists: player.perGame.assists,
          steals: player.perGame.steals,
          blocks: player.perGame.blocks,
          turnovers: player.perGame.turnovers,
        }
      : null,
    shooting: player.shooting,
    impact: player.impact,
    status: statusFor(statuses, player.athleteId, player.teamId),
    nowWith: null,
    nowWithId: null,
  }));
}

const one = (value: number) => Number(value.toFixed(1));
const three = (value: number) => Number(value.toFixed(3));
const ratio = (made: number, attempted: number) => (attempted > 0 ? three(made / attempted) : null);

type PlayedEntry = Extract<PlayerLogEntry, { played: true }>;

/** Per-game averages and shooting from a player's lines for one team, rounded as the index rounds them. */
export function logTotals(log: readonly PlayerLogEntry[]): Pick<PlayerTableRow, "games" | "starts" | "perGame" | "shooting"> & {
  didNotPlay: number;
  totals: { fieldGoalsMade: number; fieldGoalsAttempted: number; threePointersMade: number; threePointersAttempted: number; freeThrowsMade: number; freeThrowsAttempted: number };
} {
  const played = log.filter((entry): entry is PlayedEntry => entry.played);
  const sum = (pick: (entry: PlayedEntry) => number) => played.reduce((total, entry) => total + pick(entry), 0);
  const games = played.length;
  const per = (value: number) => one(value / games);
  const totals = {
    fieldGoalsMade: sum((entry) => entry.fieldGoalsMade),
    fieldGoalsAttempted: sum((entry) => entry.fieldGoalsAttempted),
    threePointersMade: sum((entry) => entry.threePointersMade),
    threePointersAttempted: sum((entry) => entry.threePointersAttempted),
    freeThrowsMade: sum((entry) => entry.freeThrowsMade),
    freeThrowsAttempted: sum((entry) => entry.freeThrowsAttempted),
  };
  return {
    games,
    starts: played.filter((entry) => entry.starter).length,
    didNotPlay: log.length - games,
    perGame:
      games === 0
        ? null
        : {
            minutes: per(sum((entry) => entry.minutes)),
            points: per(sum((entry) => entry.points)),
            rebounds: per(sum((entry) => entry.offensiveRebounds + entry.defensiveRebounds)),
            assists: per(sum((entry) => entry.assists)),
            steals: per(sum((entry) => entry.steals)),
            blocks: per(sum((entry) => entry.blocks)),
            turnovers: per(sum((entry) => entry.turnovers)),
          },
    shooting: {
      fieldGoal: ratio(totals.fieldGoalsMade, totals.fieldGoalsAttempted),
      threePoint: ratio(totals.threePointersMade, totals.threePointersAttempted),
      freeThrow: ratio(totals.freeThrowsMade, totals.freeThrowsAttempted),
    },
    totals,
  };
}

/**
 * A team's roster with its own stats for this team (a traded player counts only his games
 * here), in the file's order: most minutes first. 548 impact comes from the index.
 */
export function teamRoster(
  file: TeamPlayersFile,
  index: PlayerIndexFile | null,
  lists: TeamInjuriesFile | null,
): PlayerTableRow[] {
  const statuses = currentStatuses(lists);
  const entries = new Map((index?.players ?? []).map((player) => [player.athleteId, player]));
  return file.players.map((player) => {
    const entry = entries.get(player.athleteId);
    const totals = logTotals(player.log);
    const movedTo = entry && entry.teamId !== file.teamId ? entry.teamId : null;
    return {
      athleteId: player.athleteId,
      name: player.name,
      position: player.position,
      teamId: file.teamId,
      teamCode: teamDisplay(file.teamId).code,
      games: totals.games,
      starts: totals.starts,
      perGame: totals.perGame,
      shooting: totals.shooting,
      impact: entry?.impact ?? null,
      status: statusFor(statuses, player.athleteId, file.teamId),
      nowWith: movedTo ? teamDisplay(movedTo).code : null,
      nowWithId: movedTo,
    };
  });
}

// ---------------------------------------------------------------------------
// The player page
// ---------------------------------------------------------------------------

export type GameLogRow = {
  gameId: string;
  etDate: string;
  teamId: string;
  opponentId: string;
  home: boolean;
  result: { won: boolean; teamScore: number; opponentScore: number } | null;
  entry: PlayerLogEntry;
};

export type ListingRow = InjuryListing & { opponentId: string | null; home: boolean | null };

export type PlayerPage = {
  athleteId: string;
  name: string;
  position: string | null;
  teamId: string;
  /** Every team he has appeared for, first to last. */
  teamIds: string[];
  /** Index summary; null for a player known only from an injury list. */
  entry: PlayerIndexEntry | null;
  /** Newest first, every team. */
  log: GameLogRow[];
  /** Newest first. */
  listings: ListingRow[];
  status: CurrentStatus | null;
  /** From the index, or the team list when he is not in it. */
  impact: number | null;
};

/**
 * Everything the player page shows, from his index entry, his teams' files and the team
 * lists. Null when no published file knows him.
 */
export function buildPlayerPage(input: {
  athleteId: string;
  index: PlayerIndexFile | null;
  teamFiles: readonly TeamPlayersFile[];
  lists: TeamInjuriesFile | null;
}): PlayerPage | null {
  const { athleteId } = input;
  const entry = input.index?.players.find((player) => player.athleteId === athleteId) ?? null;
  const status = currentStatuses(input.lists).get(athleteId) ?? null;
  const listRow = input.lists?.teams
    .flatMap((team) => team.rows)
    .find((row) => row.athleteId === athleteId);
  if (!entry && !listRow) return null;

  const log: GameLogRow[] = [];
  const listings: ListingRow[] = [];
  let position = entry?.position ?? null;
  let name = entry?.name ?? listRow?.name ?? athleteId;
  for (const file of input.teamFiles) {
    const player = file.players.find((candidate) => candidate.athleteId === athleteId);
    if (!player) continue;
    if (!entry) {
      name = player.name;
      position = player.position;
    }
    const games = new Map(file.games.map((game) => [game.gameId, game]));
    for (const logEntry of player.log) {
      const game = games.get(logEntry.gameId);
      log.push({
        gameId: logEntry.gameId,
        etDate: logEntry.etDate,
        teamId: file.teamId,
        opponentId: logEntry.opponentId,
        home: logEntry.home,
        result: game
          ? { won: game.teamScore > game.opponentScore, teamScore: game.teamScore, opponentScore: game.opponentScore }
          : null,
        entry: logEntry,
      });
    }
    for (const listing of player.injuries) {
      const game = games.get(listing.gameId);
      listings.push({ ...listing, opponentId: game?.opponentId ?? null, home: game?.home ?? null });
    }
  }
  const newestFirst = <T extends { etDate: string; gameId: string }>(a: T, b: T) =>
    b.etDate.localeCompare(a.etDate) || b.gameId.localeCompare(a.gameId);
  log.sort(newestFirst);
  listings.sort(newestFirst);
  const teamId = entry?.teamId ?? status?.teamId ?? input.teamFiles[0]?.teamId ?? "";
  return {
    athleteId,
    name,
    position,
    teamId,
    teamIds: entry?.teamIds ?? (teamId ? [teamId] : []),
    entry,
    log,
    listings,
    status,
    impact: entry?.impact ?? null,
  };
}

/** "Played", "Did not play" or "Not stored yet" for a listing's outcome. */
export function listingOutcome(played: boolean | null): { label: string; tone: Tone } {
  if (played === true) return { label: "Played", tone: "good" };
  if (played === false) return { label: "Did not play", tone: "bad" };
  return { label: "Box score not stored yet", tone: "quiet" };
}
