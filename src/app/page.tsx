import type { Metadata } from "next";
import { LiveDashboard } from "@/components/live/LiveDashboard";
import { TitleOddsLeaderboard } from "@/components/live/TitleOddsLeaderboard";
import { TrackRecord } from "@/components/live/TrackRecord";
import { WhatToKnow } from "@/components/live/WhatToKnow";
import { loadSlateView } from "@/lib/live-data/live-slate";
import { titleOddsChange } from "@/lib/season/history";
import { liveState } from "@/lib/season/published";

export const metadata: Metadata = {
  title: "Playoff Pulse: NBA win probabilities for every game today",
  description:
    "Win probabilities for every NBA game today that account for the NBA injury report, with live in-game estimates and a market reference. Each pregame forecast is sealed before tip and scored in public.",
};

// Re-rendered about once a minute; the client also polls for live scores.
export const revalidate = 60;

export default async function HomePage() {
  const initial = await loadSlateView();
  const records = Object.fromEntries(
    liveState.forecast.teams.map((team) => [team.teamId, `${team.wins}-${team.losses}`]),
  );
  return (
    <main className="pp-container flex flex-col gap-12 py-6 sm:py-10">
      <LiveDashboard initial={initial} records={records} />
      <TitleOddsLeaderboard
        teams={liveState.forecast.teams}
        phase={liveState.forecast.phase}
        generatedAt={liveState.generatedAt}
        change={titleOddsChange(liveState.history)}
      />
      <TrackRecord
        records={liveState.records}
        modelVersion={liveState.modelVersion}
        referenceModelVersion={liveState.referenceModelVersion}
      />
      <WhatToKnow />
    </main>
  );
}
