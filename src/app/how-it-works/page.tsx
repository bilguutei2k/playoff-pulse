import type { Metadata } from "next";
import Link from "next/link";
import gameEvaluation from "../../../docs/live/evaluation-games.json";
import seasonEvaluation from "../../../docs/live/evaluation-season.json";
import { IN_GAME_SIGMA, LIVE_MODEL_VERSION, LIVE_PARAMS } from "@/lib/season/params";

export const metadata: Metadata = {
  title: "How the live forecast works | Playoff Pulse",
  description:
    "The rating model, the sealing rules, the market reference and the validation results behind the live NBA forecasts, including what failed.",
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

const SECTIONS = [
  { id: "terms", title: "What the numbers mean" },
  { id: "limits", title: "What it does not do" },
  { id: "game-forecasts", title: "Game forecasts" },
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
              Model {LIVE_MODEL_VERSION}
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
                Our chance of each team winning, from team ratings and home court. Probabilities
                are shown as whole percents, with &ldquo;&lt;1%&rdquo; and &ldquo;&gt;99%&rdquo; at
                the ends.
              </Term>
              <Term term="Sealed">
                A pregame forecast fixed before tip, written to a public ledger and scored once the
                game ends. Only sealed forecasts count in the track record.
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
                  It ignores injuries and rest decisions.
                </strong>{" "}
                Reported injuries are shown beside each game for context only, and a game with a star
                out can be mispriced.
              </li>
              <li>
                It cannot see off-season roster moves directly. Early in a season it leans on last
                season&apos;s results, shrunk toward average.
              </li>
              <li>It is not a betting product and makes no recommendations.</li>
              <li>
                Its data comes from ESPN&apos;s public feeds, which are unofficial and undocumented.
                There is no verified second source, and no official NBA data is used.
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
          </Section>

          <Section id="track-record">
            <p>
              From 06:00 ET, once every earlier game is final, each game gets a sealed forecast. It
              uses only results through the previous day, so an afternoon result can never change an
              evening number. If an earlier game is still unresolved within six hours of tip, the
              forecast is sealed anyway and marked as sealed before that result was in.
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
              the home team the usual home win rate, and how often the favorite won. Missed seals and
              seals made before a result was in are always shown. Until at least 500 games are
              scored, the record is labeled a small sample.
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
              Gates were written down before any validation season was scored (
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
