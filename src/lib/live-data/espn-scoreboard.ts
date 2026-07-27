import type {
  LiveGameStatus,
  LiveScoreboardGame,
  LiveScoreboardSnapshot,
  LiveScoreboardTeam,
} from "@/lib/live-data/types";
import { canonicalTeamAbbreviation } from "@/lib/live-data/espn-abbreviations";

const ESPN_NBA_SCOREBOARD_URL =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";

type JsonRecord = Record<string, unknown>;

type NormalizeOptions = {
  endpoint: string;
  fetchedAt: string;
  manualTeamAbbreviations: string[];
};

type FetchOptions = {
  date?: string;
  manualTeamAbbreviations: string[];
};

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function getString(record: JsonRecord | null, key: string): string | null {
  if (!record) {
    return null;
  }

  const value = record[key];
  return typeof value === "string" ? value : null;
}

function getBoolean(record: JsonRecord | null, key: string): boolean | null {
  if (!record) {
    return null;
  }

  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function getArray(record: JsonRecord | null, key: string): unknown[] {
  if (!record) {
    return [];
  }

  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function normalizeEspnDate(value?: string): string | null {
  if (!value) {
    return null;
  }

  const digits = value.replaceAll("-", "");
  return /^\d{8}$/.test(digits) ? digits : null;
}

function normalizeStatus(type: JsonRecord | null): LiveGameStatus {
  const state = getString(type, "state")?.toLowerCase();
  const name = getString(type, "name")?.toLowerCase();
  const completed = getBoolean(type, "completed");

  if (completed || state === "post" || name === "status_final") {
    return "final";
  }

  if (state === "in" || name === "status_in_progress") {
    return "in-progress";
  }

  if (state === "pre" || name === "status_scheduled") {
    return "scheduled";
  }

  if (name?.includes("postponed")) {
    return "postponed";
  }

  return "unknown";
}

function parseTeam(competitor: JsonRecord | null): LiveScoreboardTeam | null {
  const team = asRecord(competitor?.team);
  const homeAway = getString(competitor, "homeAway");

  if (homeAway !== "home" && homeAway !== "away") {
    return null;
  }

  return {
    abbreviation: getString(team, "abbreviation") ?? "UNK",
    displayName: getString(team, "displayName") ?? "Unknown team",
    homeAway,
    score: getString(competitor, "score"),
    winner: getBoolean(competitor, "winner"),
  };
}

function parseGame(event: unknown): LiveScoreboardGame | null {
  const eventRecord = asRecord(event);
  const competition = asRecord(getArray(eventRecord, "competitions")[0]);
  const competitors = getArray(competition, "competitors")
    .map((competitor) => parseTeam(asRecord(competitor)))
    .filter((team): team is LiveScoreboardTeam => Boolean(team));
  const homeTeam = competitors.find((team) => team.homeAway === "home") ?? null;
  const awayTeam = competitors.find((team) => team.homeAway === "away") ?? null;
  const status = asRecord(competition?.status);
  const statusType = asRecord(status?.type);
  const venue = asRecord(competition?.venue);

  if (!eventRecord || !competition) {
    return null;
  }

  return {
    id: getString(eventRecord, "id") ?? getString(competition, "id") ?? "unknown",
    name: getString(eventRecord, "name") ?? "Unknown NBA game",
    shortName: getString(eventRecord, "shortName") ?? "NBA",
    date: getString(eventRecord, "date") ?? getString(competition, "date"),
    status: normalizeStatus(statusType),
    statusDetail:
      getString(statusType, "shortDetail") ??
      getString(statusType, "detail") ??
      getString(statusType, "description") ??
      "Status unavailable",
    venue: getString(venue, "fullName"),
    homeTeam,
    awayTeam,
  };
}

export function buildUnavailableLiveScoreboardSnapshot(
  error: string,
  endpoint = ESPN_NBA_SCOREBOARD_URL,
): LiveScoreboardSnapshot {
  return {
    status: "unavailable",
    source: "espn-site-api",
    sourceLabel: "ESPN public scoreboard endpoint",
    endpoint,
    fetchedAt: new Date().toISOString(),
    feedDate: null,
    season: null,
    games: [],
    manualTeamMatches: 0,
    manualTeamCount: 0,
    warnings: [
      "Live scoreboard could not be loaded. Manual forecast inputs remain active.",
    ],
    error,
  };
}

export function normalizeEspnScoreboard(
  payload: unknown,
  options: NormalizeOptions,
): LiveScoreboardSnapshot {
  const root = asRecord(payload);
  const day = asRecord(root?.day);
  const season = asRecord(root?.season);
  const leagues = getArray(root, "leagues")
    .map((league) => asRecord(league))
    .filter((league): league is JsonRecord => Boolean(league));
  const leagueSeason = asRecord(leagues[0]?.season);
  const games = getArray(root, "events")
    .map(parseGame)
    .filter((game): game is LiveScoreboardGame => Boolean(game));
  const manualTeamSet = new Set(
    options.manualTeamAbbreviations.map(canonicalTeamAbbreviation),
  );
  const liveTeamMatches = new Set<string>();

  for (const game of games) {
    for (const team of [game.homeTeam, game.awayTeam]) {
      const canonical = team ? canonicalTeamAbbreviation(team.abbreviation) : null;
      if (canonical && manualTeamSet.has(canonical)) {
        liveTeamMatches.add(canonical);
      }
    }
  }

  const warnings = [
    "Read-only scoreboard probe. It does not update forecast inputs.",
    "ESPN site scoreboard is an external public endpoint, not an official model input contract.",
  ];

  if (!games.length) {
    warnings.push("No NBA games were returned for the selected feed date.");
  }

  return {
    status: "connected",
    source: "espn-site-api",
    sourceLabel: "ESPN public scoreboard endpoint",
    endpoint: options.endpoint,
    fetchedAt: options.fetchedAt,
    feedDate: getString(day, "date"),
    season:
      getString(season, "year") ??
      getString(leagueSeason, "displayName") ??
      getString(leagueSeason, "year"),
    games,
    manualTeamMatches: liveTeamMatches.size,
    manualTeamCount: manualTeamSet.size,
    warnings,
    error: null,
  };
}

export async function fetchEspnNbaScoreboard({
  date,
  manualTeamAbbreviations,
}: FetchOptions): Promise<LiveScoreboardSnapshot> {
  const endpointUrl = new URL(ESPN_NBA_SCOREBOARD_URL);
  const normalizedDate = normalizeEspnDate(date);

  if (date && normalizedDate) {
    endpointUrl.searchParams.set("dates", normalizedDate);
  }

  const endpoint = endpointUrl.toString();
  const response = await fetch(endpoint, {
    headers: {
      accept: "application/json",
    },
    next: { revalidate: 60 },
  });

  if (!response.ok) {
    throw new Error(`Live scoreboard request failed with HTTP ${response.status}.`);
  }

  return normalizeEspnScoreboard(await response.json(), {
    endpoint,
    fetchedAt: new Date().toISOString(),
    manualTeamAbbreviations,
  });
}
