import { NextResponse } from "next/server";
import { playoffConfig } from "@/lib/data/playoff-config";
import {
  buildUnavailableLiveScoreboardSnapshot,
  fetchEspnNbaScoreboard,
} from "@/lib/live-data/espn-scoreboard";

export const dynamic = "force-dynamic";
export const revalidate = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? undefined;
  const manualTeamAbbreviations = playoffConfig.teams.map(
    (team) => team.abbreviation,
  );

  try {
    const snapshot = await fetchEspnNbaScoreboard({
      date,
      manualTeamAbbreviations,
    });

    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control": "s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    return NextResponse.json(
      buildUnavailableLiveScoreboardSnapshot(
        error instanceof Error ? error.message : "Unknown live data error.",
      ),
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
