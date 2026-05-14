export type LiveDataStatus = "connected" | "unavailable";

export type LiveGameStatus =
  | "scheduled"
  | "in-progress"
  | "final"
  | "postponed"
  | "unknown";

export type LiveScoreboardTeam = {
  abbreviation: string;
  displayName: string;
  homeAway: "home" | "away";
  score: string | null;
  winner: boolean | null;
};

export type LiveScoreboardGame = {
  id: string;
  name: string;
  shortName: string;
  date: string | null;
  status: LiveGameStatus;
  statusDetail: string;
  venue: string | null;
  homeTeam: LiveScoreboardTeam | null;
  awayTeam: LiveScoreboardTeam | null;
};

export type LiveScoreboardSnapshot = {
  status: LiveDataStatus;
  source: string;
  sourceLabel: string;
  endpoint: string;
  fetchedAt: string;
  feedDate: string | null;
  season: string | null;
  games: LiveScoreboardGame[];
  manualTeamMatches: number;
  manualTeamCount: number;
  warnings: string[];
  error: string | null;
};
