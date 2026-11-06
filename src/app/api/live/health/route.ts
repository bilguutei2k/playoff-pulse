import { NextResponse } from "next/server";
import { slateDateAt } from "@/lib/season/live-state";
import { getLiveDataStatus, getLiveState, getSeasonGames } from "@/lib/live-data/published";
import { STALE_AFTER_HOURS } from "@/lib/season/slate";

export const dynamic = "force-dynamic";

/**
 * Monitors can poll this: 503 means published data is stale on a game day. `data` says
 * where this response's state came from: a commit of the data branch over the network, or
 * the copy bundled with the deployment when GitHub could not be read. `deployment` is the
 * commit this deployment was built from; the live job compares it with main to retry a
 * code deploy Vercel refused.
 */
export async function GET() {
  const [liveState, data, games] = await Promise.all([getLiveState(), getLiveDataStatus(), getSeasonGames()]);
  const now = new Date().toISOString();
  const ageHours = (Date.parse(now) - Date.parse(liveState.generatedAt)) / 3_600_000;
  const slate = slateDateAt(now);
  const gamesToday = games.some((game) => game.etDate === slate && game.status !== "canceled");
  const stale = gamesToday ? ageHours > STALE_AFTER_HOURS : ageHours > 36;
  return NextResponse.json(
    {
      status: stale ? "stale" : "ok",
      generatedAt: liveState.generatedAt,
      ageHours: Number(ageHours.toFixed(2)),
      slate,
      modelVersion: liveState.modelVersion,
      notes: liveState.notes,
      data,
      deployment: {
        commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
        ref: process.env.VERCEL_GIT_COMMIT_REF ?? null,
        environment: process.env.VERCEL_ENV ?? null,
      },
    },
    { status: stale ? 503 : 200, headers: { "Cache-Control": "no-store" } },
  );
}
