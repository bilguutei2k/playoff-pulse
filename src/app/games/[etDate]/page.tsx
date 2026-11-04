import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DayPage } from "@/components/live/DayPage";
import { loadDayView } from "@/lib/live-data/day-loader";
import { formatLongDay, isEtDate } from "@/lib/utils/dates";
import { getGameCountsByDate } from "@/lib/live-data/published";

// Rendered on demand from main's published data and re-rendered about once a minute
// (src/lib/live-data/published.ts). No paths are built ahead: data commits do not deploy.
export const revalidate = 60;
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

type Params = { params: Promise<{ etDate: string }> };

/** A real date within the stored season, with a week of slack at either end. */
async function validDate(etDate: string): Promise<boolean> {
  if (!isEtDate(etDate)) return false;
  const days = Object.keys(await getGameCountsByDate()).sort();
  if (days.length === 0) return true;
  const slack = (day: string, offset: number) =>
    new Date(Date.parse(`${day}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
  return etDate >= slack(days[0], -7) && etDate <= slack(days.at(-1)!, 7);
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { etDate } = await params;
  if (!(await validDate(etDate))) return { title: "Day not found" };
  return {
    title: `NBA games, ${formatLongDay(etDate)}`,
    description: `Every NBA game on ${formatLongDay(etDate)} with 548's win probabilities and the market reference.`,
  };
}

export default async function GamesDayPage({ params }: Params) {
  const { etDate } = await params;
  if (!(await validDate(etDate))) notFound();
  const view = await loadDayView(etDate);
  return <DayPage view={view} home={false} />;
}
