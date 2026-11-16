import type { Metadata } from "next";
import { DayPage } from "@/components/live/DayPage";
import { loadDayView, todayEtDate } from "@/lib/live-data/day-loader";

export const metadata: Metadata = {
  title: { absolute: "548 · NBA forecasts, updated through the day." },
  description:
    "Win probabilities for every NBA game today, with the market's number beside each one for reference and live in-game estimates. Forecasts sealed before tip are scored in public, and missed seals are counted.",
  alternates: { canonical: "/" },
};

export default async function HomePage() {
  const view = await loadDayView(todayEtDate());
  return <DayPage view={view} home />;
}
