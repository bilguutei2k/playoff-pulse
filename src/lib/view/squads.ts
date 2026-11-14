// Both squads for the game page: who each team has (before and during the game) or who
// played (after it). Display bookkeeping only: per-game averages of stored lines, one
// game's lines, and the published 548 score as the index carries it. Nothing here ranks
// by the score, adds scores up or relates them to the team's rating.

import type { PlayerIndexEntry, PlayerIndexFile, PlayerLogEntry, TeamPlayersFile } from "@/lib/season/player-stats";
import { SCORE_LABEL } from "@/lib/season/player-stats";
import type { GameStatus } from "@/lib/season/types";
import { STATUS_LABELS } from "@/lib/utils/injuries";
import type { Tone } from "@/lib/view/card";
import type { AbsenceSide, AbsenceSides } from "@/lib/view/injuries";
import { espnReason, logTotals, STATUS_TONE } from "@/lib/view/players";

/** Rows shown before the "N more" toggle in roster mode. */
export const SQUAD_ROWS_SHOWN = 10;

export type SquadTag = { label: string; tone: Tone };

export type RosterRow = {
  athleteId: string;
  name: string;
  position: string | null;
  /** Games he played for this team this season. */
  games: number;
  /** Per game played for this team this season; null with no games. */
  minutes: number | null;
  points: number | null;
  /** 548 score from the index; null without one. */
  score: number | null;
  /** His status in this game's number (same side, matched on athlete ID); null when not on it. */
  tag: SquadTag | null;
};

export type PlayedRow = {
  athleteId: string;
  name: string;
  position: string | null;
  starter: boolean;
  /** This game's minutes and points. */
  minutes: number;
  points: number;
  /** 548 score published now; null without the index or without a score. */
  score: number | null;
};

export type DidNotPlayRow = {
  athleteId: string;
  name: string;
  position: string | null;
  /** ESPN's reason in sentence case; null when ESPN gave none. */
  reason: string | null;
};

export type SquadSide =
  | { kind: "roster"; teamId: string; shown: RosterRow[]; more: RosterRow[] }
  | { kind: "played"; teamId: string; played: PlayedRow[]; didNotPlay: DidNotPlayRow[] }
  | { kind: "not-stored"; teamId: string }
  | { kind: "unavailable"; teamId: string };

export type Squads = {
  away: SquadSide;
  home: SquadSide;
  /** What Min and Pts are: season averages (roster mode), this game (played mode), or nothing shown. */
  figures: "season" | "game" | null;
  /** True when either side prints a 548 score column. */
  showsScores: boolean;
  /** The index's own label, else SCORE_LABEL. */
  scoreLabel: string;
  /** The index's latest stored game date; null without one. */
  throughEtDate: string | null;
  inProgress: boolean;
};

type SquadGame = {
  id: string;
  status: GameStatus;
  homeId: string;
  awayId: string;
  absences: AbsenceSides | null;
};

const byName = (a: { name: string; athleteId: string }, b: { name: string; athleteId: string }) =>
  a.name.localeCompare(b.name, "en") || a.athleteId.localeCompare(b.athleteId, "en");

/** The tag for a matched absence: the report's word, or "Missed last game" for a box-score inference. */
export function squadTag(status: AbsenceSide["players"][number]["status"]): SquadTag {
  if (status === null) return { label: "Missed last game", tone: "quiet" };
  return { label: STATUS_LABELS[status], tone: STATUS_TONE[status] };
}

function tagsFor(side: AbsenceSide | null): Map<string, SquadTag> {
  const tags = new Map<string, SquadTag>();
  for (const player of side?.players ?? []) {
    if (player.athleteId === null || tags.has(player.athleteId)) continue;
    tags.set(player.athleteId, squadTag(player.status));
  }
  return tags;
}

function rosterSide(
  file: TeamPlayersFile,
  entries: Map<string, PlayerIndexEntry>,
  absences: AbsenceSide | null,
): SquadSide {
  const tags = tagsFor(absences);
  const rows: RosterRow[] = [];
  for (const player of file.players) {
    const entry = entries.get(player.athleteId);
    // Only players the index still places on this team: a player with no entry cannot be checked.
    if (!entry || entry.teamId !== file.teamId) continue;
    const totals = logTotals(player.log);
    rows.push({
      athleteId: player.athleteId,
      name: player.name,
      position: player.position,
      games: totals.games,
      minutes: totals.perGame?.minutes ?? null,
      points: totals.perGame?.points ?? null,
      score: entry.score ?? null,
      tag: tags.get(player.athleteId) ?? null,
    });
  }
  rows.sort((a, b) => {
    if ((a.minutes === null) !== (b.minutes === null)) return a.minutes === null ? 1 : -1;
    if (a.minutes !== null && b.minutes !== null && a.minutes !== b.minutes) return b.minutes - a.minutes;
    if (a.minutes !== null && a.games !== b.games) return b.games - a.games;
    return byName(a, b);
  });
  return { kind: "roster", teamId: file.teamId, shown: rows.slice(0, SQUAD_ROWS_SHOWN), more: rows.slice(SQUAD_ROWS_SHOWN) };
}

type PlayedEntry = Extract<PlayerLogEntry, { played: true }>;

function playedSide(file: TeamPlayersFile, gameId: string, entries: Map<string, PlayerIndexEntry>): SquadSide {
  const played: PlayedRow[] = [];
  const didNotPlay: DidNotPlayRow[] = [];
  for (const player of file.players) {
    const line = player.log.find((entry) => entry.gameId === gameId);
    if (!line) continue;
    if (line.played) {
      const entry: PlayedEntry = line;
      played.push({
        athleteId: player.athleteId,
        name: player.name,
        position: player.position,
        starter: entry.starter,
        minutes: entry.minutes,
        points: entry.points,
        score: entries.get(player.athleteId)?.score ?? null,
      });
    } else {
      didNotPlay.push({
        athleteId: player.athleteId,
        name: player.name,
        position: player.position,
        reason: line.reason === null ? null : espnReason(line.reason),
      });
    }
  }
  played.sort((a, b) => Number(b.starter) - Number(a.starter) || b.minutes - a.minutes || byName(a, b));
  didNotPlay.sort(byName);
  return { kind: "played", teamId: file.teamId, played, didNotPlay };
}

function squadSide(
  teamId: string,
  game: SquadGame,
  file: TeamPlayersFile | null,
  index: PlayerIndexFile | null,
  entries: Map<string, PlayerIndexEntry>,
  absences: AbsenceSide | null,
): SquadSide {
  if (!file) return { kind: "unavailable", teamId };
  if (game.status === "final") {
    const stored =
      file.games.some((row) => row.gameId === game.id) ||
      file.players.some((player) => player.log.some((entry) => entry.gameId === game.id));
    // Never fall back to today's players for a finished game.
    return stored ? playedSide(file, game.id, entries) : { kind: "not-stored", teamId };
  }
  if (!index) return { kind: "unavailable", teamId };
  return rosterSide(file, entries, absences);
}

/** Both sides, away first, each built on its own. */
export function buildSquads(input: {
  game: SquadGame;
  index: PlayerIndexFile | null;
  awayFile: TeamPlayersFile | null;
  homeFile: TeamPlayersFile | null;
}): Squads {
  const { game, index } = input;
  const entries = new Map((index?.players ?? []).map((entry) => [entry.athleteId, entry]));
  const away = squadSide(game.awayId, game, input.awayFile, index, entries, game.absences?.away ?? null);
  const home = squadSide(game.homeId, game, input.homeFile, index, entries, game.absences?.home ?? null);
  const kinds = [away.kind, home.kind];
  return {
    away,
    home,
    figures: kinds.includes("roster") ? "season" : kinds.includes("played") ? "game" : null,
    showsScores: kinds.includes("roster") || kinds.includes("played"),
    scoreLabel: index?.scoreLabel || SCORE_LABEL,
    throughEtDate: index?.throughEtDate ?? null,
    inProgress: game.status === "in-progress",
  };
}
