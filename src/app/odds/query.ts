// The odds table's conference tab and sort, kept in the URL (VA-15, NAV-21) through
// useQueryState, like the players and injuries filters. Parsing is forgiving: an
// unknown value falls back to its default. Serializing omits defaults, so the plain
// route stays "/odds". Display only. Tests: tests/odds-query.test.ts.

export type OddsSortKey =
  | "team"
  | "rating"
  | "ratingNow"
  | "projectedWins"
  | "playIn"
  | "makePlayoffs"
  | "topSix"
  | "reachConferenceFinals"
  | "reachFinals"
  | "champion";

export type OddsView = "East" | "West" | "League";

export type OddsQuery = { view: OddsView; sort: { key: OddsSortKey; descending: boolean } };

export const ODDS_DEFAULT: OddsQuery = { view: "East", sort: { key: "projectedWins", descending: true } };

const VIEW_SLUGS: Record<OddsView, string> = { East: "east", West: "west", League: "all" };

/** Sort keys as they read in a link: `?sort=title`. */
export const SORT_SLUGS: Record<OddsSortKey, string> = {
  team: "team",
  rating: "rating",
  ratingNow: "now",
  projectedWins: "wins",
  playIn: "play-in",
  makePlayoffs: "playoffs",
  topSix: "top-six",
  reachConferenceFinals: "conf-finals",
  reachFinals: "finals",
  champion: "title",
};

/** A column's first click: teams A to Z, every number largest first. */
export function defaultDescending(key: OddsSortKey): boolean {
  return key !== "team";
}

export function parseOddsQuery(search: string): OddsQuery {
  const params = new URLSearchParams(search);
  const conf = (params.get("conf") ?? "").trim().toLowerCase();
  const slug = (params.get("sort") ?? "").trim().toLowerCase();
  const dir = (params.get("dir") ?? "").trim().toLowerCase();
  const view = (Object.keys(VIEW_SLUGS) as OddsView[]).find((key) => VIEW_SLUGS[key] === conf) ?? ODDS_DEFAULT.view;
  const key = (Object.keys(SORT_SLUGS) as OddsSortKey[]).find((name) => SORT_SLUGS[name] === slug);
  if (!key) return { view, sort: ODDS_DEFAULT.sort };
  const descending = dir === "asc" ? false : dir === "desc" ? true : defaultDescending(key);
  return { view, sort: { key, descending } };
}

export function serializeOddsQuery(query: OddsQuery): string {
  const params = new URLSearchParams();
  if (query.view !== ODDS_DEFAULT.view) params.set("conf", VIEW_SLUGS[query.view]);
  const { key, descending } = query.sort;
  const isDefault = key === ODDS_DEFAULT.sort.key && descending === ODDS_DEFAULT.sort.descending;
  if (!isDefault) {
    params.set("sort", SORT_SLUGS[key]);
    if (descending !== defaultDescending(key)) params.set("dir", descending ? "desc" : "asc");
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}
