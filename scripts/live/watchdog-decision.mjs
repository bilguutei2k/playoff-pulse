// Pure watchdog decisions. This is a second GitHub Actions path, not an external monitor.
// V2 began sealing on 2026-11-02; earlier historical games were never owed v2 seals.
export function decideWatchdog({ now, runs, state, games, ledger, health }) {
  const time = Date.parse(now);
  if (!Number.isFinite(time)) throw new Error("Invalid watchdog clock");
  const real = runs.filter((run) => !(run.display_title ?? "").endsWith("(dry run)"))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const active = real.some((run) => run.status !== "completed");
  const recent = real.some((run) => Date.parse(run.created_at) >= time - 25 * 60_000);
  let streak = 0;
  for (const run of real.filter((run) => run.status === "completed")) {
    if (["cancelled", "skipped", "stale"].includes(run.conclusion)) continue;
    if (!["failure", "timed_out", "startup_failure"].includes(run.conclusion)) break;
    streak++;
  }
  const alerts = [];
  const age = time - Date.parse(state?.generatedAt);
  if (!Number.isFinite(age) || age > 150 * 60_000) alerts.push(`Published state is stale or invalid: ${state?.generatedAt ?? "missing"}`);
  const sealed = new Set((ledger ?? []).filter((row) =>
    row.type === "seal" && row.modelVersion === "live-2026.27-v2" &&
    ["final", "morning"].includes(row.sealKind)).map((row) => row.gameId));
  const missing = (games ?? []).filter((game) => game.etDate >= "2026-11-02" && game.status !== "canceled" &&
    Date.parse(game.tipUtc) < time - 10 * 60_000 && !sealed.has(game.id));
  if (missing.length) alerts.push(`No v2 morning or final seal more than 10 minutes after tip: ${missing.map((g) => g.id).join(", ")}`);
  if (streak >= 3) alerts.push(`Live job failed ${streak} times in a row (cancelled runs ignored).`);
  for (const key of ["reportProblem", "viewsProblem"]) {
    if (health?.[key]) alerts.push(`${key}: ${health[key]}`);
  }
  return { dispatch: !recent && !active, streak, alerts };
}
