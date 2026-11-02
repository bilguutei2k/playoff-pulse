import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/live/Badge";
import { SectionHeading } from "@/components/live/SectionHeading";
import { TeamLogo } from "@/components/live/TeamLogo";
import { liveState } from "@/lib/season/published";
import type { RecordSummary } from "@/lib/season/types";
import { formatShortDay } from "@/lib/utils/dates";
import { splitPercents } from "@/lib/view/card";
import {
  CALIBRATION_MIN_GAMES,
  MARKET_COMPARISON_MIN_GAMES,
  SMALL_SAMPLE_GAMES,
  SMALL_SAMPLE_LABEL,
  calibrationBins,
  marketComparison,
  versionLedger,
  withMarketLine,
  type CalibrationBin,
  type ScoredGame,
  type VersionLedger,
} from "@/lib/view/record";
import { ledgerRows } from "@/lib/view/store";
import { teamDisplay } from "@/lib/view/teams";

export const metadata: Metadata = {
  title: "Track record",
  description:
    "Every 548 forecast is sealed before tip and scored after the final, in public: Brier score, log loss, accuracy, misses and every game, per model version.",
};

const LEDGER_URL = "https://github.com/bilguutei2k/playoff-pulse/tree/main/data/live/ledger";
const LIST_LIMIT = 100;

const fixed = (value: number | null, digits: number) => (value === null ? null : value.toFixed(digits));
const percent = (value: number | null) => (value === null ? null : `${Math.round(value * 100)}%`);

type Metric = { label: string; note: string; value: (record: RecordSummary) => string | null };

const METRICS: Metric[] = [
  { label: "Games sealed", note: "With at least one seal from this version", value: (r) => String(r.sealed) },
  { label: "Scored", note: "Sealed and final", value: (r) => String(r.scored) },
  { label: "Pending", note: "Sealed, waiting for a result", value: (r) => String(r.pending) },
  { label: "Missed", note: "Tipped before a seal; never backfilled", value: (r) => String(r.missed) },
  { label: "Incomplete inputs", note: "Sealed before an earlier result was in; still counted", value: (r) => String(r.incomplete) },
  { label: "No final seal", note: "Scored on the morning seal", value: (r) => (r.noFinalSeal === null ? "Seals once" : String(r.noFinalSeal)) },
  { label: "Brier score", note: "Lower is better; an even 50% call scores 0.250", value: (r) => fixed(r.brier, 3) },
  { label: "Baseline Brier", note: "Always the prior home-win rate, same games", value: (r) => fixed(r.baselineBrier, 3) },
  { label: "Log loss", note: "Lower is better", value: (r) => fixed(r.logLoss, 3) },
  { label: "Accuracy", note: "The sealed favorite won", value: (r) => percent(r.accuracy) },
  { label: "Morning seals' Brier", note: "The morning seal alone, same games", value: (r) => (r.noFinalSeal === null ? "Seals once" : fixed(r.morningBrier, 3)) },
  {
    label: "Reference Brier",
    note: "The other version's number stored on each seal, same games",
    value: (r) => (r.referenceModelVersion === null && r.noFinalSeal === null ? "Not stored" : fixed(r.referenceBrier, 3)),
  },
];

function Matchup({ awayId, homeId }: { awayId: string; homeId: string }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <TeamLogo teamId={awayId} size={18} />
      <span className="num text-ink">{teamDisplay(awayId).code}</span>
      <span className="text-[12px] text-ink-3">at</span>
      <TeamLogo teamId={homeId} size={18} />
      <span className="num text-ink">{teamDisplay(homeId).code}</span>
    </span>
  );
}

function GameRows({ games }: { games: ScoredGame[] }) {
  return (
    <div className="table-scroll rounded-[var(--radius-card)] border border-line bg-panel">
      <table className="w-full min-w-[40rem] text-[14px]">
        <thead>
          <tr className="border-b border-line-strong text-left">
            <th scope="col" className="kicker py-2 pl-4 pr-3 font-medium">Date</th>
            <th scope="col" className="kicker py-2 pr-3 font-medium">Game</th>
            <th scope="col" className="kicker py-2 pr-3 font-medium">548 favored</th>
            <th scope="col" className="kicker py-2 pr-3 font-medium">Result</th>
            <th scope="col" className="kicker py-2 pr-3 text-right font-medium">Brier</th>
            <th scope="col" className="kicker py-2 pr-4 font-medium">Seal</th>
          </tr>
        </thead>
        <tbody>
          {games.map((game) => {
            const { home, away } = splitPercents(game.seal.homeWinProbability);
            const favoriteHome = home >= away;
            const favorite = teamDisplay(favoriteHome ? game.seal.homeId : game.seal.awayId).code;
            const winner = teamDisplay(game.homeWon ? game.seal.homeId : game.seal.awayId).code;
            const high = Math.max(game.result.homeScore, game.result.awayScore);
            const low = Math.min(game.result.homeScore, game.result.awayScore);
            const favoriteWon = favoriteHome === game.homeWon;
            return (
              <tr key={game.seal.gameId} className="border-b border-line last:border-0 hover:bg-wash">
                <td className="num whitespace-nowrap py-2.5 pl-4 pr-3 text-[12.5px] text-ink-2">{formatShortDay(game.seal.etDate)}</td>
                <th scope="row" className="py-2.5 pr-3 text-left font-normal">
                  <Link href={`/game/${game.seal.gameId}`} className="hover:underline hover:decoration-pulse hover:underline-offset-4">
                    <Matchup awayId={game.seal.awayId} homeId={game.seal.homeId} />
                  </Link>
                </th>
                <td className="num whitespace-nowrap py-2.5 pr-3 text-ink">
                  {home === away ? "Even" : `${favorite} ${Math.max(home, away)}%`}
                </td>
                <td className="num whitespace-nowrap py-2.5 pr-3">
                  <span className={favoriteWon || home === away ? "text-ink" : "text-ink-2"}>
                    {winner} {high}–{low}
                  </span>
                </td>
                <td className="num py-2.5 pr-3 text-right text-ink">{game.brier.toFixed(3)}</td>
                <td className="py-2.5 pr-4">
                  <span className="flex flex-wrap gap-1">
                    {game.noFinalSeal ? <Badge tone="warn">No final seal</Badge> : game.seal.sealKind === "final" ? <Badge tone="good">Final</Badge> : <Badge tone="quiet">Morning</Badge>}
                    {game.seal.inputsIncomplete ? <Badge tone="warn">Incomplete</Badge> : null}
                    {game.seal.availabilityMissing ? <Badge tone="warn">No report</Badge> : game.seal.availabilityStale ? <Badge tone="warn">Stale report</Badge> : null}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function VersionGames({ version, ledger, role }: { version: string; ledger: VersionLedger; role: string }) {
  return (
    <section aria-labelledby={`games-${version}`} className="mt-8">
      <h3 id={`games-${version}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[17px] font-semibold text-ink">{role}</span>
        <span className="num text-[13px] text-ink-3">{version}</span>
      </h3>
      <p className="mt-1 text-[13px] text-ink-2">
        {ledger.scored.length} scored · {ledger.pending.length} pending · {ledger.missed.length} missed
      </p>
      <div className="mt-3">
        {ledger.scored.length === 0 ? (
          <p className="notice-quiet">No scored games yet. The first appear the morning after the first sealed games finish.</p>
        ) : (
          <>
            <GameRows games={ledger.scored.slice(0, LIST_LIMIT)} />
            {ledger.scored.length > LIST_LIMIT ? (
              <p className="mt-2 text-[13px] text-ink-3">
                The latest {LIST_LIMIT} shown. Every row is in the <a className="pp-link" href={LEDGER_URL}>ledger on GitHub</a>.
              </p>
            ) : null}
          </>
        )}
      </div>
      <div className="mt-4">
        <h4 className="kicker">Missed seals</h4>
        {ledger.missed.length === 0 ? (
          <p className="mt-2 text-[13px] text-ink-2">None. Every game this version should have sealed was sealed before tip.</p>
        ) : (
          <ul className="mt-2 grid gap-1.5 text-[13px] text-ink-2 sm:grid-cols-2">
            {ledger.missed.map((row) => (
              <li key={row.gameId} className="flex items-center gap-2">
                <Badge tone="bad">Missed</Badge>
                <span className="num">{formatShortDay(row.etDate)}</span>
                <Matchup awayId={row.awayId} homeId={row.homeId} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function CalibrationChart({ bins }: { bins: CalibrationBin[] }) {
  const size = 320;
  const pad = 36;
  const scale = (value: number) => pad + value * (size - 2 * pad);
  const flip = (value: number) => size - scale(value);
  const maxCount = Math.max(...bins.map((bin) => bin.count));
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-auto w-full max-w-sm" role="img" aria-label={`Calibration: ${bins.map((bin) => `forecasts near ${Math.round(bin.forecast * 100)}% came true ${Math.round(bin.observed * 100)}% of the time (${bin.count} games)`).join("; ")}.`}>
      {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
        <g key={tick}>
          <line x1={scale(0)} x2={scale(1)} y1={flip(tick)} y2={flip(tick)} stroke="#ece9e4" />
          <text x={pad - 6} y={flip(tick)} dy="0.32em" textAnchor="end" fontSize={10} fill="#6b6863" className="font-mono">{tick * 100}%</text>
          <text x={scale(tick)} y={size - pad + 16} textAnchor="middle" fontSize={10} fill="#6b6863" className="font-mono">{tick * 100}%</text>
        </g>
      ))}
      <line x1={scale(0)} y1={flip(0)} x2={scale(1)} y2={flip(1)} stroke="#b9b5ae" />
      {bins.map((bin) => (
        <circle key={bin.from} cx={scale(bin.forecast)} cy={flip(bin.observed)} r={4 + 6 * Math.sqrt(bin.count / maxCount)} fill="#0b6e55" fillOpacity={0.85} stroke="#ffffff" strokeWidth={2}>
          <title>{`${Math.round(bin.from * 100)}–${Math.round(bin.to * 100)}%: forecast ${Math.round(bin.forecast * 100)}%, home team won ${Math.round(bin.observed * 100)}% (${bin.count} games)`}</title>
        </circle>
      ))}
    </svg>
  );
}

export default function RecordPage() {
  const ledger = ledgerRows();
  const versions = [liveState.modelVersion, ...(liveState.referenceModelVersion !== liveState.modelVersion ? [liveState.referenceModelVersion] : [])];
  const records = versions.map((version) => ({
    version,
    role: version === liveState.modelVersion ? "Published model" : "Reference model",
    record: liveState.records[version] ?? null,
    ledger: versionLedger(ledger, version),
  }));
  const headline = records[0];
  const scored = headline.ledger.scored;
  const lined = withMarketLine(scored);
  const market = marketComparison(scored);
  const bins = calibrationBins(scored);

  return (
    <main className="pp-container py-8 sm:py-10">
      <SectionHeading
        as="h1"
        kicker="Track record"
        title="Every forecast, sealed and scored"
        dek={
          <>
            Each game&apos;s forecast is sealed before tip and written to an append-only{" "}
            <a href={LEDGER_URL} className="pp-link">public ledger</a>, then scored after the final. Nothing is
            backfilled: a game that tips without a seal is a miss and stays counted. Each model version keeps its own
            record.
          </>
        }
      />

      {records.some((entry) => (entry.record?.scored ?? 0) < SMALL_SAMPLE_GAMES) ? (
        <p className="notice mt-6">
          <span className="font-semibold">{SMALL_SAMPLE_LABEL(headline.record?.scored ?? 0)}</span> The record began{" "}
          {liveState.ledgerStartedAt ? formatShortDay(liveState.ledgerStartedAt.slice(0, 10)) : "with the first seal"}; no version is
          claimed to beat another, or the baseline, before {SMALL_SAMPLE_GAMES} scored games.
        </p>
      ) : null}

      <section aria-labelledby="numbers-title" className="mt-10">
        <SectionHeading id="numbers-title" kicker="Per version" title="The numbers" />
        <div className="table-scroll mt-4 rounded-[var(--radius-card)] border border-line bg-panel">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-line-strong text-left">
                <th scope="col" className="kicker py-2.5 pl-4 pr-3 font-medium">Measure</th>
                {records.map((entry) => (
                  <th key={entry.version} scope="col" className="py-2.5 pr-4 text-right align-bottom">
                    <span className="kicker block font-medium">{entry.role.replace(" model", "")}</span>
                    <span className="num block text-[12px] font-normal text-ink-2">
                      <span className="sm:hidden">{entry.version.split("-").at(-1)}</span>
                      <span className="hidden sm:inline">{entry.version}</span>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {METRICS.map((metric) => (
                <tr key={metric.label} className="border-b border-line last:border-0">
                  <th scope="row" className="py-2.5 pl-4 pr-2 text-left font-normal">
                    <span className="block font-medium text-ink">{metric.label}</span>
                    <span className="block text-[12px] text-ink-3">{metric.note}</span>
                  </th>
                  {records.map((entry) => {
                    const value = entry.record ? metric.value(entry.record) : null;
                    return (
                      <td key={entry.version} className="num py-2.5 pr-4 text-right align-top text-[15px] text-ink">
                        {value ?? <span className="text-[12.5px] text-ink-3">None yet</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="market-title" className="panel p-5 sm:p-6">
          <SectionHeading id="market-title" kicker="Reference" title="548 and the market" />
          {market ? (
            <div className="mt-4">
              <dl className="grid grid-cols-2 gap-4">
                <div>
                  <dt className="kicker">548 Brier</dt>
                  <dd className="figure mt-1 text-[28px] font-semibold text-ink">{market.model.toFixed(3)}</dd>
                </div>
                <div>
                  <dt className="kicker">Market Brier</dt>
                  <dd className="figure mt-1 text-[28px] font-semibold text-market">{market.market.toFixed(3)}</dd>
                </div>
              </dl>
              <p className="mt-3 text-[13px] text-ink-2">On the {market.games} scored games with a stored line. The market is a reference, never a model input.</p>
            </div>
          ) : (
            <p className="mt-4 text-[14px] leading-6 text-ink-2">
              Not shown until {MARKET_COMPARISON_MIN_GAMES} scored games: before then the claims ledger allows no statement
              about the model against the market. So far {scored.length} scored {scored.length === 1 ? "game" : "games"},{" "}
              {lined.length} with a stored line. The market&apos;s number stays on every game page as a reference.
            </p>
          )}
        </section>
        <section aria-labelledby="calibration-title" className="panel p-5 sm:p-6">
          <SectionHeading id="calibration-title" kicker="Do the percentages hold?" title="Calibration" />
          {scored.length >= CALIBRATION_MIN_GAMES ? (
            <div className="mt-4">
              <CalibrationChart bins={bins} />
              <p className="mt-2 text-[13px] text-ink-2">
                Each dot is a tenth of the forecast range: where it sits against the diagonal shows how often home teams
                given that chance won. Larger dots hold more games.
              </p>
            </div>
          ) : (
            <p className="mt-4 text-[14px] leading-6 text-ink-2">
              The calibration chart appears at {CALIBRATION_MIN_GAMES} scored games; there {scored.length === 1 ? "is" : "are"}{" "}
              {scored.length} so far. In testing, game forecasts were mildly overconfident (calibration slope 0.875 for
              v2 on its test seasons).
            </p>
          )}
        </section>
      </div>

      <section aria-labelledby="games-title" className="mt-12">
        <SectionHeading
          id="games-title"
          kicker="Game by game"
          title="Every scored seal"
          dek="Most recent first. The scored seal is the final seal when one exists, else the morning seal. Missed seals are listed under each version."
        />
        {records.map((entry) => (
          <VersionGames key={entry.version} version={entry.version} ledger={entry.ledger} role={entry.role} />
        ))}
      </section>
    </main>
  );
}
