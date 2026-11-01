import type { Conference, Division, SeasonTeam } from "@/lib/season/types";

function team(
  id: string,
  abbreviation: string,
  name: string,
  shortName: string,
  conference: Conference,
  division: Division,
): SeasonTeam {
  return { id, abbreviation, name, shortName, conference, division };
}

// Division membership has been stable since the 2004-05 realignment, which is
// also the start of the stored history. ESPN IDs follow the franchise, so
// New Jersey and Brooklyn share ID 17 and Seattle and Oklahoma City share ID 25.
export const SEASON_TEAMS: readonly SeasonTeam[] = [
  team("1", "ATL", "Atlanta Hawks", "Hawks", "East", "Southeast"),
  team("2", "BOS", "Boston Celtics", "Celtics", "East", "Atlantic"),
  team("17", "BKN", "Brooklyn Nets", "Nets", "East", "Atlantic"),
  team("30", "CHA", "Charlotte Hornets", "Hornets", "East", "Southeast"),
  team("4", "CHI", "Chicago Bulls", "Bulls", "East", "Central"),
  team("5", "CLE", "Cleveland Cavaliers", "Cavaliers", "East", "Central"),
  team("6", "DAL", "Dallas Mavericks", "Mavericks", "West", "Southwest"),
  team("7", "DEN", "Denver Nuggets", "Nuggets", "West", "Northwest"),
  team("8", "DET", "Detroit Pistons", "Pistons", "East", "Central"),
  team("9", "GS", "Golden State Warriors", "Warriors", "West", "Pacific"),
  team("10", "HOU", "Houston Rockets", "Rockets", "West", "Southwest"),
  team("11", "IND", "Indiana Pacers", "Pacers", "East", "Central"),
  team("12", "LAC", "LA Clippers", "Clippers", "West", "Pacific"),
  team("13", "LAL", "Los Angeles Lakers", "Lakers", "West", "Pacific"),
  team("29", "MEM", "Memphis Grizzlies", "Grizzlies", "West", "Southwest"),
  team("14", "MIA", "Miami Heat", "Heat", "East", "Southeast"),
  team("15", "MIL", "Milwaukee Bucks", "Bucks", "East", "Central"),
  team("16", "MIN", "Minnesota Timberwolves", "Timberwolves", "West", "Northwest"),
  team("3", "NO", "New Orleans Pelicans", "Pelicans", "West", "Southwest"),
  team("18", "NY", "New York Knicks", "Knicks", "East", "Atlantic"),
  team("25", "OKC", "Oklahoma City Thunder", "Thunder", "West", "Northwest"),
  team("19", "ORL", "Orlando Magic", "Magic", "East", "Southeast"),
  team("20", "PHI", "Philadelphia 76ers", "76ers", "East", "Atlantic"),
  team("21", "PHX", "Phoenix Suns", "Suns", "West", "Pacific"),
  team("22", "POR", "Portland Trail Blazers", "Trail Blazers", "West", "Northwest"),
  team("23", "SAC", "Sacramento Kings", "Kings", "West", "Pacific"),
  team("24", "SA", "San Antonio Spurs", "Spurs", "West", "Southwest"),
  team("28", "TOR", "Toronto Raptors", "Raptors", "East", "Atlantic"),
  team("26", "UTAH", "Utah Jazz", "Jazz", "West", "Northwest"),
  team("27", "WSH", "Washington Wizards", "Wizards", "East", "Southeast"),
];

export const TEAM_COUNT = SEASON_TEAMS.length;
/** Index of the home-court state, after the 30 team ratings. */
export const HCA_INDEX = TEAM_COUNT;
export const STATE_SIZE = TEAM_COUNT + 1;

const BY_ID = new Map(SEASON_TEAMS.map((row, index) => [row.id, { row, index }]));

export function isLeagueTeam(id: string): boolean {
  return BY_ID.has(id);
}

export function teamById(id: string): SeasonTeam {
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
