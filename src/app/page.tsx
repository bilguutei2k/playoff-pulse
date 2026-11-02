import type { Metadata } from "next";
import { DayPage } from "@/components/live/DayPage";
import { loadDayView, todayEtDate } from "@/lib/live-data/day-loader";

export const metadata: Metadata = {
  title: { absolute: "548 · NBA forecasts, updated through the day." },
  description:
    "Win probabilities for every NBA game today, sealed before tip and scored in public, with the market's number beside each one for reference and live in-game estimates.",
};

// Re-rendered about once a minute; the page also refreshes itself while games are live.
export const revalidate = 60;

export default async function HomePage() {
  const view = await loadDayView(todayEtDate());
  return <DayPage view={view} home />;
}
