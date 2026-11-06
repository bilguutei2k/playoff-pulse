import Link from "next/link";
import { Bracket, BracketContext } from "@/components/live/GameCard";
import { PlayerLink } from "@/components/live/PlayerLink";
import { TeamLogo } from "@/components/live/TeamLogo";
import { sealPolicyRevision } from "@/lib/season/policy-revisions";
import { PROJECTION_WITH_INJURIES_LABEL } from "@/lib/season/projections";
import type { SealRow, SeasonGame, TeamForecast } from "@/lib/season/types";
import { formatReportTime, formatShortDay, formatTimeEt, formatWeekday } from "@/lib/utils/dates";
import { formatChance } from "@/lib/utils/format";
import { bracketView, type BracketView } from "@/lib/view/bracket";
import { splitPercents, statusLabel } from "@/lib/view/card";
import type { DayGame } from "@/lib/view/day";
import type { GameDetail } from "@/lib/view/game";
import {
  headerBracket,
  marginLine,
  sealSeries,
  signedPoints,
  waterfall,
  type MarginMark,
  type SeasonLine,
} from "@/lib/view/game-page";
import { basisSentence } from "@/lib/view/injury-report";
import { filingNote, othersNote, playerPoints, type AbsenceSide } from "@/lib/view/injuries";
import type { MarginBreakdown } from "@/lib/view/margin";
import { PROJECTION_LABEL } from "@/lib/view/projection";
import { formatRecord, teamColor, teamDisplay, teamHref, type TeamLine } from "@/lib/view/teams";

const KIND_LABELS: Record<SeasonGame["kind"], string | null> = {
  regular: null,
  "cup-final": "NBA Cup final",
  "play-in": "Play-in",
  playoff: "Playoffs",
};

/** A v8 section: the ink rule, the heading and a grey note at the right. */
function Section({
  id,
  title,
  note,
  children,
  className = "",
}: {
  id: string;
  title: string;
  note?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={className}>
      <div className="sh">
        <h2 id={id}>{title}</h2>
        {note ? <span>{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Notes({ children }: { children: React.ReactNode }) {
  return <div className="mt-4 space-y-1.5 text-[13px] leading-5 text-ink-2 empty:hidden">{children}</div>;
}

// ---------------------------------------------------------------------------
// Header: status line, the large bracket, the market line.

function statusLead(game: DayGame): string {
  if (game.status === "scheduled") return game.projection ? "Upcoming" : "Today";
  return statusLabel(game).label;
}

export function MatchupHeader({
  game,
  lines,
  modelVersion,
}: {
  game: DayGame;
  lines: Record<string, TeamLine>;
  modelVersion: string;
}) {
  const base = bracketView({ game, lines, modelVersion });
  // From 640 px the tile's label carries the seal time; a phone keeps it short.
  const view = headerBracket(base, game);
  const kind = KIND_LABELS[game.kind];
  const place = game.extras?.city ?? game.extras?.venue ?? (game.neutral ? "Neutral site" : null);
  const meta = [
    kind,
    `${formatWeekday(game.etDate)}, ${formatShortDay(game.etDate)}`,
    formatTimeEt(game.tipUtc),
    place,
    game.status === "scheduled" ? (game.extras?.broadcast ?? null) : null,
  ].filter((part): part is string => Boolean(part));
  const live = game.status === "in-progress" && game.inGameHomeProbability !== null;
  const provider = game.market?.provider ?? game.marketLine?.provider ?? "DraftKings";
  // The context row under the header carries the market and the notes; absences have their own section.
  // Projection and pre-injury notes are spelled out in full below, so the row drops their short forms.
  const context: BracketView = {
    ...view,
    out: [],
    unfiled: [],
    notes: view.notes.filter((note) => !game.projection && note !== "Before injuries"),
  };
  return (
    <header>
      <p className="mb-5 text-[13px]">
        <b>{statusLead(game)}</b>
        <span className="text-ink-2"> · {meta.join(" · ")}</span>
        {view.status.right && !/^(Sealed|Reissued) \d/.test(view.status.right) ? (
          <span className="text-ink-2" title={view.status.title ?? undefined}>
            {" "}
            · {view.status.right}
          </span>
        ) : null}
      </p>
      <div className="max-w-[1000px]">
        <div className="sm:hidden">
          <Bracket view={base} large />
        </div>
        <div className="hidden sm:block">
          <Bracket view={view} large />
        </div>
        <div className="mt-3.5">
          <BracketContext view={context} marketLabel={`Market, ${provider}:`} />
        </div>
        <Notes>
          {live ? (
            <p>The live estimate uses the score and the time left; it never changes a seal.</p>
          ) : null}
          {game.projection ? (
            <p>
              {game.projection.withInjuries
                ? `${PROJECTION_WITH_INJURIES_LABEL} ${basisSentence(game.projection.basis, game.etDate)}`
                : PROJECTION_LABEL}
            </p>
          ) : null}
          {game.forecast && game.forecast.absencePoints === null ? (
            <p>Before injuries: this number comes from {game.forecast.modelVersion}, which does not account for injuries.</p>
          ) : null}
        </Notes>
      </div>
    </header>
  );
}

/** Missed, before the record, or nothing yet: the page says why there is no number. */
export function NoNumber({ game }: { game: DayGame }) {
  return (
    <Section id="win-probability" title="No forecast">
      <p className="max-w-xl text-[15px] text-ink-2">
        {game.missed
          ? "This game tipped before a forecast was sealed, so there is no number for it. It counts as missed in the record and is never backfilled."
          : game.beforeRecord
            ? "This game tipped before the first forecast was sealed, so it has no number and is not in the record."
            : "No forecast is available for this game yet."}
      </p>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Margin: 548, the market and the result on one number line.

/**
 * A mark's label, centred over it unless a neighbouring stem (548's or the market's)
 * would run through it; then it opens away from that stem.
 */
function MarkLabel({ mark, at, top, stems = [] }: { mark: MarginMark; at: number; top: number; stems?: number[] }) {
  const near = stems.filter((stem) => Math.abs(stem - at) < 12 && stem !== at).sort((a, b) => Math.abs(a - at) - Math.abs(b - at))[0];
  let align: string;
  let left = `${at}%`;
  if (near !== undefined) {
    align = near < at ? "translate-x-0" : "-translate-x-full";
    left = `calc(${at}% ${near < at ? "+ 6px" : "- 6px"})`;
  } else {
    align = at < 7 ? "translate-x-0" : at > 93 ? "-translate-x-full" : "-translate-x-1/2";
  }
  return (
    <span
      className={`absolute whitespace-nowrap text-[13px] leading-none ${align} ${mark.key === "market" ? "text-ink-2" : "text-ink"}`}
      style={{ left, top }}
    >
      <b className={mark.key === "model" ? "font-extrabold" : "font-bold"}>{signedPoints(mark.value)}</b> {mark.label}
    </span>
  );
}

export function MarginSection({ game }: { game: DayGame }) {
  const line = marginLine(game);
  if (!line) return null;
  const team = teamDisplay(line.teamId);
  const other = teamDisplay(line.otherId);
  const x = (value: number) => ((value - line.min) / (line.max - line.min)) * 100;
  const model = line.marks.find((mark) => mark.key === "model")!;
  const market = line.marks.find((mark) => mark.key === "market");
  const result = line.marks.find((mark) => mark.key === "final" || mark.key === "now");
  const provider = game.market?.provider ?? game.marketLine?.provider ?? "DraftKings";
  const summary = line.marks.map((mark) => `${mark.label} ${signedPoints(mark.value)}`).join(", ");
  return (
    <Section id="margin" title="Margin" note={`Points, ${team.shortName} positive`}>
      <div
        role="img"
        aria-label={`Margin in points toward the ${team.shortName}: ${summary}.`}
        className="relative mx-1 h-[140px] sm:mx-2.5"
      >
        <span aria-hidden className="absolute top-[14px] h-[78px] w-px bg-line" style={{ left: `${x(0)}%` }} />
        <span aria-hidden className="absolute inset-x-0 top-[91px] h-0.5 bg-ink" />
        {line.ticks.map((tick) => (
          <span key={tick} aria-hidden>
            <span className="absolute top-[92px] h-1.5 w-px bg-ink" style={{ left: `${x(tick)}%` }} />
            <span
              className="absolute top-[102px] -translate-x-1/2 text-[11.5px] text-ink-2"
              style={{ left: `${x(tick)}%` }}
            >
              {tick === 0 ? "Even" : tick > 0 ? `+${tick}` : `−${Math.abs(tick)}`}
            </span>
          </span>
        ))}
        <span aria-hidden className="absolute left-0 top-[122px] text-[12px] text-ink-2">
          {other.shortName} by more
        </span>
        <span aria-hidden className="absolute right-0 top-[122px] text-[12px] text-ink-2">
          {team.shortName} by more
        </span>
        {result ? (
          <span aria-hidden>
            <span
              className={`absolute top-[84px] h-4 w-4 -translate-x-1/2 border-[2.5px] border-ink bg-white ${result.key === "now" ? "border-dashed" : ""}`}
              style={{ left: `${x(result.value)}%` }}
            />
            <MarkLabel mark={result} at={x(result.value)} top={62} stems={[x(model.value), ...(market ? [x(market.value)] : [])]} />
          </span>
        ) : null}
        {market ? (
          <span aria-hidden>
            <span className="absolute top-[66px] h-8 w-0.5 -translate-x-1/2 bg-ink-2" style={{ left: `${x(market.value)}%` }} />
            <MarkLabel mark={market} at={x(market.value)} top={48} stems={[x(model.value)]} />
          </span>
        ) : null}
        <span aria-hidden>
          <span className="absolute top-[40px] h-[43px] w-px -translate-x-1/2 bg-ink" style={{ left: `${x(model.value)}%` }} />
          <span className="absolute top-[83px] h-[18px] w-[18px] -translate-x-1/2 bg-ink" style={{ left: `${x(model.value)}%` }} />
          <MarkLabel mark={model} at={x(model.value)} top={24} />
        </span>
      </div>
      <Notes>
        {game.projection ? (
          <p>A projection is never compared with the market.</p>
        ) : market ? (
          <p>
            Market: the {provider} line via ESPN, vig removed. Reference only: never a model input. The track record sets
            its Brier beside 548&apos;s only after 500 scored games.
          </p>
        ) : (
          <p>No market line for this game.</p>
        )}
      </Notes>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Where the margin comes from: the breakdown's parts as a waterfall.

export function WhereFrom({
  game,
  breakdown,
  detail,
}: {
  game: DayGame;
  breakdown: MarginBreakdown;
  detail: GameDetail;
}) {
  const fall = waterfall(game, breakdown, detail);
  const team = teamDisplay(fall.teamId);
  const pct = (value: number) => ((value - fall.min) / (fall.max - fall.min)) * 100;
  const forecast = game.forecast;
  return (
    <Section id="where-from" title={`Where ${Math.abs(fall.total).toFixed(1)} comes from`} note={`Points toward the ${team.shortName}`}>
      <div className="grid grid-cols-[minmax(0,1fr)_64px] gap-x-3 gap-y-3 sm:grid-cols-[220px_minmax(0,1fr)_72px]">
        {fall.rows.map((row, index) => {
          const left = pct(Math.min(row.from, row.to));
          const width = Math.abs(pct(row.to) - pct(row.from));
          const last = index === fall.rows.length - 1;
          return (
            <div key={row.key} className="contents">
              <div className="col-span-2 sm:col-span-1">
                <p className="text-[14px] font-bold leading-5">{row.label}</p>
                {row.sub ? <p className="text-[12.5px] leading-4 text-ink-2">{row.sub}</p> : null}
              </div>
              <div aria-hidden className="relative min-h-6 self-stretch">
                <span
                  className="absolute top-1 h-4"
                  style={{ left: `${left}%`, width: `${Math.max(width, 0.4)}%`, background: teamColor(row.teamId) }}
                />
                {!last ? (
                  <span className="absolute -bottom-3 top-5 hidden w-px bg-ink sm:block" style={{ left: `${pct(row.to)}%` }} />
                ) : null}
              </div>
              <p className="num pt-0.5 text-right text-[14px] font-bold">{row.value >= 0 ? "+" : "−"}{Math.abs(row.value).toFixed(1)}</p>
            </div>
          );
        })}
        <div aria-hidden className="col-span-2 h-0.5 bg-ink sm:col-span-3" />
        <p className="col-span-2 text-[14px] font-bold sm:col-span-1">Predicted margin</p>
        <div aria-hidden className="relative h-[22px]">
          <span
            className="absolute inset-y-0 bg-ink"
            style={{ left: `${pct(Math.min(0, fall.total))}%`, width: `${Math.abs(pct(fall.total) - pct(0))}%` }}
          />
        </div>
        <p className="num whitespace-nowrap text-right text-[16px] font-extrabold">
          {Math.abs(fall.total) < 0.05 ? "Even" : `${team.code} +${Math.abs(fall.total).toFixed(1)}`}
        </p>
        <span className="hidden sm:block" />
        <div aria-hidden className="relative h-4 text-[11.5px] text-ink-2">
          {fall.ticks.map((tick, index) => (
            <span
              key={tick}
              className={`absolute top-0 whitespace-nowrap ${index === 0 && tick === fall.min ? "" : "-translate-x-1/2"}`}
              style={{ left: `${pct(tick)}%` }}
            >
              {tick < 0 ? `−${Math.abs(tick)}` : tick} pts
            </span>
          ))}
        </div>
      </div>
      <p className="sr-only">
        {fall.rows.map((row) => `${row.label}: ${row.value >= 0 ? "+" : "−"}${Math.abs(row.value).toFixed(1)}`).join("; ")}.
        Predicted margin {team.code} {signedPoints(fall.total)}.
      </p>
      <Notes>
        {!breakdown.separated ? (
          <p>Ratings have been updated since this seal, so its rating and home-court parts are shown together.</p>
        ) : null}
        {game.projection && !game.projection.withInjuries ? (
          <p>This projection comes from ratings alone and has no injury term: expected absences enter when the game is sealed.</p>
        ) : null}
        {forecast && forecast.absencePoints === null ? (
          <p>This number is from {forecast.modelVersion}, which does not account for injuries, so there is no absence line.</p>
        ) : null}
      </Notes>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Out: each side's players behind the absence term.

const TOP_PLAYERS = 3;

function OutSide({
  side,
  scale,
  game,
  today,
}: {
  side: AbsenceSide;
  scale: number;
  game: DayGame;
  today: boolean;
}) {
  const team = teamDisplay(side.teamId);
  const color = teamColor(side.teamId);
  const ranked = side.players.filter((player) => (player.points ?? 0) >= 0.05).sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
  const shown = ranked.length <= TOP_PLAYERS + 1 ? ranked : ranked.slice(0, TOP_PLAYERS);
  const rest = side.players.filter((player) => !shown.includes(player));
  const restPoints = Math.max(0, side.points - shown.reduce((sum, player) => sum + (player.points ?? 0), 0));
  const filing = filingNote(side, today, game.projection !== null);
  const others = othersNote(side);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3 border-b-2 border-ink pb-2">
        <span className="flex items-center gap-2">
          <TeamLogo teamId={side.teamId} size={20} />
          <h3 className="text-[16px] font-bold">{team.shortName}</h3>
        </span>
        <span className="whitespace-nowrap">
          <b className="num">{side.points >= 0.05 ? `−${side.points.toFixed(1)}` : "0.0"}</b>{" "}
          <span className="text-[13px] text-ink-2">
            pts · {side.players.length} listed
          </span>
        </span>
      </div>
      {side.players.length === 0 ? (
        <p className="py-1.5 text-[14px] text-ink-2">
          {game.forecast?.availabilityMissing
            ? "No injury report was in use, so nobody is counted."
            : side.filing === "unfiled-counted"
              ? "Nobody missed its last game."
              : game.projection?.basis?.kind === "current-absences"
                ? "Nobody is counted as out."
                : "No listed absences."}
        </p>
      ) : (
        <ul>
          {shown.map((player, index) => (
            <li key={`${player.name}-${index}`} className="grid grid-cols-[minmax(0,1fr)_100px_44px] items-center gap-3 py-1.5 text-[15px]">
              <PlayerLink athleteId={player.athleteId} name={player.name} className="truncate" />
              <span aria-hidden className="block h-2.5" style={{ width: `${Math.min(100, ((player.points ?? 0) / scale) * 100)}%`, background: color }} />
              <span className="num text-right">{playerPoints(player.points ?? 0)}</span>
            </li>
          ))}
        </ul>
      )}
      {rest.length > 0 ? (
        <details className="group">
          <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_44px] gap-3 py-1.5 text-[15px] text-ink-2 hover:text-ink">
            <span>
              {rest.length} {shown.length > 0 ? (rest.length === 1 ? "other" : "others") : rest.length === 1 ? "player" : "players"}
              <span className="ml-2 text-[12.5px] underline underline-offset-2 group-open:hidden">show</span>
              <span className="ml-2 hidden text-[12.5px] underline underline-offset-2 group-open:inline">hide</span>
            </span>
            <span className="num text-right">{restPoints >= 0.05 ? `−${restPoints.toFixed(1)}` : "0.0"}</span>
          </summary>
          <div className="pb-2">
            {side.groups.map((group) => {
              const players = group.players.filter((player) => rest.includes(player));
              if (players.length === 0) return null;
              return (
                <div key={group.key} className="mt-2">
                  <p className="text-[12.5px] text-ink-2">
                    {group.label} ({players.length})
                  </p>
                  <ul className="mt-0.5">
                    {players.map((player, index) => (
                      <li key={`${player.name}-${index}`} className="flex justify-between gap-3 py-0.5 text-[14px]">
                        <PlayerLink athleteId={player.athleteId} name={player.name} />
                        <span className="num text-ink-2">{player.points === null ? "" : playerPoints(player.points)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
      {filing ? <p className="mt-2 text-[13px] leading-5 text-ink-2">{filing}</p> : null}
      {others ? <p className="mt-2 text-[13px] leading-5 text-ink-2">{others}</p> : null}
    </div>
  );
}

function reportNote(game: DayGame): string | null {
  const forecast = game.forecast;
  if (game.projection) {
    const basis = game.projection.basis;
    if (!basis) return null;
    return basis.kind === "current-absences" ? "Current absences, no report yet" : `NBA report, ${formatReportTime(basis.reportAt, game.etDate)}`;
  }
  if (!forecast) return null;
  if (forecast.availabilityMissing) return "No report available";
  if (forecast.reportAt) return `NBA report, ${formatReportTime(forecast.reportAt, game.etDate)}${forecast.availabilityStale ? ", last good one" : ""}`;
  return null;
}

export function OutSection({ game, today }: { game: DayGame; today: boolean }) {
  const sides = game.absences;
  if (!sides) return null;
  const forecast = game.forecast;
  const scale = Math.max(
    3,
    ...[...sides.away.players, ...sides.home.players].map((player) => player.points ?? 0),
  );
  return (
    <Section id="out" title="Out" note={reportNote(game)}>
      <div className="grid gap-10 sm:grid-cols-2 sm:gap-14">
        <OutSide side={sides.away} scale={scale} game={game} today={today} />
        <OutSide side={sides.home} scale={scale} game={game} today={today} />
      </div>
      <Notes>
        {game.projection?.withInjuries ? (
          <p>
            {basisSentence(game.projection.basis, game.etDate)} The seals on game day count the report in use at each
            seal. The <Link href="/injuries" className="pp-link">injury report</Link> has each team&apos;s full list,
            with reasons and the players the model infers from box scores.
          </p>
        ) : null}
        {forecast?.availabilityMissing ? <p>No NBA injury report under 24 hours old was available, so absences are zero.</p> : null}
        {forecast?.availabilityStale && forecast.reportAt ? (
          <p>The latest report could not be read, so the last good one, from {formatReportTime(forecast.reportAt, game.etDate)}, was used.</p>
        ) : null}
        {forecast?.reportAt && !forecast.availabilityStale ? (
          <p>Injury report used: the NBA&apos;s report of {formatReportTime(forecast.reportAt, game.etDate)}.</p>
        ) : null}
        {game.forecast ? (
          <p>
            A seal counts the players on the report in use, each weighted by how often players with his status did not
            play, for any reason. A team the report marks as not yet submitted is the exception: since policy revision 2
            its side counts the team&apos;s current absences, inferred from box scores, instead. Team pages and the season
            odds list current absences, which is who the season simulation counts as out. Unknown future injuries,
            minutes shifting to teammates and matchups are not modeled.
          </p>
        ) : null}
      </Notes>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Aside: result, seals, season so far.

function versionName(modelVersion: string): string {
  return `Model ${modelVersion.split("-").at(-1) ?? modelVersion}`;
}

/** "policy revision 1", or "policy revisions 0 and 1" for seals on both sides of a change. Empty outside v2. */
function revisionNote(rows: ReadonlyArray<SealRow | null>): string {
  const revisions = [...new Set(rows.flatMap((row) => (row ? [sealPolicyRevision(row)] : [])))]
    .filter((revision): revision is number => revision !== null)
    .sort((a, b) => a - b);
  if (revisions.length === 0) return "";
  if (revisions.length === 1) return `policy revision ${revisions[0]}`;
  return `policy revisions ${revisions.slice(0, -1).join(", ")} and ${revisions.at(-1)}`;
}

function versionNote(seal: SealRow, role: GameDetail["versions"][number]["role"]): string {
  if (seal.absencePoints === undefined) return "no injuries";
  const revision = revisionNote([seal]);
  return `${role === "published" ? "published" : role === "reference" ? "reference" : "earlier"}${revision ? `, ${revision}` : ""}`;
}

export function Result({ game, detail }: { game: DayGame; detail: GameDetail }) {
  if (game.status !== "final" || game.homeScore === null || game.awayScore === null) return null;
  const winner = teamDisplay(detail.homeWon ? game.homeId : game.awayId);
  const high = Math.max(game.homeScore, game.awayScore);
  const low = Math.min(game.homeScore, game.awayScore);
  return (
    <Section id="result" title="Result">
      <p className="text-[24px] font-extrabold leading-tight">
        {winner.shortName} won <span className="num">{high}–{low}</span>
      </p>
      {detail.results.length === 0 ? (
        <p className="mt-3 text-[14px] text-ink-2">No seal was scored for this game.</p>
      ) : (
        <div className="mt-5 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3.5">
          {detail.results.map((result) => {
            const percent = splitPercents(result.seal.homeWinProbability)[detail.homeWon ? "home" : "away"];
            return (
              <div key={result.modelVersion} className="contents">
                <span className={`tile h-[30px] min-w-14 text-[17px] ${result.role === "published" ? "" : "tile-live"}`}>{percent}%</span>
                <span className="min-w-0">
                  <b>{versionName(result.modelVersion)}</b>{" "}
                  <span className="text-[13px] text-ink-2">{versionNote(result.seal, result.role)}</span>
                </span>
                <span className="whitespace-nowrap text-[13px]">
                  Brier <b className="num">{result.brier.toFixed(3)}</b>
                </span>
              </div>
            );
          })}
        </div>
      )}
      <Notes>
        {detail.results.length > 0 ? (
          <p>
            Each tile is that model&apos;s sealed chance for the {winner.shortName}. Brier is the squared gap between the
            forecast and the result: 0 is perfect and an even 50% scores 0.25. One game says nothing about skill; see the{" "}
            <Link className="pp-link" href="/record">track record</Link>.
          </p>
        ) : null}
      </Notes>
    </Section>
  );
}

function SealChart({ game, detail }: { game: DayGame; detail: GameDetail }) {
  const series = sealSeries(game, detail);
  if (!series) return null;
  const width = 400;
  const left = 50;
  const right = 368;
  const top = 22;
  const floor = 140;
  const span = series.end - series.start;
  const x = (at: string) => (span <= 0 ? (left + right) / 2 : left + ((Date.parse(at) - series.start) / span) * (right - left));
  const y = (percent: number) => top + ((100 - percent) / (100 - series.min)) * (floor - top);
  const grid = series.min === 50 ? [50, 75, 100] : series.min === 25 ? [25, 50, 75, 100] : [0, 50, 100];
  const own = series.points.filter((point) => !point.reference);
  const reference = series.points.filter((point) => point.reference);
  const team = teamDisplay(series.teamId);
  // A reference seal at or below a published one nearby takes the space under it, and
  // that published seal's label goes above; a reference seal above sits beside its square.
  const near = (a: { at: string; percent: number }, b: { at: string; percent: number }) =>
    Math.abs(x(a.at) - x(b.at)) < 70 && Math.abs(y(a.percent) - y(b.percent)) < 26;
  const yieldsBelow = (ref: (typeof reference)[number], point: (typeof own)[number]) =>
    near(ref, point) && y(ref.percent) >= y(point.percent) - 8;
  const times: Array<{ at: string; x: number }> = [];
  for (const point of own.length > 0 ? own : reference) {
    const px = x(point.at);
    if (times.every((time) => Math.abs(time.x - px) >= 70)) times.push({ at: point.at, x: px });
  }
  const anchor = (px: number) => (px <= left + 20 ? "start" : px >= right - 20 ? "end" : "middle");
  return (
    <svg
      viewBox={`0 0 ${width} 184`}
      className="block h-auto w-full max-w-[400px]"
      role="img"
      aria-label={`${team.shortName}' chance in each seal: ${series.points.map((point) => `${point.label} ${point.percent}% at ${formatTimeEt(point.at)}`).join(", ")}.`}
    >
      {grid.map((tick) => (
        <g key={tick}>
          <line x1={36} x2={394} y1={y(tick)} y2={y(tick)} stroke="#dcdcdc" />
          <text x={28} y={y(tick) + 4} fontSize={11.5} fill="#666666" textAnchor="end">
            {tick}%
          </text>
        </g>
      ))}
      {own.length > 1 ? (
        <polyline points={own.map((point) => `${x(point.at)},${y(point.percent)}`).join(" ")} fill="none" stroke="#111111" strokeWidth={2} />
      ) : null}
      {own.map((point, index) => {
        const px = x(point.at);
        const py = y(point.percent);
        const size = point.scored ? 16 : 11;
        const above =
          reference.some((ref) => yieldsBelow(ref, point)) ||
          index === own.length - 1 ||
          (own[index + 1] && own[index + 1].percent < point.percent && index > 0);
        return (
          <g key={point.key}>
            <rect x={px - size / 2} y={py - size / 2} width={size} height={size} fill="#111111" />
            <text x={px} y={above ? py - size / 2 - 6 : py + size / 2 + 15} fontSize={12.5} fill="#111111" textAnchor={anchor(px)}>
              <tspan fontWeight={700}>{point.percent}%</tspan> <tspan fill="#666666">{point.label}</tspan>
            </text>
          </g>
        );
      })}
      {reference.map((point) => {
        const px = x(point.at);
        const py = y(point.percent);
        const flip = px > right - 60;
        const below = own.some((other) => yieldsBelow(point, other));
        return (
          <g key={point.key}>
            <rect x={px - 5} y={py - 5} width={10} height={10} fill="#ffffff" stroke="#111111" strokeWidth={2} />
            <text
              x={below ? (flip ? px + 5 : px - 5) : flip ? px - 12 : px + 12}
              y={below ? py + 20 : py + 4}
              fontSize={12}
              fill="#666666"
              textAnchor={flip ? "end" : "start"}
            >
              {point.label} {point.percent}%
            </text>
          </g>
        );
      })}
      {times.map((time) => (
        <text key={time.at} x={time.x} y={178} fontSize={11.5} fill="#666666" textAnchor={anchor(time.x)}>
          {formatTimeEt(time.at).replace(/ ET$/, "")}
        </text>
      ))}
    </svg>
  );
}

function SealCell({ row, homeId, pending }: { row: SealRow | null; homeId: string; pending: string }) {
  if (!row) return <span className="text-ink-2">{pending}</span>;
  const { home } = splitPercents(row.homeWinProbability);
  return (
    <span>
      <b className="num whitespace-nowrap">
        {teamDisplay(homeId).code} {home}%
      </b>
      <span className="block whitespace-nowrap text-[12.5px] text-ink-2 sm:ml-1.5 sm:inline">
        {formatTimeEt(row.issuedAt).replace(/ ET$/, "")}
      </span>
    </span>
  );
}

function ScoredNote({ version, tipped }: { version: GameDetail["versions"][number]; tipped: boolean }) {
  if (!tipped) return <span className="text-ink-2">after the final</span>;
  if (version.scored === version.final && version.final) return <>Final seal</>;
  if (version.twoSeals) return <b className="text-warn">No final seal</b>;
  return <>Morning seal</>;
}

export function Seals({ game, detail }: { game: DayGame; detail: GameDetail }) {
  const tipped = game.status === "in-progress" || game.status === "final";
  const series = sealSeries(game, detail);
  return (
    <Section
      id="seals"
      title="Seals"
      note={series ? `${teamDisplay(series.teamId).shortName}' chance · never edited` : "Never edited"}
    >
      {detail.versions.length === 0 ? (
        <p className="text-[14px] leading-6 text-ink-2">
          {game.missed
            ? "No seal was made before tip. The game is counted as missed and is never backfilled."
            : game.beforeRecord
              ? "This game tipped before the first seal, so it is not part of the record."
              : "Not sealed yet. The morning seal is issued on game day, and the final seal in the hour before tip."}
        </p>
      ) : (
        <>
          <SealChart game={game} detail={detail} />
          <div className="table-scroll mt-5">
            <table className="tb">
              <caption className="sr-only">Every seal for this game, by model version, as the home team&apos;s chance</caption>
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  <th scope="col">Morning</th>
                  <th scope="col">Final</th>
                  <th scope="col" className="hidden sm:table-cell">Scored</th>
                </tr>
              </thead>
              <tbody>
                {detail.versions.map((version) => (
                  <tr key={version.modelVersion}>
                    <th scope="row" className="text-left align-top">
                      <b>{versionName(version.modelVersion)}</b>
                      <span className="block text-[12.5px] text-ink-2">
                        {[
                          version.role === "published" ? "Published" : version.role === "reference" ? "Reference" : "Earlier",
                          revisionNote([version.morning, version.reissued, version.final]),
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      </span>
                      <span className="mt-1 block text-[12.5px] font-normal sm:hidden">
                        Scored: <ScoredNote version={version} tipped={tipped} />
                      </span>
                    </th>
                    <td className="align-top">
                      <SealCell row={version.morning} homeId={game.homeId} pending="None" />
                      {version.reissued ? (
                        <span className="mt-1 block">
                          <SealCell row={version.reissued} homeId={game.homeId} pending="None" />
                          <span className="block text-[12.5px] text-ink-2">Reissued with the report</span>
                        </span>
                      ) : null}
                    </td>
                    <td className="align-top">
                      {version.twoSeals ? (
                        <SealCell row={version.final} homeId={game.homeId} pending={tipped ? "None" : "Due in the hour before tip"} />
                      ) : (
                        <span className="text-ink-2">Seals once</span>
                      )}
                    </td>
                    <td className="hidden align-top text-[13px] sm:table-cell">
                      <ScoredNote version={version} tipped={tipped} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <Notes>
        {game.beforeRecord ? null : (
          <p>
            Each game is sealed from results through the day before its date: a morning seal, then a final seal in the hour
            before tip with the latest NBA injury report. A box score that arrives late can change the ratings between the
            two. A morning seal made before any usable report is reissued once, when one arrives, and both stay in the
            ledger. The final seal is scored when it exists; otherwise the reissued seal is, else the original morning seal,
            and the game counts as &quot;no final seal&quot;. Every model version keeps its own record; v2&apos;s seals are
            labeled with the policy revision in force when they were issued.
          </p>
        )}
      </Notes>
    </Section>
  );
}

function SeasonTeam({
  teamId,
  line,
  season,
  next,
}: {
  teamId: string;
  line: TeamLine | undefined;
  season: SeasonLine | null;
  next: SeasonGame | null;
}) {
  const team = teamDisplay(teamId);
  const color = teamColor(teamId);
  const opponent = next ? teamDisplay(next.homeId === teamId ? next.awayId : next.homeId) : null;
  const at = (wins: number) => `${season ? Math.min(100, Math.max(0, (wins / season.games) * 100)) : 0}%`;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <Link href={teamHref(teamId)} className="flex items-center gap-2 hover:underline hover:underline-offset-4">
          <span className="self-center">
            <TeamLogo teamId={teamId} size={20} />
          </span>
          <b>{team.shortName}</b>
          {line ? <span className="num text-[13px] text-ink-2">{formatRecord(line.wins, line.losses)}</span> : null}
        </Link>
        {season ? (
          <span className="whitespace-nowrap text-[13px]">
            Playoffs <b className="num">{formatChance(season.playoffs)}</b>
          </span>
        ) : null}
      </div>
      {season ? (
        <>
          <div aria-hidden className="bar mb-3.5 mt-2 !h-2">
            <i style={{ width: `${season.playoffs * 100}%`, background: color }} />
          </div>
          <div className="flex justify-between text-[13px]">
            <span className="text-ink-2">
              Projected wins <span className="num">({season.p10}–{season.p90} in 8 of 10 simulations)</span>
            </span>
            <b className="num">{Math.round(season.projectedWins)}</b>
          </div>
          <div aria-hidden className="relative mt-1.5 h-3.5">
            <i className="absolute inset-x-0 top-1.5 h-0.5 bg-line" />
            <i className="absolute top-[3px] h-2" style={{ left: at(season.p10), width: `calc(${at(season.p90)} - ${at(season.p10)})`, background: color }} />
            <i className="absolute top-0 h-3.5 w-[3px] -translate-x-1/2 bg-ink" style={{ left: at(season.projectedWins) }} />
          </div>
          <p className="mt-2.5 text-[13px] text-ink-2">
            Title <b className="num text-ink">{formatChance(season.champion)}</b>
            {next && opponent ? (
              <>
                {" "}
                · Next{" "}
                <Link href={`/game/${next.id}`} className="pp-link font-semibold">
                  {formatWeekday(next.etDate)} {formatShortDay(next.etDate)} {next.homeId === teamId ? "vs" : "at"} {opponent.code}
                </Link>
              </>
            ) : null}
          </p>
        </>
      ) : null}
    </div>
  );
}

export function SeasonSoFar({
  teams,
  today,
}: {
  teams: Array<{ teamId: string; line: TeamLine | undefined; forecast: TeamForecast | undefined; season: SeasonLine | null; next: SeasonGame | null }>;
  today: boolean;
}) {
  return (
    <Section id="season" title="Season so far" note={today ? undefined : "As of now"}>
      <div className="flex flex-col gap-[30px]">
        {teams.map((team) => (
          <SeasonTeam key={team.teamId} teamId={team.teamId} line={team.line} season={team.season} next={team.next} />
        ))}
      </div>
      <Notes>
        <p>
          From the season simulation. Midseason playoff odds are not claimed to be well calibrated, and no skill is
          claimed for title odds. <Link href="/odds" className="pp-link">Every team&apos;s odds</Link>
        </p>
      </Notes>
    </Section>
  );
}
