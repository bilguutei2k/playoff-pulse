import type { Metadata } from "next";
import Link from "next/link";
import gameEvaluation from "../../../docs/live/evaluation-games.json";
import injuryEvaluation from "../../../docs/live/evaluation-injury.json";
import seasonEvaluation from "../../../docs/live/evaluation-season.json";
import {
  IN_GAME_SIGMA,
  INJURY_PARAMS,
  INJURY_STATUS_TABLE,
  INJURY_SURVIVAL,
  LIVE_MODEL_VERSION,
  LIVE_PARAMS,
  REFERENCE_MODEL_VERSION,
} from "@/lib/season/params";

export const metadata: Metadata = {
  title: "How the live forecast works | Playoff Pulse",
  description:
    "The rating model, the injury adjustment from the NBA injury report, the two seals per game, the market reference and the validation results behind the live NBA forecasts, including what failed.",
};

/** No claim about the model against the market before this many scored games. */
const MARKET_CLAIM_GAMES = 500;

const LEDGER_URL = "https://github.com/bilguutei2k/playoff-pulse/tree/main/data/live/ledger";
const REGISTRATION_URL =
  "https://github.com/bilguutei2k/playoff-pulse/blob/main/docs/live/registration.md";

function fixed(value: number, digits = 3): string {
  return value.toFixed(digits);
}

function interval(lower: number, upper: number): string {
  return `${lower >= 0 ? "+" : ""}${lower.toFixed(4)} to ${upper >= 0 ? "+" : ""}${upper.toFixed(4)}`;
}

/** A signed difference with a true minus sign, e.g. "−0.0051". */
function difference(value: number, digits = 4): string {
  return `${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(digits)}`;
}

function share(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

const SECTIONS = [
  { id: "terms", title: "What the numbers mean" },
  { id: "limits", title: "What it does not do" },
  { id: "game-forecasts", title: "Game forecasts" },
  { id: "injuries", title: "Injuries" },
  { id: "track-record", title: "Sealing and the track record" },
  { id: "in-game", title: "In-game estimates" },
  { id: "season-odds", title: "Season, playoff and title odds" },
  { id: "market", title: "The market reference" },
  { id: "testing", title: "How it tested" },
  { id: "shortfalls", title: "Where it fell short" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

function Section({ id, children }: { id: SectionId; children: React.ReactNode }) {
  const title = SECTIONS.find((section) => section.id === id)?.title ?? id;
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-6 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-panel-primary)] p-5 sm:p-6"
    >
      <h2
        id={`${id}-title`}
        className="text-lg font-semibold tracking-tight text-[var(--color-text-primary)]"
      >
        {title}
      </h2>
      <div className="mt-3 grid gap-3 text-[15px] leading-7 text-[var(--color-text-secondary)]">
        {children}
      </div>
    </section>
  );
}

function Term({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-[var(--color-border-subtle)] py-3 last:border-b-0 sm:grid-cols-[11rem_1fr] sm:gap-4">
      <dt className="font-semibold text-[var(--color-text-primary)]">{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export default function HowItWorksPage() {
  const gate = gameEvaluation.gameLevel.gateSeasons;
  const separate = gameEvaluation.gameLevel.reportedSeparately;
  const series = gameEvaluation.playoffs.seriesAgainstSrsHome;
  const checkpoints = seasonEvaluation.gateSeasons.byCheckpoint;
  const checkpointRows = [
    ["Dec 1", checkpoints.dec1],
    ["Feb 1", checkpoints.feb1],
    ["Apr 1", checkpoints.apr1],
  ] as const;
  const injury = injuryEvaluation.gates;
  const injuryReported = injuryEvaluation.reportedOnly;
  const injurySeasons = injuryReported.perSeason;
  const injuryCheckpoints = injury.T4.checks;
  const checkpointLabel: Record<string, string> = { dec1: "Dec 1", feb1: "Feb 1", apr1: "Apr 1" };

  return (
    <main className="pp-container py-6 sm:py-10">
      <div className="grid gap-10 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <nav aria-label="On this page" className="sticky top-6">
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">On this page</p>
            <ul className="mt-3 grid gap-2 text-sm">
              {SECTIONS.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
                  >
                    {section.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <div className="flex min-w-0 max-w-3xl flex-col gap-6">
          <header>
            <p className="text-sm font-medium text-[var(--color-text-muted)]">
              Model {LIVE_MODEL_VERSION}, with injuries · {REFERENCE_MODEL_VERSION} keeps its own
              record
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--color-text-primary)] sm:text-3xl">
              How the live forecast works
            </h1>
            <p className="mt-3 text-[15px] leading-7 text-[var(--color-text-muted)]">
              What the numbers on the{" "}
              <Link href="/" className="pp-link">
                games
              </Link>{" "}
              and{" "}
              <Link href="/odds" className="pp-link">
                season odds
              </Link>{" "}
              pages mean, how they were tested, and where they fall short. The archived{" "}
              <Link href="/retrospective" className="pp-link">
                2026 retrospective
              </Link>{" "}
              is a separate project and stays as it was.
            </p>
          </header>

          <Section id="terms">
            <dl>
              <Term term="Model">
                Our chance of each team winning, from full-strength team ratings, home court and the
                players on the NBA injury report. Probabilities are shown as whole percents, with
                &ldquo;&lt;1%&rdquo; and &ldquo;&gt;99%&rdquo; at the ends.
              </Term>
              <Term term="Sealed">
                A pregame forecast fixed before tip, written to a public ledger and scored once the
                game ends. Only sealed forecasts count in the track record.
              </Term>
              <Term term="Morning seal">
                The first seal, from 06:00 ET, with the injury report available then.
              </Term>
              <Term term="Final seal">
                The second seal, written by the first update in the hour before tip with the latest
                injury report. It is the number scored.
              </Term>
              <Term term="No final seal">
                A game that tipped with only its morning seal. The morning seal is scored, and the game
                is counted under this name in the track record.
              </Term>
              <Term term="Provisional">
                A stand-in number from the latest ratings, shown only when the scheduled update is
                late. It is labeled, replaced once the game is sealed, and never scored.
              </Term>
              <Term term="Missed">
                A game that tipped before a forecast was sealed. It is counted publicly and never
                backfilled.
              </Term>
              <Term term="Sealed before a result was in">
                Sealed on time while an earlier game was still unfinished, so that result is missing
                from its ratings. These seals are counted and still scored.
              </Term>
              <Term term="Before the record">
                A game that tipped before the first forecast was ever sealed. It was never part of
                the record.
              </Term>
              <Term term="Live">
                During a game, the model&apos;s in-game estimate from the score and the time left.
                The sealed pregame number stays beside it.
              </Term>
              <Term term="Market">
                The market&apos;s win probability for the same game, for reference only. See{" "}
                <a href="#market" className="pp-link">
                  the market reference
                </a>
                .
              </Term>
              <Term term="Expected margin">
                How many points the model expects the favorite to win by.
              </Term>
            </dl>
          </Section>

          <Section id="limits">
            <ul className="grid list-disc gap-2 pl-5">
              <li>
                <strong className="text-[var(--color-text-primary)]">
                  It sees injuries only through the NBA injury report.
                </strong>{" "}
                Listed players count by their status. It does not foresee injuries that have not
                happened, shift minutes to teammates, read matchups, or know about rest decisions
                that are not on the report.{" "}
                <a href="#injuries" className="pp-link">
                  How injuries work
                </a>
                .
              </li>
              <li>
                It cannot see off-season roster moves directly. Early in a season it leans on last
                season&apos;s results, shrunk toward average.
              </li>
              <li>It is not a betting product and makes no recommendations.</li>
              <li>
                Scores, schedules and market lines come from ESPN&apos;s public feeds, which are
                unofficial and undocumented. Injury statuses come from the NBA&apos;s public injury
                report PDFs, read without any arrangement with the league. There is no verified
                second source, and Playoff Pulse is not affiliated with the NBA.
              </li>
            </ul>
          </Section>

          <Section id="game-forecasts">
            <p>
              Each team has a rating in points, kept up to date by a Kalman filter over every final
              score since <span className="whitespace-nowrap">2004-05</span>. The filter also tracks how unsure it is about each team, and a
              slowly moving home-court advantage. The expected margin is the rating difference plus
              home court, adjusted {LIVE_PARAMS.b2b} points against a team playing the second night
              of a back-to-back.
            </p>
            <p>
              Rating uncertainty is added to the game&apos;s own randomness when the margin is
              turned into a chance of winning, so forecasts are pulled toward even when the model
              knows less. Blowouts count only up to {LIVE_PARAMS.marginCap} points. The parameters
              were fitted on seasons 2005 to 2015 only, then frozen.
            </p>
            <p>
              Since {LIVE_MODEL_VERSION}, the expected margin also gives up points for players on the
              NBA injury report, and the ratings describe each team at full strength. Every rating
              parameter above is unchanged from {REFERENCE_MODEL_VERSION}.{" "}
              <a href="#injuries" className="pp-link">
                How injuries work
              </a>
              .
            </p>
          </Section>

          <Section id="injuries">
            <p>
              <strong className="text-[var(--color-text-primary)]">Player value.</strong> Each
              player&apos;s value comes from ESPN box scores: his Game Score per minute (a one-number
              summary of a box-score line), weighted toward recent games and pulled toward a
              replacement level of {INJURY_PARAMS.gRep} per minute until he has played about{" "}
              {INJURY_PARAMS.k.toLocaleString("en-US")} minutes, times the minutes he has been playing
              lately. A player at or below replacement level is worth nothing, so listing him changes
              nothing.
            </p>
            <p>
              <strong className="text-[var(--color-text-primary)]">Status weights.</strong> Each
              listed player counts by how often players with his status did not play in 2021-22 to
              2023-24: Out {share(INJURY_STATUS_TABLE.O)}, Doubtful {share(INJURY_STATUS_TABLE.D)},
              Questionable {share(INJURY_STATUS_TABLE.Q)}, Probable and Available{" "}
              {share(INJURY_STATUS_TABLE.P)}. A team&apos;s expected absence is the sum, and every unit
              of Game Score costs {INJURY_PARAMS.beta} points of margin. Each game card names the
              players behind the points its team gives up.
            </p>
            <p>
              <strong className="text-[var(--color-text-primary)]">Full-strength ratings.</strong>{" "}
              From 2020-21, when box scores begin, the ratings learn from margins adjusted for who
              actually missed each game. A team that won without its star gets more credit, so its
              rating describes it with everyone available, and a long absence is not counted twice.
              The season table shows that rating beside a &ldquo;now&rdquo; rating with current
              absences.
            </p>
            <p>
              <strong className="text-[var(--color-text-primary)]">The final seal.</strong> Injury
              news often lands in the afternoon, so each game is sealed twice: in the morning, and by
              the first update in the hour before tip, from the same frozen ratings with the latest
              report. The final seal is scored. If the report cannot be read, a seal uses the last
              good one when it is under 24 hours old and says so; otherwise it has no absences and is
              marked as missing them.
            </p>
            <p>
              <strong className="text-[var(--color-text-primary)]">Return estimates.</strong> In
              the season odds, a player counted as out misses the number of further team games
              expected from a survival table fitted on 2021-22 to 2023-24, then returns: about{" "}
              {INJURY_SURVIVAL.short[0].toFixed(1)} more games for a fresh short absence, and{" "}
              {INJURY_SURVIVAL.long[0].toFixed(1)} when the report&apos;s reason names a surgery, tear,
              fracture or similar. Return estimates come from that table only. ESPN&apos;s estimated
              return dates are stored at every update for later study, but never used.
            </p>
            <p>
              <strong className="text-[var(--color-text-primary)]">The test.</strong> The adjustment
              was fitted on 2021-22 to 2023-24 and registered, with its pass rule, before any number
              from the test seasons existed. It ran once on {injuryEvaluation.games.toLocaleString("en-US")}{" "}
              regular-season games in 2024-25 and 2025-26, against {REFERENCE_MODEL_VERSION} on the
              same games.
            </p>
            <div className="overflow-x-auto rounded-lg border border-[var(--color-border-subtle)]">
              <table className="pp-table">
                <caption className="sr-only">Registered injury test, 2024-25 and 2025-26</caption>
                <thead>
                  <tr>
                    <th scope="col">Registered test</th>
                    <th scope="col" className="num">
                      With injuries
                    </th>
                    <th scope="col" className="num">
                      {REFERENCE_MODEL_VERSION}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Brier, both seasons</th>
                    <td className="num">{fixed(injuryReported.overall.injury.brier, 4)}</td>
                    <td className="num">{fixed(injuryReported.overall.plain.brier, 4)}</td>
                  </tr>
                  {injurySeasons.map((row) => (
                    <tr key={row.season}>
                      <th scope="row">
                        Brier, {row.season - 1}-{String(row.season).slice(2)}
                      </th>
                      <td className="num">{fixed(row.injury.brier, 4)}</td>
                      <td className="num">{fixed(row.plain.brier, 4)}</td>
                    </tr>
                  ))}
                  <tr>
                    <th scope="row">Log loss</th>
                    <td className="num">{fixed(injury.T2.injury, 4)}</td>
                    <td className="num">{fixed(injury.T2.plain, 4)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Calibration slope</th>
                    <td className="num">{fixed(injury.T3.injury)}</td>
                    <td className="num">{fixed(injury.T3.plain)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Favorite won</th>
                    <td className="num">{share(injuryReported.overall.injury.accuracy)}</td>
                    <td className="num">{share(injuryReported.overall.plain.accuracy)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-sm leading-6 text-[var(--color-text-muted)]">
              The Brier difference is {difference(injury.T1.difference)}, with a 95% interval of{" "}
              {difference(injury.T1.lower)} to {difference(injury.T1.upper)} from a bootstrap of{" "}
              {injury.T1.clusters} game dates, and it is below zero in each season, which is what the
              rule required. The slope stayed within the registered 0.02 of {REFERENCE_MODEL_VERSION}
              &apos;s. In the season simulator, playoff-odds Brier and win-total error stayed within
              their tolerances at every checkpoint (
              {injuryCheckpoints
                .map(
                  (row) =>
                    `${checkpointLabel[row.checkpoint]}: ${fixed(row.makePlayoffsBrier.injury, 4)} against ${fixed(row.makePlayoffsBrier.plain, 4)}`,
                )
                .join("; ")}
              ). Using the 06:00 ET report instead of the one an hour before tip, Brier was{" "}
              {fixed(injuryReported.morningPoint.injuryBrier, 4)} against{" "}
              {fixed(injuryReported.overall.injury.brier, 4)}.
            </p>
            <ul className="grid list-disc gap-2 pl-5">
              <li>
                <strong className="text-[var(--color-text-primary)]">The test is conservative.</strong>{" "}
                2025-26 was among the seasons seen when {REFERENCE_MODEL_VERSION}&apos;s form was
                chosen, which favors {REFERENCE_MODEL_VERSION}. Two test seasons are still thin; the
                sealed record is the real test.
              </li>
              <li>
                <strong className="text-[var(--color-text-primary)]">The market stayed ahead.</strong>{" "}
                On the {injuryReported.market.games.toLocaleString("en-US")} test games with a stored
                ESPN spread (its timing unknown), the market scored{" "}
                {fixed(injuryReported.market.marketBrier ?? 0, 4)} against{" "}
                {fixed(injuryReported.market.injuryBrier ?? 0, 4)} for this model and{" "}
                {fixed(injuryReported.market.plainBrier ?? 0, 4)} for {REFERENCE_MODEL_VERSION}. No
                claim is made against the market.
              </li>
              <li>
                <strong className="text-[var(--color-text-primary)]">What it does not do.</strong> It
                does not simulate injuries that have not happened, redistribute minutes, account for
                matchups, or use plus-minus. Report names it cannot match to a box score, such as a
                rookie who has not played, count as zero, and it learns nothing about a game until
                that game&apos;s box score is stored.
              </li>
              <li>
                The live season odds read each player&apos;s current status from the latest report,
                which the test could only approximate from stored reports. The test used the same
                survival table, never return dates.
              </li>
            </ul>
          </Section>

          <Section id="track-record">
            <p>
              From 06:00 ET, once every earlier game is final, each game gets a morning seal. It uses
              only results through the previous day, so an afternoon result can never change an
              evening number. If an earlier game is still unresolved within six hours of tip, the
              forecast is sealed anyway and marked as sealed before that result was in. The first
              update in the hour before tip then writes a final seal from the same ratings with the
              latest NBA injury report. The final seal is the one scored; a game that tips with only
              its morning seal is scored on that and counted as &ldquo;no final seal&rdquo;, never as
              missed.
            </p>
            <p>
              {REFERENCE_MODEL_VERSION}, the model this one replaced, keeps writing its own morning
              seal for every game, so its record continues and stays on the{" "}
              <Link href="/#record-title" className="pp-link">
                games page
              </Link>{" "}
              beneath the current one. Each new seal also stores {REFERENCE_MODEL_VERSION}&apos;s
              number for the same game at the same moment, so the two are compared on identical
              games.
            </p>
            <p>
              Sealed forecasts are appended to a{" "}
              <a href={LEDGER_URL} className="pp-link">
                public ledger in Git
              </a>
              , and committed rows are never changed. A game that tips with no seal is recorded as
              missed and is never backfilled. If the scheduled job is running late, a game on
              today&apos;s slate shows a provisional number from the latest ratings; it is labeled
              as such, and it is never stored or scored. GitHub often starts scheduled jobs late, so
              season odds can take a few hours to reflect a final.
            </p>
            <p>
              The track record reports the Brier score (the average squared error of the forecasts;
              lower is better, and always saying 50% scores 0.250), the same score for always giving
              the home team the usual home win rate, and how often the favorite won. Missed seals,
              games with no final seal and seals made before a result was in are always shown. Until
              at least 500 games are scored, the record is labeled a small sample.
            </p>
          </Section>

          <Section id="in-game">
            <p>
              During a game, the Live number is an estimate from the current margin, the time left
              and the sealed expected margin, using a noise setting of {IN_GAME_SIGMA} points. Live
              scores reach only this estimate. They never change ratings or sealed forecasts.
            </p>
            <p>
              It passed checks at the end of the first, second and third quarters on 2025-26 games
              not used to fit it. Values between those points, and especially the final minutes, are
              interpolation and have not been validated. It ignores possession and fouls.
            </p>
          </Section>

          <Section id="season-odds">
            <p>
              Each run simulates the rest of the season{" "}
              20,000 times. Every simulated season
              draws team strengths from the rating uncertainty, so a team that is better than
              expected stays better through that season. The simulation then applies NBA
              tiebreakers, the play-in tournament and a best-of-seven bracket with home court by
              regular-season record.
            </p>
            <p>
              Players the model currently counts as out (listed Out or Doubtful on the latest
              report, or out of the team&apos;s last game and not listed as probable) cost their team
              points in each simulated game for as long as the survival table expects them to miss,
              playoff games included, and then return. Injuries that have not happened yet are not
              simulated: every team will have some, and they mostly cancel out.{" "}
              <Link href="/odds#absences-title" className="pp-link">
                Who is counted as out
              </Link>
              .
            </p>
            <p>
              The tiebreak code reproduced all 100 real seeds across 2021-22 to 2025-26. It leaves
              out the rules comparing records against playoff-eligible teams, which those seasons
              did not need. Games the league has not scheduled yet, such as NBA Cup knockout slots,
              are played against an average opponent on a neutral floor until the real game
              appears.
            </p>
            <p>
              Once the regular season ends, the pages switch on their own to the play-in and then
              the playoffs. Real results replace simulation as they happen: finished play-in games,
              the actual bracket and the current score of each series. Eliminated teams drop to
              zero, and each series shows the chance of the favorite winning it from its current
              score. This logic was replayed over the real 2021-22 to 2025-26 postseasons.
            </p>
          </Section>

          <Section id="market">
            <p>
              Each game shows the market&apos;s win probability beside the model&apos;s. It comes
              from the DraftKings line as published through ESPN&apos;s unofficial feed. Each
              side&apos;s line is converted to an implied probability, and the two are scaled to add
              up to 100%, which removes the bookmaker&apos;s margin (the vig). Before tip it is the
              latest line; once a game starts, it is the line captured when the forecast was sealed.
            </p>
            <p>
              The market number is for reference only. It is never a model input, it is not scored,
              and no claim is made about the model against the market until at least{" "}
              {MARKET_CLAIM_GAMES} games have been scored. This is not a betting product.
            </p>
          </Section>

          <Section id="testing">
            <p>
              The tables below are the original model&apos;s gates, before injuries; the injury
              test is under{" "}
              <a href="#injuries" className="pp-link">
                Injuries
              </a>
              . Gates were written down before any validation season was scored (
              <a href={REGISTRATION_URL} className="pp-link">
                registration
              </a>
              ). Every number below is walk-forward: each forecast uses only earlier games.
            </p>
            <div className="overflow-x-auto rounded-lg border border-[var(--color-border-subtle)]">
              <table className="pp-table">
                <caption className="sr-only">Regular-season game forecasts by model</caption>
                <thead>
                  <tr>
                    <th scope="col">Regular-season games</th>
                    <th scope="col" className="num">
                      2015-16 to 2021-22
                    </th>
                    <th scope="col" className="num">
                      2022-23 to 2025-26*
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">This model, Brier</th>
                    <td className="num">{fixed(gate.kalman.brier)}</td>
                    <td className="num">{fixed(separate.kalman.brier)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Elo with margin, Brier</th>
                    <td className="num">{fixed(gate.elo.brier)}</td>
                    <td className="num">{fixed(separate.elo.brier)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Season-to-date SRS, Brier</th>
                    <td className="num">{fixed(gate.srs.brier)}</td>
                    <td className="num">{fixed(separate.srs.brier)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Prior home-win rate, Brier</th>
                    <td className="num">{fixed(gate.homeRate.brier)}</td>
                    <td className="num">{fixed(separate.homeRate.brier)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Favorite won (this model)</th>
                    <td className="num">{(gate.kalman.accuracy * 100).toFixed(1)}%</td>
                    <td className="num">{(separate.kalman.accuracy * 100).toFixed(1)}%</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-sm leading-6 text-[var(--color-text-muted)]">
              Lower Brier is better. Against Elo, the difference on the first window is{" "}
              {fixed(gate.againstElo.difference, 4)} (95% interval{" "}
              {interval(gate.againstElo.lower, gate.againstElo.upper)}, season-clustered). *An early
              test on these seasons influenced the choice of model type, so they are reported
              separately. Only forecasts sealed from 2026-27 on are fully untouched.
            </p>

            <div className="overflow-x-auto rounded-lg border border-[var(--color-border-subtle)]">
              <table className="pp-table">
                <caption className="sr-only">Season simulator checks by date</caption>
                <thead>
                  <tr>
                    <th scope="col">Season simulator</th>
                    <th scope="col" className="num">
                      Playoff odds, Brier
                    </th>
                    <th scope="col" className="num">
                      Win-% baseline, Brier
                    </th>
                    <th scope="col" className="num">
                      Win total error
                    </th>
                    <th scope="col" className="num">
                      Current-pace error
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {checkpointRows.map(([label, row]) => (
                    <tr key={label}>
                      <th scope="row">{label}</th>
                      <td className="num">{fixed(row.makePlayoffsBrier)}</td>
                      <td className="num">
                        {row.baselineBrier === null ? "n/a" : fixed(row.baselineBrier)}
                      </td>
                      <td className="num">{fixed(row.winTotalRmse, 2)}</td>
                      <td className="num">
                        {row.extrapolationRmse === null ? "n/a" : fixed(row.extrapolationRmse, 2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm leading-6 text-[var(--color-text-muted)]">
              Seasons 2015-16 to 2018-19 and 2021-22; the two irregular pandemic seasons are
              excluded. Win total error is the root-mean-square miss on final wins, in games;
              current-pace error is the same measure for simply extending each team&apos;s win rate
              so far over the full season. The win-% baseline predicts playoff spots from the
              current win percentage alone.
            </p>
          </Section>

          <Section id="shortfalls">
            <ul className="grid list-disc gap-3 pl-5">
              <li>
                <strong className="text-[var(--color-text-primary)]">
                  Game forecasts are mildly overconfident.
                </strong>{" "}
                The calibration slope was {fixed(gate.calibrationSlope, 2)} against a target range of
                0.90 to 1.10, so a stated 80% has been closer to 77%. The one permitted fix changed
                nothing, and any further correction would have been tuned on the test seasons, so it
                ships as is with this disclosure.
              </li>
              <li>
                <strong className="text-[var(--color-text-primary)]">
                  Midseason playoff odds are not claimed to be well calibrated.
                </strong>{" "}
                They failed the registered reliability check at opening night, Dec 1 and Feb 1, in
                small samples. On 2022-23 to 2025-26 they also did not beat a simple win-percentage
                read on Dec 1 and Feb 1.
              </li>
              <li>
                <strong className="text-[var(--color-text-primary)]">
                  No skill is claimed for title odds.
                </strong>{" "}
                A handful of champions cannot measure it.
              </li>
              <li>
                <strong className="text-[var(--color-text-primary)]">
                  No playoff advantage over a simpler reference is claimed.
                </strong>{" "}
                Series Brier was {fixed(series.gateSeasons.kalmanBrier)} against{" "}
                {fixed(series.gateSeasons.srsHomeBrier)} for the SRS + home reference on{" "}
                {series.gateSeasons.n} series from 2015-16 to 2021-22, and that interval (
                {interval(series.gateSeasons.lower, series.gateSeasons.upper)}) crosses zero.
              </li>
              <li>
                <strong className="text-[var(--color-text-primary)]">
                  The market remained ahead in testing.
                </strong>{" "}
                On the test-season games with a stored ESPN spread, the market scored better than
                the model with injuries. No claim is made against the market.
              </li>
              <li>
                <strong className="text-[var(--color-text-primary)]">
                  Prospective results are the real test.
                </strong>{" "}
                Everything above is reconstructed after the fact. The sealed track record on the{" "}
                <Link href="/" className="pp-link">
                  games page
                </Link>{" "}
                is the only forecast record made in advance, and it needs at least 500 games to mean
                much.
              </li>
            </ul>
          </Section>
        </div>
      </div>
    </main>
  );
}
