// The odds page's state kept in the URL (VA-15, NAV-21) through useQueryState, like the
// players and injuries filters: the conference tab and sort (shared by the odds table
// and the seeding grid) and the over-time chart's measure and extra team. Every client
// component on the page reads and writes this one query, so none drops another's keys.
// Parsing is forgiving: an unknown value falls back to its default. Serializing omits
// defaults, so the plain route stays "/odds". Display only. Tests: tests/odds-query.test.ts.

import { teamBySlug, teamDisplay } from "@/lib/view/teams";

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

/** What the over-time chart draws: title odds (the default), playoff odds or projected wins. */
export type ChartMeasure = "champion" | "makePlayoffs" | "projectedWins";

export const CHART_MEASURES: ChartMeasure[] = ["champion", "makePlayoffs", "projectedWins"];

export type OddsQuery = {
  view: OddsView;
  sort: { key: OddsSortKey; descending: boolean };
  /** The chart's measure and the one team a reader picked to highlight (a team id), or null. */
  chart: { measure: ChartMeasure; team: string | null };
};

export const ODDS_DEFAULT: OddsQuery = {
  view: "East",
  sort: { key: "projectedWins", descending: true },
  chart: { measure: "champion", team: null },
};

const MEASURE_SLUGS: Record<ChartMeasure, string> = { champion: "title", makePlayoffs: "playoffs", projectedWins: "wins" };

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
  const chart = parseChart(params);
  if (!key) return { view, sort: ODDS_DEFAULT.sort, chart };
  const descending = dir === "asc" ? false : dir === "desc" ? true : defaultDescending(key);
  return { view, sort: { key, descending }, chart };
}

function parseChart(params: URLSearchParams): OddsQuery["chart"] {
  const measureSlug = (params.get("measure") ?? "").trim().toLowerCase();
  const measure = CHART_MEASURES.find((name) => MEASURE_SLUGS[name] === measureSlug) ?? ODDS_DEFAULT.chart.measure;
  const team = teamBySlug((params.get("team") ?? "").trim())?.id ?? null;
  return { measure, team };
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
  if (query.chart.measure !== ODDS_DEFAULT.chart.measure) params.set("measure", MEASURE_SLUGS[query.chart.measure]);
  if (query.chart.team !== null) params.set("team", teamDisplay(query.chart.team).slug);
  const text = params.toString();
  return text ? `?${text}` : "";
}
