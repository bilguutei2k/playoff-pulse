// Who is expected to miss a game, from the NBA's injury reports, and name matching
// between those reports and ESPN box scores. Pure data and functions.

import { SEASON_TEAMS } from "@/lib/season/teams";

export const STATUS_CODES = {
  Out: "O",
  Doubtful: "D",
  Questionable: "Q",
  Probable: "P",
  Available: "A",
} as const;

export type StatusCode = (typeof STATUS_CODES)[keyof typeof STATUS_CODES];

/** One listed player: team ID, name as printed, status, index into the reasons table. */
export type StoredRow = [teamId: string, player: string, status: StatusCode, reason: number];

export type StoredPoint = {
  /** The report's own timestamp, Eastern wall clock. */
  at: string;
  /** Teams that had not filed when this report was issued. */
  notSubmitted: string[];
  rows: StoredRow[];
};

export type StoredReports = {
  season: number;
  reasons: string[];
  games: Record<string, { morning: StoredPoint | null; final: StoredPoint | null }>;
};

const REPORT_TEAM_ALIASES: Record<string, string> = {
  "Los Angeles Clippers": "LA Clippers",
};

const TEAM_ID_BY_NAME = new Map(SEASON_TEAMS.map((team) => [team.name, team.id]));

/** Fails closed: a team name we do not recognize is a format change, not a detail. */
export function teamIdFromReportName(name: string): string {
  const id = TEAM_ID_BY_NAME.get(REPORT_TEAM_ALIASES[name] ?? name);
  if (!id) throw new Error(`Injury report: unknown team "${name}".`);
  return id;
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/** Lowercase, no accents or punctuation, no generational suffix. */
export function normalizePersonName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'’`-]/g, "")
    .split(/\s+/)
    .filter((word) => word && !SUFFIXES.has(word))
    .join(" ");
}

/** Spellings the reports use for players ESPN names differently, frozen before testing. */
export const REPORT_NAME_ALIASES: Record<string, string> = {};

/** "Brown Jr., Mikel" becomes the key for "Mikel Brown Jr." */
export function reportNameKey(printed: string): string {
  const comma = printed.indexOf(",");
  const reordered =
    comma < 0 ? printed : `${printed.slice(comma + 1).trim()} ${printed.slice(0, comma).trim()}`;
  const key = normalizePersonName(reordered);
  return REPORT_NAME_ALIASES[key] ?? key;
}

export type NameIndex = {
  /** `${season}:${teamId}:${key}` to the athletes on that roster with that name. */
  roster: Map<string, Set<string>>;
  /** Name key to every athlete with that name. */
  global: Map<string, Set<string>>;
};

export function createNameIndex(): NameIndex {
  return { roster: new Map(), global: new Map() };
}

function addTo(map: Map<string, Set<string>>, key: string, athleteId: string): void {
  const entry = map.get(key);
  if (entry) entry.add(athleteId);
  else map.set(key, new Set([athleteId]));
}

export function addToNameIndex(
  index: NameIndex,
  season: number,
  teamId: string,
  athleteId: string,
  displayName: string,
): void {
  const key = normalizePersonName(displayName);
  addTo(index.roster, `${season}:${teamId}:${key}`, athleteId);
  addTo(index.global, key, athleteId);
}

/** Team-season roster first, then a unique name anywhere. Null means no safe match. */
export function resolvePlayer(
  index: NameIndex,
  season: number,
  teamId: string,
  printed: string,
): string | null {
  const key = reportNameKey(printed);
  const onRoster = index.roster.get(`${season}:${teamId}:${key}`);
  if (onRoster?.size === 1) return [...onRoster][0];
  if (onRoster && onRoster.size > 1) return null;
  const anywhere = index.global.get(key);
  return anywhere?.size === 1 ? [...anywhere][0] : null;
}

// ---------------------------------------------------------------------------
// Reasons
// ---------------------------------------------------------------------------

/** Frozen with the registration. A match means the absence is likely to be long. */
export const LONG_ABSENCE_STEMS = [
  "surgery",
  "repair",
  "tear",
  "torn",
  "rupture",
  "fracture",
  "reconstruction",
  "season",
  "achilles",
] as const;

export type AbsenceClass = "long" | "short";

export function absenceClass(reason: string | null | undefined): AbsenceClass {
  if (!reason) return "short";
  const lower = reason.toLowerCase();
  return LONG_ABSENCE_STEMS.some((stem) => lower.includes(stem)) ? "long" : "short";
}

/** Rows that coverage checks skip: players assigned to or shuttling with the G League. */
export function isDevelopmentLeagueReason(reason: string): boolean {
  return /G League|Two-Way/i.test(reason);
}
