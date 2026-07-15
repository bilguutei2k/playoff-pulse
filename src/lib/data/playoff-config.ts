// MANUAL DATA - Last updated 2026-07-12 02:45 PM PT
// All ratings, player impacts, and injury statuses are manual estimates based on
// public reporting. This is not official NBA data. The 2026 playoffs are
// complete: NYK defeated SAS 4-1 in the NBA Finals (Game 5 on June 13).
// Game 4 and Game 5 results were verified against the ESPN public scoreboard
// on July 12, 2026 (Game 4: NYK 107-106 at New York; Game 5: NYK 94-90 at
// San Antonio). Ratings and player impacts remain manual estimates.
// Do NOT present these ratings as official statistics.

import type { InjuryStatus, PlayoffConfig, Team } from "@/lib/model/types";

export const dataLastUpdated = "2026-07-12";
export const dataLastUpdatedTimestamp = "2026-07-12 02:45 PM PT";
export const dataSnapshotLabel = "Manual data snapshot";
export const liveApiStatus = "Read-only live scoreboard probe";

type PlayerInput = {
  name: string;
  projectedMinutes: number;
  impact: number;
  status: InjuryStatus;
  healthyProjectedMinutes?: number;
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
      healthyProjectedMinutes: player.healthyProjectedMinutes,
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
    { name: "Jalen Brunson", projectedMinutes: 38, impact: 8.5, status: "healthy" },
    { name: "Karl-Anthony Towns", projectedMinutes: 34, impact: 5.5, status: "healthy" },
    { name: "OG Anunoby", projectedMinutes: 32, impact: 4.5, status: "healthy" },
    { name: "Mikal Bridges", projectedMinutes: 32, impact: 3.5, status: "healthy" },
    { name: "Josh Hart", projectedMinutes: 30, impact: 3.0, status: "healthy" },
    { name: "Landry Shamet", projectedMinutes: 28, impact: 1.0, status: "healthy" },
    { name: "Miles McBride", projectedMinutes: 20, impact: 1.2, status: "healthy" },
    { name: "Mitchell Robinson", projectedMinutes: 14, impact: 1.0, status: "healthy" },
    { name: "Jose Alvarado", projectedMinutes: 8, impact: 0.8, status: "healthy" },
    { name: "Jordan Clarkson", projectedMinutes: 4, impact: 0.8, status: "healthy" },
    { name: "Jeremy Sochan", projectedMinutes: 0, impact: 0.7, status: "healthy" },
    { name: "Pacome Dadiet", projectedMinutes: 0, impact: 0.2, status: "healthy" },
    { name: "Tyler Kolek", projectedMinutes: 0, impact: 0.2, status: "healthy" },
    { name: "Mohamed Diawara", projectedMinutes: 0, impact: 0.1, status: "healthy" },
    { name: "Ariel Hukporti", projectedMinutes: 0, impact: 0.2, status: "healthy" },
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
    { name: "Jalen Williams", projectedMinutes: 0, healthyProjectedMinutes: 35, impact: 6.5, status: "out" },
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
    { name: "Donte DiVincenzo", projectedMinutes: 0, healthyProjectedMinutes: 26, impact: 2.5, status: "out" },
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
    { name: "Victor Wembanyama", projectedMinutes: 38, impact: 10.0, status: "healthy" },
    { name: "De'Aaron Fox", projectedMinutes: 38, impact: 6.5, status: "healthy" },
    { name: "Devin Vassell", projectedMinutes: 36, impact: 3.5, status: "healthy" },
    { name: "Stephon Castle", projectedMinutes: 34, impact: 4.0, status: "healthy" },
    { name: "Julian Champagnie", projectedMinutes: 32, impact: 2.0, status: "healthy" },
    { name: "Dylan Harper", projectedMinutes: 28, impact: 3.0, status: "healthy" },
    { name: "Harrison Barnes", projectedMinutes: 12, impact: 1.5, status: "healthy" },
    { name: "Luke Kornet", projectedMinutes: 10, impact: 1.0, status: "healthy" },
    { name: "Keldon Johnson", projectedMinutes: 8, impact: 1.5, status: "healthy" },
    { name: "Carter Bryant", projectedMinutes: 4, impact: 0.5, status: "healthy" },
    { name: "Kelly Olynyk", projectedMinutes: 0, impact: 0.8, status: "healthy" },
    { name: "Bismack Biyombo", projectedMinutes: 0, impact: 0.5, status: "healthy" },
    { name: "Mason Plumlee", projectedMinutes: 0, impact: 0.4, status: "healthy" },
    { name: "Jordan McLaughlin", projectedMinutes: 0, impact: 0.3, status: "healthy" },
    { name: "Lindy Waters III", projectedMinutes: 0, impact: 0.4, status: "healthy" },
  ],
);

export const playoffConfig: PlayoffConfig = {
  notes: [
    "Manual data only. Ratings, player impacts, injury statuses, and availability are estimates, not official NBA data.",
    "The 2026 playoffs are complete. Series state updated 2026-07-12 with the final NBA Finals result after the automated refresh silently failed to match ESPN's NY/SA abbreviations (fixed the same day).",
    "NBA Finals roster inputs were re-checked against public Game 2 notes on June 5; projected minutes use Game 1 participation as the baseline.",
    "DET-CLE completed 4-3: DET won Game 6, 115-94; CLE won Game 7, 125-94.",
    "MIN-SAS completed 4-2: SAS won Game 6, 139-109.",
    "NYK-CLE Conference Final completed 4-0: NYK won Game 3, 121-108, and Game 4, 130-93.",
    "OKC-SAS Conference Final completed 4-3: SAS won Game 6, 118-91, and Game 7, 111-103.",
    "NBA Finals Game 1: NYK 105, SAS 95 at San Antonio.",
    "NBA Finals Game 2: NYK 105, SAS 104 at San Antonio.",
    "NBA Finals Game 3: SAS 115, NYK 111 at New York.",
    "NBA Finals Game 4: NYK 107, SAS 106 at New York (June 10).",
    "NBA Finals Game 5: NYK 94, SAS 90 at San Antonio (June 13). NYK won the NBA Finals 4-1.",
    "OKC-LAL completed 4-0; OKC has advanced to the West Conference Finals.",
    "NYK-PHI is completed and inactive; NYK is represented as already advanced to the East Conference Finals.",
    "PHI is retained only as an inactive completed-series placeholder because the existing Series type requires both team IDs to resolve.",
    "LAL is retained only as an inactive completed-series participant because the existing Series type requires both team IDs to resolve.",
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
      winsA: 3,
      winsB: 4,
      homePattern: ["det", "det", "cle", "cle", "det", "cle", "det"],
    },
    {
      id: "east-cf-nyk-cle",
      round: "Conference Final",
      conference: "East",
      bracketOrder: 1,
      teamA: "nyk",
      teamB: "cle",
      winsA: 4,
      winsB: 0,
      homePattern: ["nyk", "nyk", "cle", "cle", "nyk", "cle", "nyk"],
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
      winsA: 4,
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
      winsB: 4,
      homePattern: ["sas", "sas", "min", "min", "sas", "min", "sas"],
    },
    {
      id: "west-cf-okc-sas",
      round: "Conference Final",
      conference: "West",
      bracketOrder: 1,
      teamA: "okc",
      teamB: "sas",
      winsA: 3,
      winsB: 4,
      homePattern: ["okc", "okc", "sas", "sas", "okc", "sas", "okc"],
    },
    {
      id: "nba-finals-sas-nyk",
      round: "NBA Finals",
      conference: "Finals",
      bracketOrder: 1,
      teamA: "sas",
      teamB: "nyk",
      winsA: 1,
      winsB: 4,
      homePattern: ["sas", "sas", "nyk", "nyk", "sas", "nyk", "sas"],
    },
  ],
  marketOdds: [],
};
