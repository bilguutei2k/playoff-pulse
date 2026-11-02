"use client";

import { useId, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  History,
  Info,
  ShieldCheck,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { TeamLogo } from "@/components/live/TeamLogo";
import { TeamProbabilityBar } from "@/components/live/TeamProbabilityBar";
import { useIsClient } from "@/components/live/useIsClient";
import { teamById } from "@/lib/season/teams";
import type { SlateGameView } from "@/lib/season/slate";
import type { AbsenceDriver, InjuryRow, PlayoffRound } from "@/lib/season/types";
import { formatClock, formatDateTime, formatReportTime } from "@/lib/utils/dates";
import { formatChance } from "@/lib/utils/format";
import { driversText, formatPoints } from "@/lib/utils/injuries";

const ROUND_LABELS: Record<PlayoffRound, string> = {
  "first-round": "First round",
  "conference-semifinal": "Conference semifinals",
  "conference-final": "Conference finals",
  finals: "NBA Finals",
};

type Tone = "success" | "warning" | "danger" | "neutral";

const TONE_CLASSES: Record<Tone, string> = {
  success:
    "border-[#abefc6] bg-[var(--color-success-bg)] text-[var(--color-success)]",
  warning:
    "border-[#fedf89] bg-[var(--color-warning-bg)] text-[var(--color-warning)]",
  danger: "border-[#fecdca] bg-[var(--color-danger-bg)] text-[var(--color-danger)]",
  neutral:
    "border-[var(--color-border-subtle)] bg-[var(--color-panel-secondary)] text-[var(--color-text-secondary)]",
};

type ForecastStatus = { tone: Tone; Icon: LucideIcon; label: string; detail: string };

function forecastStatus(
  game: SlateGameView,
  viewerZone: boolean,
  modelVersion: string,
): ForecastStatus | null {
  if (game.missed) {
    return {
      tone: "danger",
      Icon: AlertTriangle,
      label: "Missed",
      detail: `This game tipped before a forecast was sealed. It is counted as missed in the track record and is never backfilled.${
        game.forecast?.source === "provisional" ? " The number shown is provisional and is not scored." : ""
      }`,
    };
  }
  if (game.beforeRecord) {
    return {
      tone: "neutral",
      Icon: History,
      label: "Before the record",
      detail:
        "This game tipped before the first forecast was sealed, so it was never part of the track record.",
    };
  }
  const forecast = game.forecast;
  if (!forecast) return null;
  if (forecast.source === "provisional") {
    return {
      tone: "warning",
      Icon: Clock,
      label: "Provisional",
      detail:
        "Not sealed yet, because the scheduled update is running late. This number comes from the latest ratings and the absences published with them, is replaced once the game is sealed, and is never scored.",
    };
  }
  const time = forecast.issuedAt ? formatClock(forecast.issuedAt, viewerZone) : "";
  const stamp = forecast.issuedAt ? ` ${formatDateTime(forecast.issuedAt, viewerZone)}` : "";
  const missingResult = forecast.inputsIncomplete
    ? " It was sealed before an earlier game had finished, so that result is not in its ratings; it still counts."
    : "";
  if (forecast.modelVersion !== modelVersion) {
    return {
      tone: forecast.inputsIncomplete ? "warning" : "success",
      Icon: forecast.inputsIncomplete ? AlertTriangle : ShieldCheck,
      label: `Sealed ${time}`.trim(),
      detail: `Sealed${stamp} by the previous model, ${forecast.modelVersion}, which does not account for injuries. It counts in that model's record.${missingResult}`,
    };
  }
  if (game.noFinalSeal) {
    return {
      tone: "warning",
      Icon: AlertTriangle,
      label: "No final seal",
      detail: `No final seal was made in the hour before tip, so the morning seal from${stamp} is the one scored, and the game is counted as "no final seal" in the track record.${missingResult}`,
    };
  }
  const tone: Tone = forecast.inputsIncomplete ? "warning" : "success";
  const Icon = forecast.inputsIncomplete ? AlertTriangle : ShieldCheck;
  if (forecast.sealKind === "final") {
    return {
      tone,
      Icon,
      label: `Final seal ${time}`,
      detail: `Sealed${stamp}, in the hour before tip, with the latest NBA injury report. This is the number scored in the track record.${missingResult}`,
    };
  }
  return {
    tone,
    Icon,
    label: `Morning seal ${time}`,
    detail: `Sealed${stamp} with the NBA injury report available then. A final seal replaces it in the hour before tip; if none is made, this one is scored and the game counts as "no final seal".${missingResult}`,
  };
}

/** ESPN's "9:56 - 3rd" reads better as "3rd · 9:56". */
function liveStatusText(detail: string): string {
  const match = /^([\d:.]+)\s*-\s*(.+)$/.exec(detail.trim());
  return match ? `${match[2]} · ${match[1]}` : detail;
}

function gameLabel(game: SlateGameView): string | null {
  if (game.kind === "play-in") return "Play-in";
  if (game.kind === "cup-final") return "NBA Cup final, not in the standings";
  if (game.round) return ROUND_LABELS[game.round];
  return null;
}

function StatusLine({ game, viewerZone }: { game: SlateGameView; viewerZone: boolean }) {
  const label = gameLabel(game);
  let status: React.ReactNode;
  if (game.status === "in-progress") {
    status = (
      <>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-live-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--color-live)]">
          <span aria-hidden className="pp-live-dot h-1.5 w-1.5 rounded-full bg-[var(--color-live)]" />
          Live
        </span>
        <span className="tabular font-semibold text-[var(--color-text-primary)]">
          {liveStatusText(game.statusDetail)}
        </span>
      </>
    );
  } else if (game.status === "final") {
    status = (
      <span className="font-semibold text-[var(--color-text-primary)]">
        {/^final/i.test(game.statusDetail) ? game.statusDetail : "Final"}
      </span>
    );
  } else if (game.status === "postponed" || game.status === "canceled") {
    status = (
      <span className="inline-flex items-center gap-1 font-semibold text-[var(--color-warning)]">
        <AlertTriangle size={14} aria-hidden />
        {game.status === "postponed" ? "Postponed" : "Canceled"}
      </span>
    );
  } else {
    status = (
      <time dateTime={game.tipUtc} className="tabular font-semibold text-[var(--color-text-primary)]">
        {formatClock(game.tipUtc, viewerZone)}
      </time>
    );
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {status}
      {label ? <span className="text-[var(--color-text-muted)]">· {label}</span> : null}
    </div>
  );
}

function StatusBadge({ status }: { status: ForecastStatus }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const { tone, Icon, label, detail } = status;
  return (
    <div className="flex flex-col items-end">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={id}
        title={detail}
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}
      >
        <Icon size={13} aria-hidden />
        {label}
        <Info size={12} aria-hidden className="opacity-70" />
        <span className="sr-only">, explain</span>
      </button>
      <p
        id={id}
        hidden={!open}
        className="mt-2 max-w-xs text-right text-xs leading-5 text-[var(--color-text-muted)]"
      >
        {detail}
      </p>
    </div>
  );
}

function Percent({
  value,
  emphasis,
  title,
}: {
  value: number | null;
  emphasis: "strong" | "normal" | "muted";
  title?: string;
}) {
  const tone =
    emphasis === "strong"
      ? "font-semibold text-[var(--color-text-primary)]"
      : emphasis === "normal"
        ? "text-[var(--color-text-secondary)]"
        : "text-[var(--color-text-muted)]";
  return (
    <td className={`tabular py-1.5 pl-3 text-right text-sm ${tone}`} title={title}>
      {value === null ? <span aria-label="Not available">–</span> : formatChance(value)}
    </td>
  );
}

function injuryTone(status: string): string {
  const value = status.toLowerCase();
  if (value === "out") return "text-[var(--color-danger)]";
  if (value.includes("day") || value.includes("question") || value.includes("doubt")) {
    return "text-[var(--color-warning)]";
  }
  return "text-[var(--color-text-muted)]";
}

function InjuryColumn({ teamId, rows }: { teamId: string; rows: InjuryRow[] }) {
  const team = teamById(teamId);
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-secondary)]">
        <TeamLogo teamId={teamId} size={14} />
        {team.shortName}
      </p>
      {rows.length === 0 ? (
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">None reported</p>
      ) : (
        <ul className="mt-1 grid gap-0.5">
          {rows.map((row) => (
            <li
              key={`${row.athleteId}-${row.name}`}
              className="flex items-baseline justify-between gap-2 text-xs leading-5"
            >
              <span className="min-w-0 truncate text-[var(--color-text-primary)]">{row.name}</span>
              <span className={`shrink-0 font-medium ${injuryTone(row.status)}`}>{row.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** ESPN's list, shown only when the number on the card used no NBA report. */
function EspnFallback({ game, available }: { game: SlateGameView; available: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const total = game.injuries.away.length + game.injuries.home.length;
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-[var(--color-text-muted)]">
          <span className="font-medium text-[var(--color-text-secondary)]">ESPN injury list</span>
          <span> · for context, not in this number</span>
        </p>
        {available && total > 0 ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls={id}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-[var(--color-accent)] md:hidden"
          >
            {open ? "Hide" : `Show ${total}`}
            <ChevronDown
              size={14}
              aria-hidden
              className={`transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
        ) : null}
      </div>
      {!available ? (
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          The ESPN list could not be loaded just now.
        </p>
      ) : total === 0 ? (
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">None reported for either team.</p>
      ) : (
        <div
          id={id}
          className={`${open ? "grid" : "hidden"} mt-2 grid-cols-2 gap-x-6 gap-y-2 md:grid`}
        >
          <InjuryColumn teamId={game.awayId} rows={game.injuries.away} />
          <InjuryColumn teamId={game.homeId} rows={game.injuries.home} />
        </div>
      )}
    </div>
  );
}

function SideAbsence({
  teamId,
  points,
  drivers,
}: {
  teamId: string;
  points: number;
  drivers: AbsenceDriver[];
}) {
  const team = teamById(teamId);
  return (
    <li className="flex items-start gap-2 text-xs leading-5">
      <span className="mt-[3px] flex shrink-0">
        <TeamLogo teamId={teamId} size={14} />
      </span>
      <span className="min-w-0 text-[var(--color-text-muted)]">
        {drivers.length === 0 ? (
          <>
            <span className="font-semibold text-[var(--color-text-secondary)]">{team.abbreviation}</span>{" "}
            no listed absence the model counts
          </>
        ) : (
          <>
            <span className="font-semibold text-[var(--color-text-secondary)]">
              {team.abbreviation} gives up {formatPoints(points)}
            </span>
            : {driversText(drivers, points)}
          </>
        )}
      </span>
    </li>
  );
}

/** The players behind the number on the card, from the NBA report it used. */
function ModelInjuries({ game, espnAvailable }: { game: SlateGameView; espnAvailable: boolean }) {
  const forecast = game.forecast;
  const header = (detail: React.ReactNode) => (
    <p className="text-xs text-[var(--color-text-muted)]">
      <span className="font-semibold text-[var(--color-text-secondary)]">Injuries in the model</span>
      {detail}
    </p>
  );
  if (!forecast) return null;
  if (!forecast.absencePoints || !forecast.drivers) {
    return (
      <div className="border-t border-[var(--color-border-subtle)] pt-3">
        {header(
          <span>
            {" "}
            · none in this number: it was sealed by {forecast.modelVersion}, which does not model
            injuries.
          </span>,
        )}
        <EspnFallback game={game} available={espnAvailable} />
      </div>
    );
  }
  if (forecast.availabilityMissing) {
    return (
      <div className="border-t border-[var(--color-border-subtle)] pt-3">
        {header(
          <span className="text-[var(--color-warning)]">
            {" "}
            · none: no NBA injury report under 24 hours old could be read, so this number has no
            absences in it.
          </span>,
        )}
        <EspnFallback game={game} available={espnAvailable} />
      </div>
    );
  }
  const when = forecast.reportAt ? formatReportTime(forecast.reportAt) : null;
  return (
    <div className="border-t border-[var(--color-border-subtle)] pt-3">
      {header(
        <>
          {when ? <span> · NBA report {when}</span> : null}
          {forecast.availabilityStale ? (
            <span className="text-[var(--color-warning)]">
              {" "}
              · the newest report could not be read, so an earlier one is used
            </span>
          ) : null}
        </>,
      )}
      <ul className="mt-1.5 grid gap-1">
        <SideAbsence
          teamId={game.awayId}
          points={forecast.absencePoints.away}
          drivers={forecast.drivers.away}
        />
        <SideAbsence
          teamId={game.homeId}
          points={forecast.absencePoints.home}
          drivers={forecast.drivers.home}
        />
      </ul>
    </div>
  );
}

function marginText(game: SlateGameView): string | null {
  const margin = game.forecast?.expectedMargin;
  if (margin === undefined) return null;
  if (Math.abs(margin) < 0.05) return "Even";
  const favorite = teamById(margin > 0 ? game.homeId : game.awayId);
  return `${favorite.abbreviation} by ${Math.abs(margin).toFixed(1)}`;
}

function seriesText(game: SlateGameView): string | null {
  if (!game.series) return game.seriesSummary;
  const home = teamById(game.homeId);
  const away = teamById(game.awayId);
  const { homeWins, awayWins, homeWinsSeries } = game.series;
  const score =
    homeWins === awayWins
      ? `Series tied ${homeWins}-${awayWins}`
      : homeWins > awayWins
        ? `${home.abbreviation} leads ${homeWins}-${awayWins}`
        : `${away.abbreviation} leads ${awayWins}-${homeWins}`;
  if (homeWins >= 4 || awayWins >= 4) {
    return `${homeWins > awayWins ? home.abbreviation : away.abbreviation} won the series ${Math.max(homeWins, awayWins)}-${Math.min(homeWins, awayWins)}`;
  }
  const favorite = homeWinsSeries >= 0.5 ? home : away;
  const chance = homeWinsSeries >= 0.5 ? homeWinsSeries : 1 - homeWinsSeries;
  return `${score} · ${favorite.abbreviation} ${formatChance(chance)} to win the series`;
}

export function GameCard({
  game,
  records,
  injuriesAvailable,
  modelVersion,
}: {
  game: SlateGameView;
  records: Record<string, string>;
  injuriesAvailable: boolean;
  /** The published model, so a seal from an older model is labeled as such. */
  modelVersion: string;
}) {
  const viewerZone = useIsClient();
  const home = teamById(game.homeId);
  const away = teamById(game.awayId);
  const isLive = game.status === "in-progress";
  const isFinal = game.status === "final";
  const showScores =
    (isLive || isFinal) && game.homeScore !== null && game.awayScore !== null;
  const homeWon = isFinal && showScores && game.homeScore! > game.awayScore!;
  const awayWon = isFinal && showScores && game.awayScore! > game.homeScore!;

  const pregameHome = game.forecast?.homeWinProbability ?? null;
  const liveHome = game.inGameHomeProbability;
  const shownHome = liveHome ?? pregameHome;
  const marketHome = game.market?.homeWinProbability ?? null;
  const marketTitle = game.market
    ? `${game.market.provider} line via ESPN, vig removed, for reference`
    : "No market line available";
  const provisional = game.forecast?.source === "provisional";
  const status = forecastStatus(game, viewerZone, modelVersion);
  const margin = marginText(game);
  const series = seriesText(game);

  const rows = [
    { team: away, score: game.awayScore, won: awayWon, model: shownHome === null ? null : 1 - shownHome, pregame: pregameHome === null ? null : 1 - pregameHome, market: marketHome === null ? null : 1 - marketHome, side: "Away" },
    { team: home, score: game.homeScore, won: homeWon, model: shownHome, pregame: pregameHome, market: marketHome, side: game.neutral ? null : "Home" },
  ];

  return (
    <article
      aria-label={`${away.name} at ${home.name}`}
      className={`flex flex-col gap-4 rounded-xl border bg-[var(--color-panel-primary)] p-4 sm:p-5 ${
        isLive
          ? "border-[var(--color-live-border)] shadow-[inset_3px_0_0_var(--color-live)]"
          : "border-[var(--color-border-subtle)]"
      }`}
    >
      <header className="flex items-start justify-between gap-3">
        <StatusLine game={game} viewerZone={viewerZone} />
        {status ? <StatusBadge status={status} /> : null}
      </header>

      <table className="w-full border-collapse">
        <caption className="sr-only">
          {away.name} at {home.name}
          {game.neutral ? ", neutral site" : ""}
        </caption>
        <thead>
          <tr className="text-[11px] font-medium text-[var(--color-text-muted)]">
            <th scope="col" className="pb-1 text-left font-medium">
              <span className="sr-only">Team</span>
            </th>
            {showScores ? (
              <th scope="col" className="pb-1 pl-3 text-right font-medium">
                Score
              </th>
            ) : null}
            <th scope="col" className="pb-1 pl-3 text-right font-medium">
              {liveHome !== null ? (
                <span className="text-[var(--color-live)]">Live</span>
              ) : provisional ? (
                "Model*"
              ) : (
                "Model"
              )}
            </th>
            {liveHome !== null ? (
              <th scope="col" className="pb-1 pl-3 text-right font-medium">
                Pregame
              </th>
            ) : null}
            <th scope="col" className="pb-1 pl-3 text-right font-medium" title={marketTitle}>
              Market
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.team.id}>
              <th scope="row" className="py-1.5 text-left font-normal">
                <span className="flex min-w-0 items-center gap-2.5">
                  <TeamLogo teamId={row.team.id} size={28} />
                  <span className="min-w-0">
                    <span
                      className={`block truncate text-sm sm:text-[15px] ${
                        isFinal && !row.won
                          ? "font-medium text-[var(--color-text-muted)]"
                          : "font-semibold text-[var(--color-text-primary)]"
                      }`}
                    >
                      <span className="sm:hidden">{row.team.shortName}</span>
                      <span className="hidden sm:inline">{row.team.name}</span>
                    </span>
                    <span className="tabular block text-xs text-[var(--color-text-muted)]">
                      {records[row.team.id] ?? ""}
                      {row.side === "Home" ? " · Home" : ""}
                    </span>
                  </span>
                </span>
              </th>
              {showScores ? (
                <td
                  className={`tabular py-1.5 pl-3 text-right text-lg ${
                    isFinal && !row.won
                      ? "font-medium text-[var(--color-text-muted)]"
                      : "font-bold text-[var(--color-text-primary)]"
                  }`}
                >
                  {row.score}
                </td>
              ) : null}
              <Percent value={row.model} emphasis="strong" />
              {liveHome !== null ? <Percent value={row.pregame} emphasis="muted" /> : null}
              <Percent value={row.market} emphasis="normal" title={marketTitle} />
            </tr>
          ))}
        </tbody>
      </table>

      {shownHome !== null ? (
        <TeamProbabilityBar
          leftId={game.awayId}
          rightId={game.homeId}
          leftProbability={1 - shownHome}
          label={liveHome !== null ? "Live model win probability" : "Model win probability"}
        />
      ) : null}

      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--color-text-muted)]">
        {margin ? (
          <div className="flex gap-1">
            <dt>Expected margin</dt>
            <dd className="tabular font-medium text-[var(--color-text-secondary)]">{margin}</dd>
          </div>
        ) : null}
        {game.neutral ? (
          <div className="flex gap-1">
            <dt className="sr-only">Venue</dt>
            <dd>Neutral site</dd>
          </div>
        ) : null}
        {series ? (
          <div className="flex gap-1">
            <dt className="sr-only">Series</dt>
            <dd className="tabular font-medium text-[var(--color-text-secondary)]">{series}</dd>
          </div>
        ) : null}
        {provisional ? (
          <div className="flex gap-1">
            <dt className="sr-only">Note</dt>
            <dd>*Provisional, not scored</dd>
          </div>
        ) : null}
        {game.sealedFavoriteWon !== null && pregameHome !== null ? (
          <div className="flex items-center gap-1">
            <dt className="sr-only">Result</dt>
            <dd className="flex items-center gap-1 font-medium text-[var(--color-text-secondary)]">
              {game.sealedFavoriteWon ? (
                <CheckCircle2 size={13} aria-hidden className="text-[var(--color-success)]" />
              ) : (
                <XCircle size={13} aria-hidden className="text-[var(--color-text-muted)]" />
              )}
              {pregameHome === 0.5
                ? "Sealed as a toss-up"
                : `Model favorite ${(pregameHome > 0.5 ? home : away).abbreviation} ${
                    game.sealedFavoriteWon ? "won" : "lost"
                  }`}
            </dd>
          </div>
        ) : null}
      </dl>

      <ModelInjuries game={game} espnAvailable={injuriesAvailable} />
    </article>
  );
}
