import type { Metadata } from "next";
import {
  CalibrationChart,
  CalibrationPlaceholder,
  MissedSeals,
  ScoredSeals,
  Waffle,
} from "@/components/live/RecordParts";
import { Ticker } from "@/components/live/Ticker";
import { getLiveState, getSeasonLedger } from "@/lib/live-data/published";
import { POLICY_REVISIONS, currentPolicyRevision, modelPolicyLabel } from "@/lib/season/policy-revisions";
import type { RecordSummary } from "@/lib/season/types";
import { formatShortDay } from "@/lib/utils/dates";
import {
  CALIBRATION_MIN_GAMES,
  MARKET_COMPARISON_MIN_GAMES,
  SMALL_SAMPLE_GAMES,
  SMALL_SAMPLE_LABEL,
  calibrationBins,
  marketComparison,
  versionLedger,
  withMarketLine,
  withRecordSplit,
} from "@/lib/view/record";
import {
  favoriteSummary,
  firstScoredDate,
  hasInjuryTerm,
  sameScoredGames,
  versionShort,
} from "@/lib/view/record-page";

export const metadata: Metadata = {
  title: "Track record",
  description:
    "Every 548 forecast is sealed before tip and scored after the final, in public: Brier score, log loss, accuracy, misses and every game, per model version.",
};

const LEDGER_URL = "https://github.com/bilguutei2k/playoff-pulse/tree/live-data/data/live/ledger";

// Re-rendered about once a minute from main's published data (src/lib/live-data/published.ts).
export const revalidate = 60;
const LIST_LIMIT = 100;

const fixed = (value: number | null, digits: number) => (value === null ? null : value.toFixed(digits));
/** A Brier score with the number of games behind it; null before a state has the split. */
const withCount = (value: number | null | undefined, count: number | undefined) =>
  count === undefined ? null : `${value === null || value === undefined ? "–" : value.toFixed(3)} (n=${count})`;
const percent = (value: number | null) => (value === null ? null : `${Math.round(value * 100)}%`);

type Metric = { label: string; note: string; value: (record: RecordSummary) => string | null };

const METRICS: Metric[] = [
  { label: "Games sealed", note: "With at least one seal from this version", value: (r) => String(r.sealed) },
  { label: "Scored", note: "Sealed and final", value: (r) => String(r.scored) },
  { label: "Pending", note: "Sealed, waiting for a result", value: (r) => String(r.pending) },
  { label: "Missed", note: "Tipped before a seal; never backfilled", value: (r) => String(r.missed) },
  { label: "Incomplete inputs", note: "Sealed before an earlier result was in; still counted", value: (r) => String(r.incomplete) },
  { label: "No final seal", note: "Scored on the reissued seal, else the original morning seal", value: (r) => (r.noFinalSeal === null ? "Seals once" : String(r.noFinalSeal)) },
  { label: "Brier score", note: "Lower is better; an even 50% call scores 0.250", value: (r) => fixed(r.brier, 3) },
  { label: "Baseline Brier", note: "Always the prior home-win rate, same games", value: (r) => fixed(r.baselineBrier, 3) },
  { label: "Log loss", note: "Lower is better", value: (r) => fixed(r.logLoss, 3) },
  { label: "Accuracy", note: "The sealed favorite won", value: (r) => percent(r.accuracy) },
  {
    label: "Original morning seals' Brier",
    note: "Morning seals as first issued, on the scored games that have one",
    value: (r) => (r.noFinalSeal === null ? "Seals once" : withCount(r.originalMorningBrier, r.originalMorningCount)),
  },
  {
    label: "Reissued seals' Brier",
    note: "Only the scored games whose morning seal was reissued with a report",
    value: (r) => (r.noFinalSeal === null ? "Seals once" : withCount(r.reissuedBrier, r.reissuedCount)),
  },
  {
    label: "Latest pre-final seal's Brier",
    note: "The reissued seal when there is one, else the original morning seal",
    value: (r) => (r.noFinalSeal === null ? "Seals once" : withCount(r.latestPreFinalBrier, r.latestPreFinalCount)),
  },
  {
    label: "Reference Brier",
    note: "The other version's number stored on each seal, same games",
    value: (r) => (r.referenceModelVersion === null && r.noFinalSeal === null ? "Not stored" : fixed(r.referenceBrier, 3)),
  },
];

function Stat({ title, value, note, extra }: { title: string; value: string; note: string; extra?: string }) {
  return (
    <div>
      <h3 className="text-[16px] font-bold">{title}</h3>
      <p className="figure mt-1 text-[34px] [font-variant-numeric:normal]">{value}</p>
      <p className="mt-2 text-[13px] text-ink-2">{note}</p>
      {extra ? <p className="mt-0.5 text-[13px] text-ink-2">{extra}</p> : null}
    </div>
  );
}

function SmallSample({ scored }: { scored: number }) {
  const label = SMALL_SAMPLE_LABEL(scored);
  const split = label.indexOf(":") + 1;
  return (
    <p className="mt-[18px]">
      <b>{label.slice(0, split)}</b> <span className="text-ink-2">{label.slice(split).trim()}</span>
    </p>
  );
}

export default async function RecordPage() {
  // The season's rows from the job's month files (no driver lists; this page needs none).
  const [liveState, ledger] = await Promise.all([getLiveState(), getSeasonLedger()]);
  const versions = [
    liveState.modelVersion,
    ...(liveState.referenceModelVersion !== liveState.modelVersion ? [liveState.referenceModelVersion] : []),
  ];
  const records = versions.map((version) => ({
    version,
    short: versionShort(version),
    published: version === liveState.modelVersion,
    injuries: hasInjuryTerm(ledger, version),
    record: liveState.records[version] ? withRecordSplit(liveState.records[version], ledger) : null,
    ledger: versionLedger(ledger, version),
  }));
  const headline = records[0];
  const reference = records[1] ?? null;
  const record = headline.record;
  const scored = headline.ledger.scored;
  const scoredCount = record?.scored ?? scored.length;
  const lined = withMarketLine(scored);
  const market = marketComparison(scored);
  const bins = calibrationBins(scored);
  const favorites = favoriteSummary(scored);
  const since = firstScoredDate(scored);
  const started = liveState.ledgerStartedAt ? formatShortDay(liveState.ledgerStartedAt.slice(0, 10)) : null;
  const smallSample = records.some((entry) => (entry.record?.scored ?? 0) < SMALL_SAMPLE_GAMES);
  const same = reference ? sameScoredGames(headline.ledger, reference.ledger) : false;
  const revision = currentPolicyRevision(liveState.modelVersion, liveState.generatedAt);
  const revisions = headline.record?.policyRevisions ?? null;
  const utc = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
  const columnLabel = (entry: (typeof records)[number]) =>
    `${entry.short} ${entry.published ? "published" : entry.injuries ? "reference" : "no injuries"}`;

  return (
    <>
      <Ticker />
      <main className="pp-container pt-8 sm:pt-11">
        <h1 className="headline text-[32px] sm:text-[46px]">Track record</h1>
        <p className="mb-9 mt-3 text-[17px] sm:mb-11 sm:text-[19px]">
          Sealed before tip. Scored after the final. Never backfilled.
        </p>

        <div className="grid items-start gap-x-14 gap-y-8 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div>
            <span className="figure block text-[88px] sm:text-[110px]">{scoredCount}</span>
            <p className="mt-1 text-[18px]">of {SMALL_SAMPLE_GAMES} games scored</p>
            {smallSample ? <SmallSample scored={scoredCount} /> : null}
            {smallSample ? (
              <p className="mt-2 text-[13px] text-ink-2">
                The record began {started ?? "with the first seal"}; no version is claimed to beat another, or the
                baseline, before {SMALL_SAMPLE_GAMES} scored games.
              </p>
            ) : null}
          </div>
          <Waffle scored={scoredCount} pending={headline.ledger.pending.length} />
        </div>

        <div className="mt-14 grid gap-10 sm:mt-16 sm:grid-cols-3 sm:gap-12">
          <Stat
            title={`Brier score, ${headline.short}`}
            value={record?.brier === null || !record ? "–" : record.brier.toFixed(3)}
            note={
              record?.baselineBrier !== null && record
                ? `Lower is better. Baseline ${record.baselineBrier.toFixed(3)}`
                : "Lower is better. After the first final"
            }
          />
          <Stat
            title="Favorite won"
            value={favorites.decided === 0 ? "–" : `${favorites.won} of ${favorites.decided}`}
            note={favorites.decided === 0 ? "After the first final" : `548 expected ${favorites.expected.toFixed(1)}`}
          />
          <Stat
            title="Missed seals"
            value={String(record?.missed ?? headline.ledger.missed.length)}
            note={
              (record?.missed ?? headline.ledger.missed.length) === 0
                ? "Every game sealed before tip"
                : "Tipped before a seal; never backfilled"
            }
            extra={`${record && record.noFinalSeal !== null ? `No final seal ${record.noFinalSeal} · ` : ""}Incomplete inputs ${record?.incomplete ?? 0}`}
          />
        </div>

        <div className="grid items-start gap-x-[72px] lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-w-0 flex-col">
            <section aria-labelledby="scored-title" className="order-2 mt-16 lg:order-1 lg:mt-[72px]">
              <div className="sh">
                <h2 id="scored-title">Every scored seal</h2>
                <span>
                  {headline.short}
                  {since ? ` · since ${formatShortDay(since)}` : ""} · outline: favorite lost
                </span>
              </div>
              {scored.length === 0 ? (
                <p className="notice-quiet">No scored games yet. The first appear the morning after the first sealed games finish.</p>
              ) : (
                <>
                  <ScoredSeals
                    games={scored.slice(0, LIST_LIMIT)}
                    caption={`Every scored seal of ${headline.version}, most recent first: the sealed pick, the result and the Brier score. Lower is better.`}
                  />
                  <p className="mt-3 text-[13px] text-ink-2">
                    The scored seal is the final seal when one exists, else the reissued seal, else the original morning
                    seal.
                    {scored.length > LIST_LIMIT ? (
                      <>
                        {" "}
                        The latest {LIST_LIMIT} shown; every row is in the{" "}
                        <a className="pp-link" href={LEDGER_URL}>
                          ledger on GitHub
                        </a>
                        .
                      </>
                    ) : null}
                  </p>
                </>
              )}
              <h3 className="mt-6 text-[16px] font-bold">Missed seals</h3>
              <div className="mt-2">
                <MissedSeals missed={headline.ledger.missed} version={headline.version} />
              </div>
            </section>

            <section aria-labelledby="models-title" className="order-1 mt-16 lg:order-2 lg:mt-[72px]">
              <div className="sh">
                <h2 id="models-title">Both models</h2>
                {reference ? (
                  <span>
                    {same
                      ? `The same ${scored.length} games, each version on its own seals`
                      : "Different games, not a head-to-head"}
                  </span>
                ) : null}
              </div>
              <div className="table-scroll">
                <table className="tb">
                  <caption className="sr-only">Each version&apos;s record: counts, Brier score, log loss and accuracy.</caption>
                  <thead>
                    <tr>
                      <th scope="col">Measure</th>
                      {records.map((entry) => (
                        <th key={entry.version} scope="col" className="nm" title={entry.version}>
                          {columnLabel(entry)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {METRICS.map((metric) => (
                      <tr key={metric.label}>
                        <th scope="row" className="whitespace-normal text-left">
                          <span className="block">{metric.label}</span>
                          <span className="block text-[12.5px] text-ink-2">{metric.note}</span>
                        </th>
                        {records.map((entry) => {
                          const value = entry.record ? metric.value(entry.record) : null;
                          return (
                            <td key={entry.version} className={`nm num align-top ${entry.published ? "font-bold" : ""}`}>
                              {value ?? <span className="text-[12.5px] font-normal text-ink-2">None yet</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[13px] text-ink-2">
                {records.map((entry, index) => (
                  <span key={entry.version}>
                    {index > 0 ? " " : ""}
                    <span className="num text-ink">{entry.short}</span> is{" "}
                    {entry.published ? modelPolicyLabel(entry.version, revision) : entry.version}
                    {entry.published ? ", the published model" : ", the reference beside it"}
                    {entry.injuries ? "." : ", without the injury term."}
                  </span>
                ))}{" "}
                Each version keeps its own record
                {revisions ? `; ${headline.short}'s spans policy revisions 0 to ${POLICY_REVISIONS.at(-1)!.revision}, listed below` : ""}.
              </p>
              {reference ? (
                <details className="group mt-8">
                  <summary className="cursor-pointer list-none text-[15px] font-bold">
                    <span aria-hidden className="mr-2 inline-block transition-transform group-open:rotate-90">›</span>
                    {reference.short}&apos;s {reference.ledger.scored.length} scored seals and its missed seals
                  </summary>
                  <div className="mt-4">
                    {reference.ledger.scored.length === 0 ? (
                      <p className="notice-quiet">No scored games yet.</p>
                    ) : (
                      <ScoredSeals
                        games={reference.ledger.scored.slice(0, LIST_LIMIT)}
                        caption={`Every scored seal of ${reference.version}, most recent first.`}
                      />
                    )}
                    {reference.ledger.scored.length > LIST_LIMIT ? (
                      <p className="mt-2 text-[13px] text-ink-2">
                        The latest {LIST_LIMIT} shown. Every row is in the{" "}
                        <a className="pp-link" href={LEDGER_URL}>
                          ledger on GitHub
                        </a>
                        .
                      </p>
                    ) : null}
                    <h3 className="mt-6 text-[16px] font-bold">Missed seals</h3>
                    <div className="mt-2">
                      <MissedSeals missed={reference.ledger.missed} version={reference.version} />
                    </div>
                  </div>
                </details>
              ) : null}
            </section>

            {revisions ? (
              <section aria-labelledby="revisions-title" className="order-3 mt-16 lg:mt-[72px]">
                <div className="sh">
                  <h2 id="revisions-title">Policy revisions</h2>
                  <span>One {headline.short} record · descriptive, not a comparison</span>
                </div>
                <div className="table-scroll">
                  <table className="tb">
                    <caption className="sr-only">
                      {headline.version}&apos;s record by policy revision: when each took effect, its seal rows, the games
                      filed under it, how many are scored and their Brier score.
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Revision</th>
                        <th scope="col">In force from</th>
                        <th scope="col" className="nm">Seals</th>
                        <th scope="col" className="nm">Games</th>
                        <th scope="col" className="nm">Scored</th>
                        <th scope="col" className="nm">Brier</th>
                      </tr>
                    </thead>
                    <tbody>
                      {revisions.map((row) => {
                        const policy = POLICY_REVISIONS.find((entry) => entry.revision === row.revision);
                        return (
                          <tr key={row.revision}>
                            <th scope="row" className="whitespace-normal text-left align-top">
                              <span className="block">Revision {row.revision}</span>
                              <span className="block text-[12.5px] text-ink-2">{policy?.description}</span>
                            </th>
                            <td className="num align-top text-[13px]">{policy ? utc(policy.effectiveAt) : "–"}</td>
                            <td className="nm num align-top">{row.sealRows}</td>
                            <td className="nm num align-top">{row.sealed}</td>
                            <td className="nm num align-top">{row.scored}</td>
                            <td className="nm num align-top">{fixed(row.brier, 3) ?? "–"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-[13px] text-ink-2">
                  {headline.short} keeps one version and one record; changes made after its registered test are labeled as
                  revisions, each in force from its pull request&apos;s merge. Seals counts every morning, reissued and final
                  seal issued under a revision. Each game is filed once, under the seal it is scored on (final, else
                  reissued, else original morning), so a game sealed in the morning under one revision and finally under
                  the next counts under the next. The revisions cover different games and dates and are not a comparison
                  of policies. The registered injury test covers revision 0&apos;s final-point endpoint only.{" "}
                  <a className="pp-link" href="/how-it-works#policy-revisions">
                    What each revision changed
                  </a>
                  .
                </p>
              </section>
            ) : null}
          </div>

          <aside aria-label="Calibration, the market and the ledger" className="mt-16 grid gap-12 lg:mt-[72px]">
            <section aria-labelledby="calibration-title">
              <h2 id="calibration-title" className="text-[21px] font-extrabold">Calibration</h2>
              {scored.length >= CALIBRATION_MIN_GAMES ? (
                <>
                  <p className="mt-1.5 text-ink-2">Do the percentages hold?</p>
                  <CalibrationChart bins={bins} />
                  <p className="mt-2 text-[13px] text-ink-2">
                    Each square is a tenth of the forecast range: where it sits against the dashed diagonal shows how often
                    home teams given that chance won. Larger squares hold more games.
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-1.5 text-ink-2">Chart opens at {CALIBRATION_MIN_GAMES} games</p>
                  <CalibrationPlaceholder />
                  <p className="mt-2 text-[13px] text-ink-2">
                    {scored.length} scored so far. In testing, game forecasts were mildly overconfident (calibration slope
                    0.875 for v2 on its test seasons).
                  </p>
                </>
              )}
            </section>
            <section aria-labelledby="market-title">
              <h2 id="market-title" className="text-[21px] font-extrabold">548 vs. the market</h2>
              {market ? (
                <>
                  <dl className="mt-3 grid grid-cols-2 gap-4">
                    <div>
                      <dt className="text-[13px] text-ink-2">548 Brier</dt>
                      <dd className="figure mt-1 text-[28px] [font-variant-numeric:normal]">{market.model.toFixed(3)}</dd>
                    </div>
                    <div>
                      <dt className="text-[13px] text-ink-2">Market Brier</dt>
                      <dd className="figure mt-1 text-[28px] text-ink-2 [font-variant-numeric:normal]">{market.market.toFixed(3)}</dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-[13px] text-ink-2">
                    On the {market.games} scored games with a stored line. The market is a reference, never a model input.
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-1.5 text-ink-2">Opens at {MARKET_COMPARISON_MIN_GAMES} games</p>
                  <p className="mt-2 text-[13px] text-ink-2">
                    Before then the claims ledger allows no statement about the model against the market. So far{" "}
                    {scored.length} scored {scored.length === 1 ? "game" : "games"}, {lined.length} with a stored line. The
                    market&apos;s number stays on every game page as a reference.
                  </p>
                </>
              )}
            </section>
            <section aria-labelledby="ledger-title">
              <h2 id="ledger-title" className="text-[21px] font-extrabold">The ledger</h2>
              <p className="mt-1.5 text-ink-2">Public and append-only</p>
              <p className="mt-2">
                <a href={LEDGER_URL} className="font-semibold hover:underline hover:underline-offset-4">
                  Open on GitHub
                </a>
              </p>
              <p className="mt-2 text-[13px] text-ink-2">
                Every seal is written before tip and never edited. Morning, reissued and final seals are separate rows,
                each with its true time and, since Nov 6, its policy revision. The times are the job&apos;s own clock and
                the git history; there is no independent receipt that a seal existed before tip.
              </p>
            </section>
          </aside>
        </div>
      </main>
    </>
  );
}
