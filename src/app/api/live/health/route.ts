import { NextResponse } from "next/server";
import { slateDateAt } from "@/lib/season/live-state";
import { liveState } from "@/lib/season/published";
import { STALE_AFTER_HOURS } from "@/lib/season/slate";

export const dynamic = "force-dynamic";

/** Monitors can poll this: 503 means published data is stale on a game day. */
export async function GET() {
  const now = new Date().toISOString();
  const ageHours = (Date.parse(now) - Date.parse(liveState.generatedAt)) / 3_600_000;
  const slate = slateDateAt(now);
  const gamesToday = liveState.nextSlateEtDate === slate;
  const stale = gamesToday ? ageHours > STALE_AFTER_HOURS : ageHours > 36;
  return NextResponse.json(
    {
      status: stale ? "stale" : "ok",
      generatedAt: liveState.generatedAt,
      ageHours: Number(ageHours.toFixed(2)),
      slate,
      modelVersion: liveState.modelVersion,
      notes: liveState.notes,
    },
    { status: stale ? 503 : 200, headers: { "Cache-Control": "no-store" } },
  );
}
