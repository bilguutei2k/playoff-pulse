// MANUAL DATA — Last updated 2026-05-11
// All ratings, player impacts, and injury statuses are manual estimates based on
// public reporting. This is not official NBA data. Series states reflect Games 1-3
// of DET-CLE and OKC-LAL (Game 4s are tonight, May 11).
// Injury sources: ESPN, Yahoo Sports, NBA.com — verified May 11, 2026.
// Do NOT present these ratings as official statistics.

import type { InjuryStatus, PlayoffConfig, Team } from "@/lib/model/types";

export const dataLastUpdated = "2026-05-11";

type PlayerInput = {
  name: string;
  projectedMinutes: number;
  impact: number;
  status: InjuryStatus;
};

function team(
  id: string,
  name: string,
  abbreviation: string,
  conference: Team["conference"],
  seed: number,
  eloRating: number,
  netRating: number,
  manualAdjustment: number,
  players: PlayerInput[],
): Team {
  return {
    id,
    name,
    abbreviation,
    conference,
    seed,
    eloRating,
    netRating,
    manualAdjustment,
    players: players.map((player, index) => ({
      id: `${id}-${index + 1}`,
      name: player.name,
      teamId: id,
      impact: player.impact,
      projectedMinutes: player.projectedMinutes,
      injuryStatus: player.status,
    })),
  };
}

const nyk = team(
  "nyk",
  "New York Knicks",
  "NYK",
  "East",
  3,
  1535,
  5.2,
  0,
  [
    { name: "Jalen Brunson", projectedMinutes: 38, impact: 7.5, status: "healthy" },
    { name: "Karl-Anthony Towns", projectedMinutes: 33, impact: 5.0, status: "healthy" },
    { name: "OG Anunoby", projectedMinutes: 28, impact: 6.0, status: "questionable" },
    { name: "Mikal Bridges", projectedMinutes: 32, impact: 3.5, status: "healthy" },
    { name: "Josh Hart", projectedMinutes: 30, impact: 2.5, status: "healthy" },
    { name: "Miles McBride", projectedMinutes: 22, impact: 1.5, status: "healthy" },
    { name: "Precious Achiuwa", projectedMinutes: 14, impact: 0.5, status: "healthy" },
  ],
);

const det = team(
  "det",
  "Detroit Pistons",
  "DET",
  "East",
  1,
  1558,
  7.1,
  0,
  [
    { name: "Cade Cunningham", projectedMinutes: 37, impact: 7.5, status: "healthy" },
    { name: "Ausar Thompson", projectedMinutes: 32, impact: 3.5, status: "healthy" },
    { name: "Jalen Duren", projectedMinutes: 28, impact: 3.0, status: "healthy" },
    { name: "Tobias Harris", projectedMinutes: 28, impact: 2.0, status: "healthy" },
    { name: "Kevin Huerter", projectedMinutes: 24, impact: 1.5, status: "healthy" },
    { name: "Marcus Sasser", projectedMinutes: 20, impact: 1.0, status: "healthy" },
    { name: "Caris Levert", projectedMinutes: 18, impact: 0.5, status: "healthy" },
  ],
);

const cle = team(
  "cle",
  "Cleveland Cavaliers",
  "CLE",
  "East",
  4,
  1522,
  4.8,
  0,
  [
    { name: "Donovan Mitchell", projectedMinutes: 37, impact: 7.0, status: "healthy" },
    { name: "James Harden", projectedMinutes: 33, impact: 4.5, status: "healthy" },
    { name: "Evan Mobley", projectedMinutes: 32, impact: 4.0, status: "healthy" },
    { name: "Jarrett Allen", projectedMinutes: 27, impact: 2.5, status: "healthy" },
    { name: "Max Strus", projectedMinutes: 22, impact: 1.0, status: "healthy" },
    { name: "Sam Merrill", projectedMinutes: 18, impact: 0.5, status: "healthy" },
    { name: "Dean Wade", projectedMinutes: 15, impact: 0.0, status: "healthy" },
  ],
);

const phi = team(
  "phi",
  "Philadelphia 76ers",
  "PHI",
  "East",
  7,
  1480,
  0,
  0,
  [
    { name: "Inactive eliminated placeholder", projectedMinutes: 0, impact: 0, status: "out" },
  ],
);

const okc = team(
  "okc",
  "Oklahoma City Thunder",
  "OKC",
  "West",
  1,
  1585,
  9.2,
  // Judgment call: Williams (2nd-best player, ~6.5 impact) has been out 6 games.
  // Player-impact excludes him, but net rating and Elo do not. -1.0 partially
  // corrects for that without overcorrecting.
  -1.0,
  [
    { name: "Shai Gilgeous-Alexander", projectedMinutes: 38, impact: 9.0, status: "healthy" },
    { name: "Jalen Williams", projectedMinutes: 0, impact: 6.5, status: "out" },
    { name: "Ajay Mitchell", projectedMinutes: 34, impact: 4.0, status: "healthy" },
    { name: "Chet Holmgren", projectedMinutes: 30, impact: 4.5, status: "healthy" },
    { name: "Isaiah Hartenstein", projectedMinutes: 26, impact: 2.5, status: "healthy" },
    { name: "Alex Caruso", projectedMinutes: 22, impact: 2.0, status: "healthy" },
    { name: "Lu Dort", projectedMinutes: 20, impact: 1.5, status: "healthy" },
  ],
);

const lal = team(
  "lal",
  "Los Angeles Lakers",
  "LAL",
  "West",
  4,
  1498,
  3.4,
  0,
  [
    { name: "LeBron James", projectedMinutes: 36, impact: 6.5, status: "healthy" },
    { name: "Anthony Davis", projectedMinutes: 34, impact: 6.0, status: "healthy" },
    { name: "Austin Reaves", projectedMinutes: 30, impact: 3.0, status: "healthy" },
    { name: "Rui Hachimura", projectedMinutes: 26, impact: 2.0, status: "healthy" },
    { name: "Deandre Ayton", projectedMinutes: 22, impact: 1.5, status: "healthy" },
    { name: "Max Christie", projectedMinutes: 20, impact: 0.5, status: "healthy" },
    { name: "Gabe Vincent", projectedMinutes: 16, impact: 0.0, status: "healthy" },
  ],
);

const min = team(
  "min",
  "Minnesota Timberwolves",
  "MIN",
  "West",
  6,
  1510,
  4.1,
  0,
  [
    { name: "Anthony Edwards", projectedMinutes: 38, impact: 8.0, status: "healthy" },
    { name: "Julius Randle", projectedMinutes: 31, impact: 4.0, status: "healthy" },
    { name: "Rudy Gobert", projectedMinutes: 27, impact: 3.0, status: "healthy" },
    { name: "Ayo Dosunmu", projectedMinutes: 28, impact: 3.5, status: "healthy" },
    { name: "Jaden McDaniels", projectedMinutes: 28, impact: 2.5, status: "healthy" },
    { name: "Naz Reid", projectedMinutes: 22, impact: 2.0, status: "healthy" },
    { name: "Donte DiVincenzo", projectedMinutes: 0, impact: 2.5, status: "out" },
    { name: "Mike Conley", projectedMinutes: 18, impact: 1.0, status: "healthy" },
    { name: "Terrence Shannon Jr.", projectedMinutes: 18, impact: 1.0, status: "healthy" },
  ],
);

const sas = team(
  "sas",
  "San Antonio Spurs",
  "SAS",
  "West",
  2,
  1552,
  6.8,
  0,
  [
    { name: "Victor Wembanyama", projectedMinutes: 35, impact: 9.5, status: "healthy" },
    { name: "Stephon Castle", projectedMinutes: 32, impact: 4.0, status: "healthy" },
    { name: "Devin Vassell", projectedMinutes: 28, impact: 3.0, status: "healthy" },
    { name: "Harrison Barnes", projectedMinutes: 26, impact: 1.5, status: "healthy" },
    { name: "Zach Collins", projectedMinutes: 22, impact: 1.5, status: "healthy" },
    { name: "Julian Champagnie", projectedMinutes: 18, impact: 0.5, status: "healthy" },
    { name: "Malaki Branham", projectedMinutes: 16, impact: 0.5, status: "healthy" },
  ],
);

export const playoffConfig: PlayoffConfig = {
  notes: [
    "Manual data only. Ratings, player impacts, injury statuses, and availability are estimates, not official NBA data.",
    "Series state is locked to 2026-05-11 before DET-CLE Game 4 and OKC-LAL Game 4.",
    "NYK-PHI is completed and inactive; NYK is represented as already advanced to the East Conference Finals.",
    "PHI is retained only as an inactive completed-series placeholder because the existing Series type requires both team IDs to resolve.",
    "Self-advance first-round placeholders preserve the existing bracket simulator shape without changing the active current playoff series.",
    "Market odds records are not active in this configuration.",
  ],
  teams: [nyk, det, cle, phi, okc, lal, min, sas],
  series: [
    {
      id: "east-entry-nyk-advanced",
      round: "First Round",
      conference: "East",
      bracketOrder: 1,
      teamA: "nyk",
      teamB: "nyk",
      winsA: 4,
      winsB: 0,
      homePattern: ["nyk", "nyk", "nyk", "nyk", "nyk", "nyk", "nyk"],
    },
    {
      id: "east-entry-phi-eliminated",
      round: "First Round",
      conference: "East",
      bracketOrder: 2,
      teamA: "phi",
      teamB: "phi",
      winsA: 4,
      winsB: 0,
      homePattern: ["phi", "phi", "phi", "phi", "phi", "phi", "phi"],
    },
    {
      id: "east-entry-det-active",
      round: "First Round",
      conference: "East",
      bracketOrder: 3,
      teamA: "det",
      teamB: "det",
      winsA: 4,
      winsB: 0,
      homePattern: ["det", "det", "det", "det", "det", "det", "det"],
    },
    {
      id: "east-entry-cle-active",
      round: "First Round",
      conference: "East",
      bracketOrder: 4,
      teamA: "cle",
      teamB: "cle",
      winsA: 4,
      winsB: 0,
      homePattern: ["cle", "cle", "cle", "cle", "cle", "cle", "cle"],
    },
    {
      id: "east-sf-nyk-phi",
      round: "Conference Semifinal",
      conference: "East",
      bracketOrder: 1,
      teamA: "nyk",
      teamB: "phi",
      winsA: 4,
      winsB: 0,
      homePattern: ["nyk", "nyk", "phi", "phi", "nyk", "phi", "nyk"],
    },
    {
      id: "east-sf-det-cle",
      round: "Conference Semifinal",
      conference: "East",
      bracketOrder: 2,
      teamA: "det",
      teamB: "cle",
      winsA: 2,
      winsB: 1,
      homePattern: ["det", "det", "cle", "cle", "det", "cle", "det"],
    },
    {
      id: "west-entry-okc-active",
      round: "First Round",
      conference: "West",
      bracketOrder: 1,
      teamA: "okc",
      teamB: "okc",
      winsA: 4,
      winsB: 0,
      homePattern: ["okc", "okc", "okc", "okc", "okc", "okc", "okc"],
    },
    {
      id: "west-entry-lal-active",
      round: "First Round",
      conference: "West",
      bracketOrder: 2,
      teamA: "lal",
      teamB: "lal",
      winsA: 4,
      winsB: 0,
      homePattern: ["lal", "lal", "lal", "lal", "lal", "lal", "lal"],
    },
    {
      id: "west-entry-min-active",
      round: "First Round",
      conference: "West",
      bracketOrder: 3,
      teamA: "min",
      teamB: "min",
      winsA: 4,
      winsB: 0,
      homePattern: ["min", "min", "min", "min", "min", "min", "min"],
    },
    {
      id: "west-entry-sas-active",
      round: "First Round",
      conference: "West",
      bracketOrder: 4,
      teamA: "sas",
      teamB: "sas",
      winsA: 4,
      winsB: 0,
      homePattern: ["sas", "sas", "sas", "sas", "sas", "sas", "sas"],
    },
    {
      id: "west-sf-okc-lal",
      round: "Conference Semifinal",
      conference: "West",
      bracketOrder: 1,
      teamA: "okc",
      teamB: "lal",
      winsA: 3,
      winsB: 0,
      homePattern: ["okc", "okc", "lal", "lal", "okc", "lal", "okc"],
    },
    {
      id: "west-sf-min-sas",
      round: "Conference Semifinal",
      conference: "West",
      bracketOrder: 2,
      teamA: "min",
      teamB: "sas",
      winsA: 2,
      winsB: 2,
      homePattern: ["sas", "sas", "min", "min", "sas", "min", "sas"],
    },
  ],
  marketOdds: [],
};
