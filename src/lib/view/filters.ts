// Filter state the injuries and players pages keep in the URL, so a view can be shared
// and Back restores the previous one. Pages are regenerated statically and cannot read
// the query, so the server renders the defaults and the client applies the URL after
// hydration (src/components/live/useQueryState.ts). Parsing is forgiving: anything
// unknown falls back to its default and a malformed query renders the default view with
// no error. Serializing omits defaults, so the plain route stays the plain route. Teams
// travel as codes ("DET"), never as ESPN ids. Tests: tests/view-filters.test.ts.

import type { StatusFilterKey } from "@/lib/view/players";
import { teamDisplay } from "@/lib/view/teams";

export type TeamOption = { id: string; code: string };

/** Status filters as they read in a link. */
export const STATUS_SLUGS: Record<StatusFilterKey, string> = {
  O: "out",
  D: "doubtful",
  Q: "questionable",
  P: "probable",
  missed: "missed",
};

const STATUS_KEYS = Object.keys(STATUS_SLUGS) as StatusFilterKey[];
const QUERY_MAX_LENGTH = 40;

function teamIdFor(code: string | null, teams: ReadonlyArray<TeamOption>): string | null {
  if (!code) return null;
  const wanted = code.trim().toLowerCase();
  return teams.find((team) => team.code.toLowerCase() === wanted)?.id ?? null;
}

function teamCodeFor(id: string, teams: ReadonlyArray<TeamOption>): string | null {
  return teams.find((team) => team.id === id)?.code ?? null;
}

function withQuestionMark(params: URLSearchParams): string {
  const text = params.toString();
  return text ? `?${text}` : "";
}

// ---------------------------------------------------------------------------
// Injuries: team and status.

export type InjuriesQuery = { team: string; status: StatusFilterKey | "all" };

export const INJURIES_DEFAULT: InjuriesQuery = { team: "all", status: "all" };

export function parseInjuriesQuery(search: string, teams: ReadonlyArray<TeamOption>): InjuriesQuery {
  const params = new URLSearchParams(search);
  const slug = (params.get("status") ?? "").trim().toLowerCase();
  return {
    team: teamIdFor(params.get("team"), teams) ?? INJURIES_DEFAULT.team,
    status: STATUS_KEYS.find((key) => STATUS_SLUGS[key] === slug) ?? INJURIES_DEFAULT.status,
  };
}

export function serializeInjuriesQuery(query: InjuriesQuery, teams: ReadonlyArray<TeamOption>): string {
  const params = new URLSearchParams();
  const code = query.team === "all" ? null : teamCodeFor(query.team, teams);
  if (code) params.set("team", code);
  if (query.status !== "all") params.set("status", STATUS_SLUGS[query.status]);
  return withQuestionMark(params);
}

/** "/injuries?team=DET": the injuries page with one team preselected. */
export function injuriesHref(teamId: string): string {
  return `/injuries?team=${encodeURIComponent(teamDisplay(teamId).code)}`;
}

// ---------------------------------------------------------------------------
// Players: search, minimum minutes, team and sort.

export type PlayersQuery = { q: string; min: number; team: string; sort: string; desc: boolean };

export type PlayersQueryOptions = {
  sortKeys: ReadonlyArray<string>;
  minutes: ReadonlyArray<number>;
  teams: ReadonlyArray<TeamOption>;
  /** The direction a column sorts by when first chosen; "dir" is written only when it differs. */
  defaultDescending: (key: string) => boolean;
};

export function parsePlayersQuery(search: string, defaults: PlayersQuery, options: PlayersQueryOptions): PlayersQuery {
  const params = new URLSearchParams(search);
  const q = (params.get("q") ?? "").trim().slice(0, QUERY_MAX_LENGTH);
  const min = Number(params.get("min"));
  const sortParam = params.get("sort");
  const sort = sortParam !== null && options.sortKeys.includes(sortParam) ? sortParam : defaults.sort;
  const dir = params.get("dir");
  let desc: boolean;
  if (dir === "asc" || dir === "desc") desc = dir === "desc";
  else if (sort !== defaults.sort) desc = options.defaultDescending(sort);
  else desc = defaults.desc;
  return {
    q: q || defaults.q,
    min: params.has("min") && options.minutes.includes(min) ? min : defaults.min,
    team: teamIdFor(params.get("team"), options.teams) ?? defaults.team,
    sort,
    desc,
  };
}

export function serializePlayersQuery(query: PlayersQuery, defaults: PlayersQuery, options: PlayersQueryOptions): string {
  const params = new URLSearchParams();
  const q = query.q.trim();
  if (q) params.set("q", q.slice(0, QUERY_MAX_LENGTH));
  if (query.min !== defaults.min) params.set("min", String(query.min));
  const code = query.team === "all" ? null : teamCodeFor(query.team, options.teams);
  if (code) params.set("team", code);
  if (query.sort !== defaults.sort || query.desc !== defaults.desc) {
    params.set("sort", query.sort);
    const implied = query.sort === defaults.sort ? defaults.desc : options.defaultDescending(query.sort);
    if (query.desc !== implied) params.set("dir", query.desc ? "desc" : "asc");
  }
  return withQuestionMark(params);
}
