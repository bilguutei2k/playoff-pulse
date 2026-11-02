import type { Conference, Division, SeasonTeam } from "@/lib/season/types";

/** A league team plus its display colors, used only for team-specific marks in the UI. */
export type LeagueTeam = SeasonTeam & {
  /** Primary team color as six hex digits, no leading #. ESPN's `color`. */
  color: string;
  /** Alternate team color as six hex digits, no leading #. ESPN's `alternateColor`. */
  alternateColor: string;
};

function team(
  id: string,
  abbreviation: string,
  name: string,
  shortName: string,
  conference: Conference,
  division: Division,
  color: string,
  alternateColor: string,
): LeagueTeam {
  return { id, abbreviation, name, shortName, conference, division, color, alternateColor };
}

// Division membership has been stable since the 2004-05 realignment, which is
// also the start of the stored history. ESPN IDs follow the franchise, so
// New Jersey and Brooklyn share ID 17 and Seattle and Oklahoma City share ID 25.
// Colors are ESPN's current `color` and `alternateColor` for each team.
export const SEASON_TEAMS: readonly LeagueTeam[] = [
  team("1", "ATL", "Atlanta Hawks", "Hawks", "East", "Southeast", "c8102e", "fdb927"),
  team("2", "BOS", "Boston Celtics", "Celtics", "East", "Atlantic", "008348", "ffffff"),
  team("17", "BKN", "Brooklyn Nets", "Nets", "East", "Atlantic", "000000", "ffffff"),
  team("30", "CHA", "Charlotte Hornets", "Hornets", "East", "Southeast", "008ca8", "1d1060"),
  team("4", "CHI", "Chicago Bulls", "Bulls", "East", "Central", "ce1141", "000000"),
  team("5", "CLE", "Cleveland Cavaliers", "Cavaliers", "East", "Central", "860038", "bc945c"),
  team("6", "DAL", "Dallas Mavericks", "Mavericks", "West", "Southwest", "0064b1", "bbc4ca"),
  team("7", "DEN", "Denver Nuggets", "Nuggets", "West", "Northwest", "0e2240", "fec524"),
  team("8", "DET", "Detroit Pistons", "Pistons", "East", "Central", "1d428a", "c8102e"),
  team("9", "GS", "Golden State Warriors", "Warriors", "West", "Pacific", "fdb927", "1d428a"),
  team("10", "HOU", "Houston Rockets", "Rockets", "West", "Southwest", "ce0e2d", "000000"),
  team("11", "IND", "Indiana Pacers", "Pacers", "East", "Central", "0c2340", "ffd520"),
  team("12", "LAC", "LA Clippers", "Clippers", "West", "Pacific", "12173f", "c8102e"),
  team("13", "LAL", "Los Angeles Lakers", "Lakers", "West", "Pacific", "552583", "fdb927"),
  team("29", "MEM", "Memphis Grizzlies", "Grizzlies", "West", "Southwest", "5d76a9", "12173f"),
  team("14", "MIA", "Miami Heat", "Heat", "East", "Southeast", "98002e", "000000"),
  team("15", "MIL", "Milwaukee Bucks", "Bucks", "East", "Central", "00471b", "eee1c6"),
  team("16", "MIN", "Minnesota Timberwolves", "Timberwolves", "West", "Northwest", "266092", "79bc43"),
  team("3", "NO", "New Orleans Pelicans", "Pelicans", "West", "Southwest", "0a2240", "b4975a"),
  team("18", "NY", "New York Knicks", "Knicks", "East", "Atlantic", "1d428a", "f58426"),
  team("25", "OKC", "Oklahoma City Thunder", "Thunder", "West", "Northwest", "007ac1", "ef3b24"),
  team("19", "ORL", "Orlando Magic", "Magic", "East", "Southeast", "0150b5", "9ca0a3"),
  team("20", "PHI", "Philadelphia 76ers", "76ers", "East", "Atlantic", "1d428a", "e01234"),
  team("21", "PHX", "Phoenix Suns", "Suns", "West", "Pacific", "29127a", "e56020"),
  team("22", "POR", "Portland Trail Blazers", "Trail Blazers", "West", "Northwest", "e03a3e", "000000"),
  team("23", "SAC", "Sacramento Kings", "Kings", "West", "Pacific", "5a2d81", "6a7a82"),
  team("24", "SA", "San Antonio Spurs", "Spurs", "West", "Southwest", "000000", "c4ced4"),
  team("28", "TOR", "Toronto Raptors", "Raptors", "East", "Atlantic", "d91244", "000000"),
  team("26", "UTAH", "Utah Jazz", "Jazz", "West", "Northwest", "4e008e", "79a3dc"),
  team("27", "WSH", "Washington Wizards", "Wizards", "East", "Southeast", "e31837", "002b5c"),
];

export const TEAM_COUNT = SEASON_TEAMS.length;
/** Index of the home-court state, after the 30 team ratings. */
export const HCA_INDEX = TEAM_COUNT;
export const STATE_SIZE = TEAM_COUNT + 1;

const BY_ID = new Map(SEASON_TEAMS.map((row, index) => [row.id, { row, index }]));

export function isLeagueTeam(id: string): boolean {
  return BY_ID.has(id);
}

export function teamById(id: string): LeagueTeam {
  const entry = BY_ID.get(id);
  if (!entry) throw new Error(`Unknown ESPN team ID: ${id}`);
  return entry.row;
}

export function teamIndex(id: string): number {
  const entry = BY_ID.get(id);
  if (!entry) throw new Error(`Unknown ESPN team ID: ${id}`);
  return entry.index;
}

// Repo historical files use Basketball-Reference codes. Joins go through this
// explicit map and fail closed on anything unrecognised.
const REPO_CODE_TO_ID: Record<string, string> = {
  ATL: "1",
  BOS: "2",
  BRK: "17",
  NJN: "17",
  CHO: "30",
  CHA: "30",
  CHI: "4",
  CLE: "5",
  DAL: "6",
  DEN: "7",
  DET: "8",
  GSW: "9",
  HOU: "10",
  IND: "11",
  LAC: "12",
  LAL: "13",
  MEM: "29",
  MIA: "14",
  MIL: "15",
  MIN: "16",
  NOP: "3",
  NOH: "3",
  NYK: "18",
  OKC: "25",
  SEA: "25",
  ORL: "19",
  PHI: "20",
  PHO: "21",
  POR: "22",
  SAC: "23",
  SAS: "24",
  TOR: "28",
  UTA: "26",
  WAS: "27",
};

export function teamIdFromRepoCode(code: string): string {
  const id = REPO_CODE_TO_ID[code.toUpperCase()];
  if (!id) throw new Error(`Unknown repo team code: ${code}`);
  return id;
}
