import type { MetadataRoute } from "next";
import { getGameCountsByDate, getLiveState } from "@/lib/live-data/published";
import { slateDateAt } from "@/lib/season/live-state";
import { SEASON_TEAMS } from "@/lib/season/teams";
import { SITE_URL, dayHref, teamHref } from "@/lib/view/routes";

/**
 * /sitemap.xml (NAV-18): the live pages, the 30 team pages, game days from two weeks back
 * to one week ahead, and the frozen 2026 archive. Not every player or game: those are
 * reached from the team and day pages.
 */
export const revalidate = 3600;

const LIVE_PATHS = ["/", "/odds", "/injuries", "/players", "/teams", "/record", "/how-it-works", "/about"];
const ARCHIVE_PATHS = ["/retrospective", "/snapshot", "/evidence", "/methodology", "/lab"];
const DAYS_BACK = 14;
const DAYS_AHEAD = 7;

function shiftEtDate(etDate: string, days: number): string {
  const date = new Date(`${etDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [state, counts] = await Promise.all([getLiveState(), getGameCountsByDate()]);
  const updated = Number.isFinite(Date.parse(state.generatedAt)) ? new Date(state.generatedAt) : undefined;
  const today = slateDateAt(Date.now());
  const first = shiftEtDate(today, -DAYS_BACK);
  const last = shiftEtDate(today, DAYS_AHEAD);
  const url = (path: string) => `${SITE_URL}${path === "/" ? "" : path}`;

  const live = LIVE_PATHS.map((path) => ({
    url: url(path),
    lastModified: updated,
    changeFrequency: "hourly" as const,
    priority: path === "/" ? 1 : 0.8,
  }));
  const teams = SEASON_TEAMS.map((team) => ({
    url: url(teamHref(team.id)),
    lastModified: updated,
    changeFrequency: "daily" as const,
    priority: 0.7,
  }));
  const days = Object.keys(counts)
    .filter((etDate) => etDate >= first && etDate <= last && etDate !== today)
    .sort()
    .map((etDate) => ({
      url: url(dayHref(etDate, today)),
      changeFrequency: etDate < today ? ("weekly" as const) : ("daily" as const),
      priority: 0.5,
    }));
  const archive = ARCHIVE_PATHS.map((path) => ({
    url: url(path),
    changeFrequency: "yearly" as const,
    priority: 0.3,
  }));
  return [...live, ...teams, ...days, ...archive];
}
