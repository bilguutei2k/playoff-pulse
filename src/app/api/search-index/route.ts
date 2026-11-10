import { NextResponse } from "next/server";
import { getPlayerIndex } from "@/lib/live-data/published";

/**
 * The masthead finder's player list (src/components/layout/SiteSearch.tsx), fetched only
 * when a visitor first opens it, so the index never ships in a page bundle. A trimmed
 * copy of the published player index: ESPN athlete ID, name and current team ID. Players
 * come most minutes played first, which the finder uses to break ties between equally
 * good matches. Regenerated like a page; the index changes only when box scores arrive.
 */
export const revalidate = 300;

export type SearchIndexResponse = {
  players: Array<{ id: string; name: string; team: string }>;
};

export async function GET() {
  const index = await getPlayerIndex();
  const players = (index?.players ?? [])
    .map((player) => ({
      entry: { id: player.athleteId, name: player.name, team: player.teamId },
      minutes: player.perGame ? player.perGame.minutes * player.games : 0,
    }))
    .sort((a, b) => b.minutes - a.minutes || a.entry.name.localeCompare(b.entry.name))
    .map(({ entry }) => entry);
  const body: SearchIndexResponse = { players };
  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
  });
}
