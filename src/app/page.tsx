import type { Metadata } from "next";
import { DayPage } from "@/components/live/DayPage";
import { loadDayView, todayEtDate } from "@/lib/live-data/day-loader";

export const metadata: Metadata = {
  title: { absolute: "548 · NBA forecasts, updated through the day." },
  description:
    "Win probabilities for every NBA game today, with the market for reference and live in-game estimates. Sealed before tip, scored in public; missed seals count.",
  alternates: { canonical: "/" },
};

export default async function HomePage() {
  const view = await loadDayView(todayEtDate());
  return <DayPage view={view} home />;
}
