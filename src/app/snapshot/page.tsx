import type { Metadata } from "next";
import Link from "next/link";
import { ForecastDashboard } from "@/components/forecast/ForecastDashboard";

export const metadata: Metadata = {
  title: "Playoff Pulse — 2026 Final Snapshot",
  description:
    "Frozen final state of the completed 2026 postseason dashboard. Terminal probabilities are accounting, not forecast skill.",
};

export default function SnapshotPage() {
  return (
    <main className="min-h-screen bg-[var(--color-bg-primary)]">
      <div className="mx-auto flex max-w-7xl flex-col gap-[18px] px-3 py-3 md:px-[18px] md:py-[18px]">
        <section className="pp-card">
          <div className="p-4">
            <div className="pp-kicker text-[var(--color-warning)]">
              Frozen snapshot / terminal state
            </div>
            <h1 className="mt-3 text-2xl font-bold tracking-normal text-[var(--color-text-primary)]">
              Final 2026 dashboard state
            </h1>
            <p className="mt-3 max-w-4xl text-sm leading-6 text-[var(--color-text-muted)]">
              This is the completed-season dashboard preserved exactly as it
              ended. The configured 2026 postseason is over — the Knicks beat
              the Spurs 4–1 — so the 100% and 0% championship figures below are
              terminal-state accounting after a finished bracket, not evidence
              of forecasting skill. No game-by-game forecasts were issued
              during the 2026 postseason. For evaluation evidence, see the{" "}
              <Link href="/evidence" className="underline decoration-2 underline-offset-2">
                research archive
              </Link>{" "}
              or the{" "}
              <Link href="/" className="underline decoration-2 underline-offset-2">
                retrospective
              </Link>
              .
            </p>
          </div>
        </section>

        <ForecastDashboard />
      </div>
    </main>
  );
}
