export const NBA_FRANCHISE_IDS = [
  "ATL",
  "BOS",
  "BRK",
  "CHA",
  "CHI",
  "CLE",
  "DAL",
  "DEN",
  "DET",
  "GSW",
  "HOU",
  "IND",
  "LAC",
  "LAL",
  "MEM",
  "MIA",
  "MIL",
  "MIN",
  "NOP",
  "NYK",
  "OKC",
  "ORL",
  "PHI",
  "PHO",
  "POR",
  "SAC",
  "SAS",
  "TOR",
  "UTA",
  "WAS",
] as const;

export type NbaFranchiseId = (typeof NBA_FRANCHISE_IDS)[number];

/**
 * Basketball-Reference team abbreviations mapped to a stable franchise ID.
 *
 * Charlotte has two distinct lineages: CHH moved to New Orleans and therefore
 * maps to NOP, while the 2004 expansion Bobcats (CHA, later CHO) map to CHA.
 */
export const FRANCHISE_ID_BY_TEAM_CODE = {
  ATL: "ATL",
  BOS: "BOS",
  BRK: "BRK",
  NJN: "BRK",
  CHA: "CHA",
  CHO: "CHA",
  CHH: "NOP",
  CHI: "CHI",
  CLE: "CLE",
  DAL: "DAL",
  DEN: "DEN",
  DET: "DET",
  GSW: "GSW",
  HOU: "HOU",
  IND: "IND",
  LAC: "LAC",
  SDC: "LAC",
  LAL: "LAL",
  MEM: "MEM",
  VAN: "MEM",
  MIA: "MIA",
  MIL: "MIL",
  MIN: "MIN",
  NOH: "NOP",
  NOK: "NOP",
  NOP: "NOP",
  NYK: "NYK",
  OKC: "OKC",
  SEA: "OKC",
  ORL: "ORL",
  PHI: "PHI",
  PHO: "PHO",
  POR: "POR",
  SAC: "SAC",
  KCK: "SAC",
  SAS: "SAS",
  TOR: "TOR",
  UTA: "UTA",
  WAS: "WAS",
  WSB: "WAS",
} as const satisfies Record<string, NbaFranchiseId>;

export type HistoricalTeamCode = keyof typeof FRANCHISE_ID_BY_TEAM_CODE;

export function franchiseIdForTeamCode(teamCode: string): NbaFranchiseId {
  const franchiseId = (
    FRANCHISE_ID_BY_TEAM_CODE as Readonly<Record<string, NbaFranchiseId>>
  )[teamCode];
  if (!franchiseId) {
    throw new Error(`Unmapped historical NBA team code: ${teamCode}.`);
  }
  return franchiseId;
}
