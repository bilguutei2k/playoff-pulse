import { ScenarioLab } from "@/components/forecast/ScenarioLab";

export default function LabPage() {
  return (
    <main className="min-h-screen bg-[var(--color-bg-primary)]">
      <div className="mx-auto max-w-7xl px-3 py-3 md:px-[18px] md:py-[18px]">
        <ScenarioLab />
      </div>
    </main>
  );
}
