import { NextResponse } from "next/server";
import { loadSlateView } from "@/lib/live-data/live-slate";

export const dynamic = "force-dynamic";

export async function GET() {
  const view = await loadSlateView();
  return NextResponse.json(view, {
    headers: {
      "Cache-Control": view.scoresAvailable
        ? "s-maxage=30, stale-while-revalidate=60"
        : "no-store",
    },
  });
}
