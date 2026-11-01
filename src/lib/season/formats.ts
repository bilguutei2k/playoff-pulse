// Per-season competition format. Fails closed outside the registered range, so
// a future season must be declared here rather than silently inheriting rules.

export type SeasonFormat = {
  season: number;
  /** Scheduled regular-season games per team. */
  gamesPerTeam: number;
  /** Seeds 7-10 play in for the last two spots. */
  playIn: boolean;
  /** Excluded from season-level gates because the format was irregular. */
  irregular: boolean;
};

export const FIRST_SEASON = 2005;
export const LAST_REGISTERED_SEASON = 2027;

export function seasonFormat(season: number): SeasonFormat {
  if (
    !Number.isInteger(season) ||
    season < FIRST_SEASON ||
    season > LAST_REGISTERED_SEASON
  ) {
    throw new Error(`Season ${season} has no registered format.`);
  }
  if (season === 2012) {
    return { season, gamesPerTeam: 66, playIn: false, irregular: false };
  }
  if (season === 2020) {
    // Shutdown and bubble: uneven game counts and a one-off play-in series.
    return { season, gamesPerTeam: 72, playIn: false, irregular: true };
  }
  if (season === 2021) {
    return { season, gamesPerTeam: 72, playIn: true, irregular: true };
  }
  return { season, gamesPerTeam: 82, playIn: season >= 2022, irregular: false };
}

const BUBBLE_START_MS = Date.parse("2020-07-30T00:00:00Z");
const BUBBLE_END_MS = Date.parse("2020-10-13T00:00:00Z");

/** ESPN does not flag bubble games as neutral, so dates decide. */
export function isBubbleDate(tipUtc: string): boolean {
  const time = Date.parse(tipUtc);
  return time >= BUBBLE_START_MS && time < BUBBLE_END_MS;
}

/** ESPN URL/label season for an ending year, e.g. 2027 becomes "2026-27". */
export function seasonLabel(season: number): string {
  return `${season - 1}-${String(season).slice(2)}`;
}
