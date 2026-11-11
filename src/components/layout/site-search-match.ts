// Matching and ranking for the masthead's quick finder (SiteSearch.tsx). Pure, no React;
// tests in tests/site-search.test.ts. Display only: no forecast data passes through here.
//
// Text is folded before comparing: accents dropped ("Jokić" matches "jokic"), case
// ignored, periods and apostrophes removed ("pj" matches "P.J.", "deaaron" matches
// "De'Aaron"), and any other punctuation read as a space ("gilgeous alexander" matches
// "Gilgeous-Alexander"). A match is ranked by where it falls:
//   0 the whole text, 1 its start, 2 the start of a later word, 3 inside a word (two or
//   more characters typed), 4 every typed word starts some word of the text, in any order.
// Teams are always listed before players; within a group, better tiers first.

import { SEASON_TEAMS } from "@/lib/season/teams";
import { teamDisplay, teamHref } from "@/lib/view/teams";

/** Letters NFD does not split into a base letter and a mark. */
const SPECIAL: Record<string, string> = { ø: "o", ł: "l", đ: "d", æ: "ae", œ: "oe", ß: "ss", ı: "i", þ: "th" };

function foldChar(ch: string): string {
  const lower = ch.toLowerCase();
  if (SPECIAL[lower]) return SPECIAL[lower];
  const base = lower.normalize("NFD").replace(/\p{M}/gu, "");
  if (/^[.'’‘`ʼ]$/.test(base)) return "";
  return /^[a-z0-9]+$/.test(base) ? base : " ";
}

export type Folded = {
  /** Folded text: lower-case a-z, 0-9 and single spaces, trimmed. */
  text: string;
  /** For each character of `text`, the index of the original character it came from. */
  from: number[];
};

/** Folds text for matching, keeping where each folded character came from (for highlights). */
export function foldWithMap(source: string): Folded {
  let text = "";
  const from: number[] = [];
  let index = 0;
  for (const ch of source) {
    for (const out of foldChar(ch)) {
      if (out === " " && (text === "" || text.endsWith(" "))) continue;
      text += out;
      from.push(index);
    }
    index += ch.length;
  }
  if (text.endsWith(" ")) {
    text = text.slice(0, -1);
    from.pop();
  }
  return { text, from };
}

/** Folds text for matching (see the file comment). */
export function fold(source: string): string {
  return foldWithMap(source).text;
}

export type Hit = {
  tier: number;
  /** The matched span in the original text, or null when the match has no single span. */
  span: [number, number] | null;
};

/** How `query` (already folded, non-empty) matches `target`, or null when it does not. */
export function matchFolded(target: Folded, query: string, source: string): Hit | null {
  const text = target.text;
  if (!query || !text) return null;
  const toSpan = (start: number): [number, number] => {
    const end = start + query.length - 1;
    const last = target.from[end];
    // End after the whole original character (a folded "ss" from "ß" is one character).
    const next = target.from.findIndex((value, i) => i > end && value > last);
    return [target.from[start], next === -1 ? source.length : target.from[next]];
  };
  if (text === query) return { tier: 0, span: [0, source.length] };
  if (text.startsWith(query)) return { tier: 1, span: toSpan(0) };
  const word = text.indexOf(` ${query}`);
  if (word !== -1) return { tier: 2, span: toSpan(word + 1) };
  if (query.length >= 2) {
    const inner = text.indexOf(query);
    if (inner !== -1) return { tier: 3, span: toSpan(inner) };
  }
  const tokens = query.split(" ");
  if (tokens.length > 1) {
    const words = text.split(" ");
    if (tokens.every((token) => words.some((w) => w.startsWith(token)))) return { tier: 4, span: null };
  }
  return null;
}

// ---------------------------------------------------------------------------------------

export type SearchTeam = {
  id: string;
  /** "Oklahoma City Thunder", shown and highlighted. */
  name: string;
  /** "OKC", shown beside the name. */
  code: string;
  href: string;
  /** Other strings that find the team: city, nickname, ESPN slug, common short names. */
  keys: string[];
};

export type SearchPlayer = {
  /** ESPN athlete ID. */
  id: string;
  name: string;
  /** ESPN team ID of his latest stored game. */
  team: string;
};

export type TeamResult = { team: SearchTeam; tier: number; nameSpan: [number, number] | null; codeHit: boolean };
export type PlayerResult = { player: SearchPlayer; tier: number; span: [number, number] | null };

export type PreparedTeam = { team: SearchTeam; name: Folded; code: string; keys: string[] };
export type PreparedPlayer = { player: SearchPlayer; name: Folded; order: number };

/** Familiar names a city, nickname or tricode does not cover, by ESPN team ID. */
export const TEAM_ALIASES: Record<string, string[]> = {
  "5": ["cavs"],
  "6": ["mavs"],
  "9": ["dubs"],
  "12": ["los angeles clippers"],
  "13": ["la lakers"],
  "16": ["wolves", "t wolves"],
  "20": ["sixers", "philly"],
  "22": ["blazers"],
};

/** The 30 teams as the finder searches them. */
export function searchTeamList(): SearchTeam[] {
  return SEASON_TEAMS.map((row) => {
    const team = teamDisplay(row.id);
    return {
      id: team.id,
      name: team.name,
      code: team.code,
      href: teamHref(team.id),
      keys: [team.slug, team.place, team.shortName, ...(TEAM_ALIASES[team.id] ?? [])],
    };
  });
}

export function prepareTeams(teams: readonly SearchTeam[]): PreparedTeam[] {
  return teams.map((team) => ({
    team,
    name: foldWithMap(team.name),
    code: fold(team.code),
    keys: [team.code, ...team.keys].map(fold).filter(Boolean),
  }));
}

/** Players keep the order they arrive in as the tie-break (the index route sends the most-used first). */
export function preparePlayers(players: readonly SearchPlayer[]): PreparedPlayer[] {
  return players.map((player, order) => ({ player, name: foldWithMap(player.name), order }));
}

function bestKeyTier(keys: readonly string[], query: string): number | null {
  let best: number | null = null;
  for (const key of keys) {
    const hit = matchFolded({ text: key, from: [...key].map((_, i) => i) }, query, key);
    if (hit && (best === null || hit.tier < best)) best = hit.tier;
  }
  return best;
}

export function searchTeams(prepared: readonly PreparedTeam[], rawQuery: string, limit = 6): TeamResult[] {
  const query = fold(rawQuery);
  if (!query) return [];
  const results: TeamResult[] = [];
  for (const entry of prepared) {
    const nameHit = matchFolded(entry.name, query, entry.team.name);
    const codeHit = entry.code === query;
    const keyTier = bestKeyTier(entry.keys, query);
    const tiers = [nameHit?.tier, codeHit ? 0 : undefined, keyTier ?? undefined].filter(
      (tier): tier is number => tier !== undefined,
    );
    if (!tiers.length) continue;
    results.push({ team: entry.team, tier: Math.min(...tiers), nameSpan: nameHit?.span ?? null, codeHit });
  }
  results.sort((a, b) => a.tier - b.tier || a.team.name.localeCompare(b.team.name));
  return results.slice(0, limit);
}

export function searchPlayers(
  prepared: readonly PreparedPlayer[],
  rawQuery: string,
  limit = 8,
): { results: PlayerResult[]; total: number } {
  const query = fold(rawQuery);
  if (!query) return { results: [], total: 0 };
  const hits: Array<PlayerResult & { order: number }> = [];
  for (const entry of prepared) {
    const hit = matchFolded(entry.name, query, entry.player.name);
    if (hit) hits.push({ player: entry.player, tier: hit.tier, span: hit.span, order: entry.order });
  }
  hits.sort((a, b) => a.tier - b.tier || a.order - b.order);
  return { results: hits.slice(0, limit).map(({ player, tier, span }) => ({ player, tier, span })), total: hits.length };
}

/** Splits text around a highlighted span, for rendering a <mark>. */
export function splitSpan(text: string, span: [number, number] | null): [string, string, string] {
  if (!span) return [text, "", ""];
  return [text.slice(0, span[0]), text.slice(span[0], span[1]), text.slice(span[1])];
}
