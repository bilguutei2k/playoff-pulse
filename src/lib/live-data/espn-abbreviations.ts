// ESPN team-abbreviation normalization.
//
// The ESPN scoreboard feed uses several abbreviations that differ from the
// standard NBA tricodes used in `src/lib/data/playoff-config.ts` (e.g. the
// Knicks are "NY" on ESPN but "NYK" in config). Any comparison between a feed
// abbreviation and a config abbreviation MUST go through
// `canonicalTeamAbbreviation` on both sides; comparing raw strings silently
// matches nothing for these teams (this exact bug froze the June 2026 data
// refresh — see docs/CODEBASE_HANDOVER.md, finding P0-1).

const ESPN_ABBREVIATION_ALIASES: Record<string, string> = {
  GS: "GSW",
  NO: "NOP",
  NY: "NYK",
  SA: "SAS",
  UTAH: "UTA",
  WSH: "WAS",
};

export function canonicalTeamAbbreviation(abbreviation: string): string {
  const upper = abbreviation.trim().toUpperCase();
  return ESPN_ABBREVIATION_ALIASES[upper] ?? upper;
}
