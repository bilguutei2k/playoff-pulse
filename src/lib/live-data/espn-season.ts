// ESPN adapter for the live season pipeline: fetchers plus strict validators.
//
// ESPN's public endpoints are unofficial and undocumented. Anything that does
// not match the expected shape throws, and the pipeline then publishes nothing.
// This module may depend on the season engine's types; the engine never imports
// from here.

import { etDateOf } from "@/lib/season/dates";
import { isBubbleDate } from "@/lib/season/formats";
import type { PlayerBoxLine, PlayerBoxScore, PlayerDidNotPlay } from "@/lib/season/player-stats";
import { isLeagueTeam } from "@/lib/season/teams";
import type {
  Conference,
  GameKind,
  GameStatus,
  InjuryRow,
  MarketReference,
  PlayInStage,
  PlayoffRound,
  ScoreboardRow,
  SeasonGame,
} from "@/lib/season/types";

const SITE_API = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const STANDINGS_API =
  "https://site.web.api.espn.com/apis/v2/sports/basketball/nba/standings";

type Json = Record<string, unknown>;

export type ParseOutcome =
  | { kind: "game"; game: SeasonGame }
  | { kind: "skipped"; reason: string };

function asRecord(value: unknown): Json | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function requireString(record: Json | null, key: string, label: string): string {
  const value = record?.[key];
  if (typeof value !== "string" || !value) {
    throw new Error(`ESPN payload: ${label}.${key} is missing.`);
  }
  return value;
}

function parseScore(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const record = asRecord(value);
  return record ? parseScore(record.value ?? record.displayValue) : null;
}

export function parseStatus(type: Json | null, eventId: string): GameStatus {
  const name = String(type?.name ?? "").toUpperCase();
  const state = String(type?.state ?? "").toLowerCase();
  if (name.includes("POSTPONED")) return "postponed";
  if (name.includes("CANCELED") || name.includes("CANCELLED")) return "canceled";
  if (name === "STATUS_FINAL" || name === "STATUS_FULL_TIME") return "final";
  if (state === "post" && type?.completed === true) return "final";
  if (state === "in") return "in-progress";
  if (state === "pre") return "scheduled";
  throw new Error(`ESPN payload: unknown status "${name}" on event ${eventId}.`);
}

function parseSeasonType(event: Json, competition: Json): number {
  const direct =
    asRecord(event.seasonType)?.type ??
    asRecord(event.season)?.type ??
    asRecord(competition.season)?.type;
  const parsed = Number(direct);
  if (!Number.isInteger(parsed)) {
    throw new Error(`ESPN payload: event ${String(event.id)} has no season type.`);
  }
  return parsed;
}

function roundFromType(abbreviation: string): PlayoffRound | undefined {
  switch (abbreviation) {
    case "RD16":
      return "first-round";
    case "QTR":
      return "conference-semifinal";
    case "SEMI":
      return "conference-final";
    case "FINAL":
      return "finals";
    default:
      return undefined;
  }
}

function roundFromNotes(notes: string[]): PlayoffRound | undefined {
  const text = notes.join(" ").toLowerCase();
  if (text.includes("nba finals")) return "finals";
  if (text.includes("1st round") || text.includes("first round")) return "first-round";
  if (text.includes("semifinal")) return "conference-semifinal";
  if (/(east|west)(ern)?( conference)? finals?/.test(text)) return "conference-final";
  return undefined;
}

function conferenceFromNotes(notes: string[]): Conference | undefined {
  const text = notes.join(" ");
  if (/\bEast(ern)?\b/i.test(text)) return "East";
  if (/\bWest(ern)?\b/i.test(text)) return "West";
  return undefined;
}

/** Play-in matchups are identified by notes, never by date order. */
export function playInStageFromNotes(notes: string[]): PlayInStage | undefined {
  const text = notes.join(" ");
  if (/7th Place vs\.? 8th Place/i.test(text)) return "7v8";
  if (/9th Place vs\.? 10th Place/i.test(text)) return "9v10";
  if (/8th Seed/i.test(text)) return "8-seed";
  return undefined;
}

/**
 * Normalize one ESPN event. Events involving non-league teams (All-Star games,
 * exhibitions) and preseason games are skipped. Malformed league games throw.
 */
export function parseEvent(raw: unknown, season: number): ParseOutcome {
  const event = asRecord(raw);
  const competition = asRecord(asArray(event?.competitions)[0]);
  if (!event || !competition) {
    throw new Error("ESPN payload: event without a competition.");
  }
  const id = requireString(event, "id", "event");
  const seasonType = parseSeasonType(event, competition);
  if (seasonType === 1 || seasonType === 4) {
    return { kind: "skipped", reason: `season type ${seasonType}` };
  }
  if (seasonType !== 2 && seasonType !== 3 && seasonType !== 5) {
    throw new Error(`ESPN payload: unknown season type ${seasonType} on ${id}.`);
  }

  const competitors = asArray(competition.competitors).map(asRecord);
  const home = competitors.find((row) => row?.homeAway === "home") ?? null;
  const away = competitors.find((row) => row?.homeAway === "away") ?? null;
  if (!home || !away) {
    throw new Error(`ESPN payload: event ${id} lacks home and away competitors.`);
  }
  const homeId = requireString(asRecord(home.team), "id", `event ${id} home`);
  const awayId = requireString(asRecord(away.team), "id", `event ${id} away`);
  if (!isLeagueTeam(homeId) || !isLeagueTeam(awayId)) {
    return { kind: "skipped", reason: `non-league teams ${homeId}/${awayId}` };
  }
  if (homeId === awayId) {
    throw new Error(`ESPN payload: event ${id} has the same team twice.`);
  }

  const tipUtc = requireString(event, "date", `event ${id}`);
  if (Number.isNaN(Date.parse(tipUtc))) {
    throw new Error(`ESPN payload: event ${id} has an invalid date.`);
  }

  const status = parseStatus(asRecord(asRecord(competition.status)?.type), id);
  const typeAbbreviation = String(asRecord(competition.type)?.abbreviation ?? "");
  const notes = asArray(competition.notes)
    .map((note) => asRecord(note)?.headline)
    .filter((headline): headline is string => typeof headline === "string");

  let kind: GameKind;
  if (seasonType === 2) kind = typeAbbreviation === "CC" ? "cup-final" : "regular";
  else if (seasonType === 5) kind = "play-in";
  else kind = "playoff";

  let homeScore = parseScore(home.score);
  let awayScore = parseScore(away.score);
  if (status === "final") {
    if (
      homeScore === null ||
      awayScore === null ||
      !Number.isInteger(homeScore) ||
      !Number.isInteger(awayScore) ||
      homeScore < 0 ||
      awayScore < 0
    ) {
      throw new Error(`ESPN payload: final ${id} has no usable score.`);
    }
    if (homeScore === 0 && awayScore === 0) {
      throw new Error(`ESPN payload: final ${id} is scored 0-0.`);
    }
    if (homeScore === awayScore) {
      throw new Error(`ESPN payload: final ${id} is tied ${homeScore}-${awayScore}.`);
    }
  } else if (status !== "in-progress") {
    homeScore = null;
    awayScore = null;
  }

  const game: SeasonGame = {
    id,
    season,
    kind,
    tipUtc,
    etDate: etDateOf(tipUtc),
    homeId,
    awayId,
    neutral: competition.neutralSite === true || isBubbleDate(tipUtc),
    status,
    homeScore,
    awayScore,
  };
  if (kind === "playoff") {
    const round = roundFromType(typeAbbreviation) ?? roundFromNotes(notes);
    if (round) game.round = round;
    const conference = conferenceFromNotes(notes);
    if (conference && round !== "finals") game.conference = conference;
  }
  if (kind === "play-in") {
    const stage = playInStageFromNotes(notes);
    if (stage) game.playIn = stage;
    const conference = conferenceFromNotes(notes);
    if (conference) game.conference = conference;
  }
  return { kind: "game", game };
}

export function parseEvents(
  events: unknown[],
  season: number,
): { games: SeasonGame[]; skipped: string[] } {
  const games: SeasonGame[] = [];
  const skipped: string[] = [];
  for (const raw of events) {
    const outcome = parseEvent(raw, season);
    if (outcome.kind === "game") games.push(outcome.game);
    else skipped.push(outcome.reason);
  }
  return { games, skipped };
}

// ---------------------------------------------------------------------------
// Fast-path scoreboard rows (live score, clock, odds)
// ---------------------------------------------------------------------------

export type { ScoreboardRow };

function parseLinescores(competitor: Json | null): number[] {
  return asArray(competitor?.linescores)
    .map((row) => parseScore(asRecord(row)?.value))
    .filter((value): value is number => value !== null);
}

/** Pregame odds, kept for later aggregate comparison only. */
export function parseMarket(competition: Json | null): MarketReference | null {
  const odds = asRecord(asArray(competition?.odds)[0]);
  if (!odds) return null;
  const moneyline = asRecord(odds.moneyline);
  const homeClose = asRecord(asRecord(moneyline?.home)?.close);
  const awayClose = asRecord(asRecord(moneyline?.away)?.close);
  const homeTeamOdds = asRecord(odds.homeTeamOdds);
  const awayTeamOdds = asRecord(odds.awayTeamOdds);
  const homeMoneyline =
    parseAmericanOdds(homeClose?.odds) ?? parseAmericanOdds(homeTeamOdds?.moneyLine);
  const awayMoneyline =
    parseAmericanOdds(awayClose?.odds) ?? parseAmericanOdds(awayTeamOdds?.moneyLine);
  const spreadMagnitude = parseScore(odds.spread);
  let homeSpread: number | null = null;
  if (spreadMagnitude !== null) {
    if (homeTeamOdds?.favorite === true) homeSpread = -Math.abs(spreadMagnitude);
    else if (awayTeamOdds?.favorite === true) homeSpread = Math.abs(spreadMagnitude);
  }
  if (homeMoneyline === null && awayMoneyline === null && homeSpread === null) {
    return null;
  }
  return {
    provider: String(asRecord(odds.provider)?.name ?? "unknown"),
    homeMoneyline,
    awayMoneyline,
    homeSpread,
  };
}

function parseAmericanOdds(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  if (value.trim().toUpperCase() === "EVEN") return 100;
  const parsed = Number(value.replace("+", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseClockSeconds(status: Json | null): number {
  const clock = status?.clock;
  if (typeof clock === "number" && Number.isFinite(clock) && clock >= 0) {
    return clock;
  }
  return 0;
}

export function parseScoreboard(payload: unknown, season: number): ScoreboardRow[] {
  const root = asRecord(payload);
  if (!root || !Array.isArray(root.events)) {
    throw new Error("ESPN payload: scoreboard has no events array.");
  }
  const rows: ScoreboardRow[] = [];
  for (const raw of root.events) {
    const outcome = parseEvent(raw, season);
    if (outcome.kind !== "game") continue;
    const event = asRecord(raw);
    const competition = asRecord(asArray(event?.competitions)[0]);
    const status = asRecord(competition?.status);
    const statusType = asRecord(status?.type);
    const competitors = asArray(competition?.competitors).map(asRecord);
    const home = competitors.find((row) => row?.homeAway === "home") ?? null;
    const away = competitors.find((row) => row?.homeAway === "away") ?? null;
    const detail = String(
      statusType?.shortDetail ?? statusType?.detail ?? statusType?.description ?? "",
    );
    rows.push({
      game: outcome.game,
      live:
        outcome.game.status === "in-progress"
          ? {
              period: Number(status?.period ?? 1) || 1,
              clockSeconds: parseClockSeconds(status),
              display: detail,
            }
          : null,
      statusDetail: detail,
      market: outcome.game.status === "scheduled" ? parseMarket(competition) : null,
      homeLinescores: parseLinescores(home),
      awayLinescores: parseLinescores(away),
      seriesSummary:
        outcome.game.kind === "playoff"
          ? (asRecord(competition?.series)?.summary as string | undefined) ?? null
          : null,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

export type StandingRow = {
  teamId: string;
  wins: number;
  losses: number;
  playoffSeed: number | null;
};

export function parseStandings(payload: unknown): StandingRow[] {
  const root = asRecord(payload);
  const rows: StandingRow[] = [];
  for (const child of asArray(root?.children)) {
    const entries = asArray(asRecord(asRecord(child)?.standings)?.entries);
    for (const rawEntry of entries) {
      const entry = asRecord(rawEntry);
      const teamId = requireString(asRecord(entry?.team), "id", "standings team");
      const stats = new Map<string, number>();
      for (const rawStat of asArray(entry?.stats)) {
        const stat = asRecord(rawStat);
        if (typeof stat?.name === "string" && typeof stat.value === "number") {
          stats.set(stat.name, stat.value);
        }
      }
      const wins = stats.get("wins");
      const losses = stats.get("losses");
      if (wins === undefined || losses === undefined) {
        throw new Error(`ESPN payload: standings for team ${teamId} lack W-L.`);
      }
      rows.push({
        teamId,
        wins,
        losses,
        playoffSeed: stats.get("playoffSeed") ?? null,
      });
    }
  }
  if (rows.length !== 30) {
    throw new Error(`ESPN payload: standings list ${rows.length} teams, expected 30.`);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// ESPN injuries (display fallback and capture only; never a model input. The model's
// availability comes from the NBA's injury report.)
// ---------------------------------------------------------------------------

export function parseInjuries(payload: unknown): InjuryRow[] {
  const root = asRecord(payload);
  if (!root || !Array.isArray(root.injuries)) {
    throw new Error("ESPN payload: injuries has no list.");
  }
  const rows: InjuryRow[] = [];
  for (const rawTeam of root.injuries) {
    const teamRecord = asRecord(rawTeam);
    const teamId = String(teamRecord?.id ?? "");
    if (!isLeagueTeam(teamId)) continue;
    for (const rawRow of asArray(teamRecord?.injuries)) {
      const row = asRecord(rawRow);
      const athlete = asRecord(row?.athlete);
      const name = athlete?.displayName;
      const status = row?.status;
      if (typeof name !== "string" || typeof status !== "string") continue;
      const details = asRecord(row?.details);
      const fantasy = asRecord(details?.fantasyStatus);
      const fantasyStatus = fantasy?.abbreviation ?? fantasy?.description;
      rows.push({
        teamId,
        athleteId: String(athlete?.id ?? row?.id ?? ""),
        name,
        status,
        date: String(row?.date ?? ""),
        // Stored for later study only. Return estimates in the model come from the
        // survival table, never from these.
        returnDate: typeof details?.returnDate === "string" ? details.returnDate : null,
        fantasyStatus: typeof fantasyStatus === "string" ? fantasyStatus : null,
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Box scores (player value and who actually played)
// ---------------------------------------------------------------------------

export type BoxPlayerLine = {
  athleteId: string;
  name: string;
  minutes: number;
  points: number;
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
};

/** Players with minutes only, by team ID. Anyone else missed the game. */
export type BoxScore = Record<string, BoxPlayerLine[]>;

function statNumber(cell: string | undefined, label: string, gameId: string): number {
  const value = Number(cell);
  if (cell === undefined || cell === "" || !Number.isFinite(value)) {
    throw new Error(`ESPN box score ${gameId}: ${label} is not a number ("${String(cell)}").`);
  }
  return value;
}

function madeAttempted(cell: string | undefined, label: string, gameId: string): [number, number] {
  const match = /^(\d+)-(\d+)$/.exec(cell ?? "");
  if (!match) {
    throw new Error(`ESPN box score ${gameId}: ${label} is not made-attempted ("${String(cell)}").`);
  }
  return [Number(match[1]), Number(match[2])];
}

/** Minutes are a whole number, sometimes "MM:SS". A bare dash or blank means none. */
function parseMinutes(cell: string | undefined, gameId: string): number {
  if (cell === undefined || cell === "" || /^-+$/.test(cell)) return 0;
  const clock = /^(\d+):(\d+)$/.exec(cell);
  if (clock) return Number(clock[1]) + Number(clock[2]) / 60;
  return statNumber(cell, "MIN", gameId);
}

/** Strict: a changed layout throws, so a bad box score can never reach player values. */
export function parseBoxScore(payload: unknown, gameId: string): BoxScore {
  const blocks = asArray(asRecord(asRecord(payload)?.boxscore)?.players);
  if (blocks.length !== 2) {
    throw new Error(`ESPN box score ${gameId}: expected 2 teams, found ${blocks.length}.`);
  }
  const output: BoxScore = {};
  for (const rawBlock of blocks) {
    const block = asRecord(rawBlock);
    const teamId = String(asRecord(block?.team)?.id ?? "");
    if (!isLeagueTeam(teamId)) {
      throw new Error(`ESPN box score ${gameId}: unknown team ${teamId}.`);
    }
    const group = asRecord(asArray(block?.statistics)[0]);
    const labels = asArray(group?.labels ?? group?.names).map(String);
    const at = (label: string) => {
      const index = labels.indexOf(label);
      if (index < 0) throw new Error(`ESPN box score ${gameId}: no ${label} column.`);
      return index;
    };
    const columns = {
      minutes: at("MIN"),
      points: at("PTS"),
      fieldGoals: at("FG"),
      freeThrows: at("FT"),
      assists: at("AST"),
      turnovers: at("TO"),
      steals: at("STL"),
      blocks: at("BLK"),
      offensiveRebounds: at("OREB"),
      defensiveRebounds: at("DREB"),
      fouls: at("PF"),
    };
    const lines: BoxPlayerLine[] = [];
    for (const rawAthlete of asArray(group?.athletes)) {
      const row = asRecord(rawAthlete);
      const stats = asArray(row?.stats).map(String);
      if (stats.length === 0) continue;
      const minutes = parseMinutes(stats[columns.minutes], gameId);
      if (minutes <= 0) continue;
      const athlete = asRecord(row?.athlete);
      const [fieldGoalsMade, fieldGoalsAttempted] = madeAttempted(
        stats[columns.fieldGoals],
        "FG",
        gameId,
      );
      const [freeThrowsMade, freeThrowsAttempted] = madeAttempted(
        stats[columns.freeThrows],
        "FT",
        gameId,
      );
      lines.push({
        athleteId: requireString(athlete, "id", "athlete"),
        name: requireString(athlete, "displayName", "athlete"),
        minutes,
        points: statNumber(stats[columns.points], "PTS", gameId),
        fieldGoalsMade,
        fieldGoalsAttempted,
        freeThrowsMade,
        freeThrowsAttempted,
        offensiveRebounds: statNumber(stats[columns.offensiveRebounds], "OREB", gameId),
        defensiveRebounds: statNumber(stats[columns.defensiveRebounds], "DREB", gameId),
        assists: statNumber(stats[columns.assists], "AST", gameId),
        steals: statNumber(stats[columns.steals], "STL", gameId),
        blocks: statNumber(stats[columns.blocks], "BLK", gameId),
        turnovers: statNumber(stats[columns.turnovers], "TO", gameId),
        fouls: statNumber(stats[columns.fouls], "PF", gameId),
      });
    }
    if (lines.length === 0) {
      throw new Error(`ESPN box score ${gameId}: team ${teamId} has no player with minutes.`);
    }
    output[teamId] = lines;
  }
  return output;
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

export type FetchJson = (url: string) => Promise<unknown>;

export function createFetchJson(
  init: RequestInit & { next?: { revalidate: number } } = {},
): FetchJson {
  return async (url: string) => {
    const response = await fetch(url, {
      ...init,
      headers: { accept: "application/json", ...(init.headers ?? {}) },
    });
    if (!response.ok) {
      throw new Error(`ESPN request failed with HTTP ${response.status}: ${url}`);
    }
    return response.json();
  };
}

export async function fetchTeamSchedule(
  fetchJson: FetchJson,
  teamId: string,
  season: number,
  seasonType: 2 | 3 | 5,
): Promise<unknown[]> {
  const url = `${SITE_API}/teams/${teamId}/schedule?season=${season}&seasontype=${seasonType}`;
  const payload = asRecord(await fetchJson(url));
  const events = asArray(payload?.events);
  // A team with no games of this type gets an empty body. Otherwise the
  // top-level `season` always names the current season, so it is no evidence of
  // what was returned; `requestedSeason` and each event's own season are.
  if (events.length === 0) return events;
  const requested = Number(asRecord(payload?.requestedSeason)?.year);
  if (requested !== season) {
    throw new Error(`ESPN schedule for ${teamId} answered ${requested}, asked ${season}.`);
  }
  for (const raw of events) {
    const event = asRecord(raw);
    const eventSeason = Number(asRecord(event?.season)?.year);
    if (eventSeason !== season) {
      throw new Error(
        `ESPN schedule for ${teamId}: event ${String(event?.id)} is from ${eventSeason}, asked ${season}.`,
      );
    }
  }
  return events;
}

export async function fetchScoreboardRows(
  fetchJson: FetchJson,
  etDate: string,
  season: number,
): Promise<ScoreboardRow[]> {
  const url = `${SITE_API}/scoreboard?dates=${etDate.replaceAll("-", "")}&limit=100`;
  return parseScoreboard(await fetchJson(url), season);
}

export async function fetchStandings(
  fetchJson: FetchJson,
  season: number,
): Promise<StandingRow[]> {
  const url = `${STANDINGS_API}?season=${season}&type=0&level=2`;
  return parseStandings(await fetchJson(url));
}

export async function fetchInjuries(fetchJson: FetchJson): Promise<InjuryRow[]> {
  return parseInjuries(await fetchJson(`${SITE_API}/injuries`));
}

export async function fetchBoxScore(fetchJson: FetchJson, gameId: string): Promise<BoxScore> {
  return parseBoxScore(await fetchJson(`${SITE_API}/summary?event=${gameId}`), gameId);
}

// ---------------------------------------------------------------------------
// Full player lines (the player store; never a model input)
// ---------------------------------------------------------------------------

/** A signed whole number such as "+3", "-7" or "0". */
function signedNumber(cell: string | undefined, label: string, gameId: string): number {
  const match = /^([+-]?)(\d+)$/.exec(cell ?? "");
  if (!match) throw new Error(`ESPN box score ${gameId}: ${label} is not a signed number ("${String(cell)}").`);
  return match[1] === "-" ? -Number(match[2]) : Number(match[2]);
}

/**
 * Every player in a game summary, by team ID: full lines for those who played (minutes,
 * points, offensive and defensive rebounds, assists, steals, blocks, turnovers, fouls,
 * FG, 3P and FT made and attempted, plus/minus, starter), and ESPN's did-not-play rows
 * with their reason. ESPN fills `reason` on every row ("COACH'S DECISION" even for
 * players who played), so it is kept only where `didNotPlay` is true. A player with an
 * empty stat row and no did-not-play flag is listed as did-not-play with no reason.
 * Strict like `parseBoxScore`: a changed layout throws. Not used by the model, which
 * reads only `parseBoxScore`.
 */
export function parsePlayerBoxScore(payload: unknown, gameId: string): PlayerBoxScore {
  const blocks = asArray(asRecord(asRecord(payload)?.boxscore)?.players);
  if (blocks.length !== 2) {
    throw new Error(`ESPN box score ${gameId}: expected 2 teams, found ${blocks.length}.`);
  }
  const output: PlayerBoxScore = {};
  for (const rawBlock of blocks) {
    const block = asRecord(rawBlock);
    const teamId = String(asRecord(block?.team)?.id ?? "");
    if (!isLeagueTeam(teamId)) throw new Error(`ESPN box score ${gameId}: unknown team ${teamId}.`);
    const group = asRecord(asArray(block?.statistics)[0]);
    const labels = asArray(group?.labels ?? group?.names).map(String);
    const at = (label: string) => {
      const index = labels.indexOf(label);
      if (index < 0) throw new Error(`ESPN box score ${gameId}: no ${label} column.`);
      return index;
    };
    const columns = {
      minutes: at("MIN"),
      points: at("PTS"),
      fieldGoals: at("FG"),
      threePointers: at("3PT"),
      freeThrows: at("FT"),
      assists: at("AST"),
      turnovers: at("TO"),
      steals: at("STL"),
      blocks: at("BLK"),
      offensiveRebounds: at("OREB"),
      defensiveRebounds: at("DREB"),
      fouls: at("PF"),
      plusMinus: at("+/-"),
    };
    const lines: PlayerBoxLine[] = [];
    const didNotPlay: PlayerDidNotPlay[] = [];
    for (const rawAthlete of asArray(group?.athletes)) {
      const row = asRecord(rawAthlete);
      const athlete = asRecord(row?.athlete);
      const athleteId = requireString(athlete, "id", "athlete");
      const name = requireString(athlete, "displayName", "athlete");
      const abbreviation = asRecord(athlete?.position)?.abbreviation;
      const position = typeof abbreviation === "string" && abbreviation ? abbreviation : null;
      const stats = asArray(row?.stats).map(String);
      const flagged = row?.didNotPlay === true;
      if (flagged || stats.length === 0) {
        const reason = row?.reason;
        didNotPlay.push({
          athleteId,
          name,
          position,
          reason: flagged && typeof reason === "string" && reason ? reason : null,
        });
        continue;
      }
      const [fieldGoalsMade, fieldGoalsAttempted] = madeAttempted(stats[columns.fieldGoals], "FG", gameId);
      const [threePointersMade, threePointersAttempted] = madeAttempted(stats[columns.threePointers], "3PT", gameId);
      const [freeThrowsMade, freeThrowsAttempted] = madeAttempted(stats[columns.freeThrows], "FT", gameId);
      lines.push({
        athleteId,
        name,
        position,
        starter: row?.starter === true,
        minutes: parseMinutes(stats[columns.minutes], gameId),
        points: statNumber(stats[columns.points], "PTS", gameId),
        offensiveRebounds: statNumber(stats[columns.offensiveRebounds], "OREB", gameId),
        defensiveRebounds: statNumber(stats[columns.defensiveRebounds], "DREB", gameId),
        assists: statNumber(stats[columns.assists], "AST", gameId),
        steals: statNumber(stats[columns.steals], "STL", gameId),
        blocks: statNumber(stats[columns.blocks], "BLK", gameId),
        turnovers: statNumber(stats[columns.turnovers], "TO", gameId),
        fouls: statNumber(stats[columns.fouls], "PF", gameId),
        fieldGoalsMade,
        fieldGoalsAttempted,
        threePointersMade,
        threePointersAttempted,
        freeThrowsMade,
        freeThrowsAttempted,
        plusMinus: signedNumber(stats[columns.plusMinus], "+/-", gameId),
      });
    }
    if (lines.length === 0) {
      throw new Error(`ESPN box score ${gameId}: team ${teamId} has nobody who played.`);
    }
    output[teamId] = { lines, didNotPlay };
  }
  return output;
}

/** The same summary request as `fetchBoxScore`, parsed for the player store. */
export async function fetchPlayerBoxScore(fetchJson: FetchJson, gameId: string): Promise<PlayerBoxScore> {
  return parsePlayerBoxScore(await fetchJson(`${SITE_API}/summary?event=${gameId}`), gameId);
}
