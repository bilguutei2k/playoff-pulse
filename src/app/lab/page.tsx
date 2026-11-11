import type { Metadata } from "next";
import { ArchiveHeader } from "@/components/forecast/ArchiveHeader";
import { ScenarioLab } from "@/components/forecast/ScenarioLab";

export const metadata: Metadata = { title: "2026 scenario lab", alternates: { canonical: "/lab" } };

export default function LabPage() {
  return (
    <main className="min-h-screen bg-[var(--color-bg-primary)]">
      <ArchiveHeader current="/lab" />
      <div className="mx-auto max-w-7xl px-3 py-3 md:px-[18px] md:py-[18px]">
        <ScenarioLab />
      </div>
    </main>
  );
}
