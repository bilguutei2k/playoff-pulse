import {
  AlertTriangle,
  Database,
  FileWarning,
  LineChart,
  RadioTower,
  ShieldCheck,
} from "lucide-react";

type SimulationSummaryProps = {
  validationErrors: string[];
  validationWarnings: string[];
  dataLastUpdatedTimestamp: string;
};

export function SimulationSummary({
  validationErrors,
  validationWarnings,
  dataLastUpdatedTimestamp,
}: SimulationSummaryProps) {
  const validationLabel = validationErrors.length
    ? "Errors"
    : validationWarnings.length
      ? "Warnings"
      : "Passed";
  const statusItems = [
    {
      icon: Database,
      label: "Manual data snapshot",
      value: "Manual",
      subtext: "Finals rosters rechecked; ratings and impacts remain manual.",
    },
    {
      icon: FileWarning,
      label: "Last updated timestamp",
      value: dataLastUpdatedTimestamp,
      subtext: "Timestamp for the current static configuration file.",
    },
    {
      icon: RadioTower,
      label: "Live APIs",
      value: "Scoreboard probe",
      subtext: "Read-only game status feed. Forecast inputs remain manual.",
    },
    {
      icon: LineChart,
      label: "Probabilities",
      value: "Baseline estimates",
      subtext: "Published values exclude the unvalidated scenario overlay.",
    },
    {
      icon: ShieldCheck,
      label: "Validation status",
      value: validationLabel,
      subtext: "Local configuration and probability checks run through the verify script.",
    },
  ];

  return (
    <>
      <div className="grid gap-0 divide-y divide-[var(--color-border-subtle)] md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-5">
        {statusItems.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="p-4">
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-[var(--color-accent)]" aria-hidden />
                <span className="pp-kicker">{item.label}</span>
              </div>
              <div className="pp-number mt-3 text-2xl font-bold text-[var(--color-text-primary)]">
                {item.value}
              </div>
              <p className="mt-2 text-xs leading-5 text-[var(--color-text-muted)]">
                {item.subtext}
              </p>
            </div>
          );
        })}
      </div>

      {validationErrors.length || validationWarnings.length ? (
        <div className="border-t-2 border-[var(--color-border-strong)] bg-[var(--overlay-danger-soft)] p-4 text-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[var(--color-danger)]" aria-hidden />
            <span className="pp-kicker text-[var(--color-danger)]">Configuration review</span>
          </div>
          <ul className="mt-3 space-y-1 text-xs leading-5 text-[var(--color-danger)]">
            {[...validationErrors, ...validationWarnings].map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
