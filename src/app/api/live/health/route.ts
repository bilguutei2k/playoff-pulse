import { NextResponse } from "next/server";
import { slateDateAt } from "@/lib/season/live-state";
import { getLiveHealthSnapshot } from "@/lib/live-data/published";
import { STALE_AFTER_HOURS } from "@/lib/season/slate";

export const dynamic = "force-dynamic";

/**
 * Monitors can poll this: 503 means published data is stale on a game day. Whether today
 * is a game day comes from the published games file and today's slate date (ET), not from
 * the state's `nextSlateEtDate`, which is as old as the state itself; postponed and canceled
 * games do not count. `data` says where this response's state came from: a commit of the
 * data branch over the network (`commit`; `head` is the branch's head, and `problem` says
 * why they differ), or the copy bundled with the deployment when no complete snapshot
 * could be read. `delivery` names the copy this response's state is, in the same terms as
 * the masthead chip's `data-state-delivery` and FreshnessGuard (src/lib/live-data/published.ts,
 * "Delivery"): "current" (the data branch's head), "older" (the last complete snapshot of an
 * older commit) or "stored" (the bundled copy). `status` and the 503 keep their meaning, the
 * data this server has is old; `delivery` says whether that is the pipeline or this server's
 * reads. `deployment` is the commit this deployment was built from; the live job compares it
 * with main to retry a code deploy Vercel refused.
 */
export async function GET() {
  const { liveState, data, games, delivery } = await getLiveHealthSnapshot();
  const now = new Date().toISOString();
  const ageHours = (Date.parse(now) - Date.parse(liveState.generatedAt)) / 3_600_000;
  const slate = slateDateAt(now);
  const gamesToday = games.some((game) => game.etDate === slate && game.status !== "canceled" && game.status !== "postponed");
  const stale = !Number.isFinite(ageHours) || (gamesToday ? ageHours > STALE_AFTER_HOURS : ageHours > 36);
  return NextResponse.json(
    {
      status: stale ? "stale" : "ok",
      generatedAt: liveState.generatedAt,
      ageHours: Number(ageHours.toFixed(2)),
      slate,
      modelVersion: liveState.modelVersion,
      notes: liveState.notes,
      delivery,
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
