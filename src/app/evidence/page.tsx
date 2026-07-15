import { EvidenceExplorer } from "@/components/forecast/EvidenceExplorer";

export default function EvidencePage() {
  return (
    <main className="min-h-screen bg-[var(--color-bg-primary)]">
      <div className="mx-auto max-w-7xl px-3 py-3 md:px-[18px] md:py-[18px]">
        <EvidenceExplorer />
      </div>
    </main>
  );
}
