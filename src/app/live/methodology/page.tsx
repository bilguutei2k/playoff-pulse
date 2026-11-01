import type { Metadata } from "next";
import Link from "next/link";
import gameEvaluation from "../../../../docs/live/evaluation-games.json";
import seasonEvaluation from "../../../../docs/live/evaluation-season.json";
import { IN_GAME_SIGMA, LIVE_MODEL_VERSION, LIVE_PARAMS } from "@/lib/season/params";

export const metadata: Metadata = {
  title: "How the live forecast works | Playoff Pulse",
  description:
    "The rating model, the sealing rules and validation results behind the live NBA forecasts, including what failed.",
};

function fixed(value: number, digits = 3): string {
  return value.toFixed(digits);
}

function interval(lower: number, upper: number): string {
  return `${lower >= 0 ? "+" : ""}${lower.toFixed(4)} to ${upper >= 0 ? "+" : ""}${upper.toFixed(4)}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="pp-card">
      <div className="pp-section-head">
        <h2 className="text-sm font-bold text-[var(--color-text-primary)]">{title}</h2>
      </div>
      <div className="grid gap-3 p-4 text-sm leading-6 text-[var(--color-text-secondary)]">
        {children}
      </div>
    </section>
  );
}

export default function LiveMethodologyPage() {
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
    <main className="min-h-screen bg-[var(--color-bg-primary)]">
      <div className="mx-auto flex max-w-4xl flex-col gap-4 px-3 py-4 md:px-[18px] md:py-6">
        <header>
          <div className="pp-kicker">Model {LIVE_MODEL_VERSION}</div>
          <h1 className="mt-2 text-2xl font-bold text-[var(--color-text-primary)]">
            How the live forecast works
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
            What the numbers on the{" "}
            <Link href="/live" className="underline decoration-2 underline-offset-2">
              live page
            </Link>{" "}
            mean, how they were tested, and where they fall short. This forecast replaced nothing in
            the archived 2026 retrospective, which stays as it was.
          </p>
        </header>

        <Section title="What it does not do">
          <ul className="grid list-disc gap-1 pl-5">
            <li>
              <strong>It ignores injuries and rest decisions.</strong> Reported injuries are shown
              beside each game for context only, and a game with a star out can be mispriced.
            </li>
            <li>
              It cannot see off-season roster moves directly. Early in a season it leans on last
              season&apos;s results, shrunk toward average.
            </li>
            <li>It is not a betting product and makes no recommendations.</li>
            <li>
              Its data comes from ESPN&apos;s public feeds, which are unofficial and undocumented.
              There is no verified second source.
            </li>
          </ul>
        </Section>

        <Section title="Game forecasts">
          <p>
            Each team has a rating in points, kept up to date by a Kalman filter over every final
            score since 2004-05. The filter also tracks its uncertainty about each team and a slowly
            moving home-court advantage. The expected margin is the rating difference, plus home
            court, adjusted {LIVE_PARAMS.b2b} points against a team on the second night of a
            back-to-back.
          </p>
          <p>
            Rating uncertainty is added to the game&apos;s own randomness when converting that margin
            into a chance of winning, so forecasts are pulled toward even when the model knows less.
            Blowouts count only up to {LIVE_PARAMS.marginCap} points. Parameters were fitted on
            seasons 2005-2015 only, then frozen.
          </p>
        </Section>

        <Section title="Sealing and the public record">
          <p>
            From 06:00 ET, once every earlier game is final, each game gets a sealed forecast. It uses
            only results through the previous day, so an afternoon result can never change an evening
            number. If an earlier game is still unresolved within six hours of tip, the forecast is
            sealed anyway and marked as having incomplete inputs.
          </p>
          <p>
            Sealed forecasts are appended to a{" "}
            <a
              href="https://github.com/bilguutei2k/playoff-pulse/tree/main/data/live/ledger"
              className="underline decoration-2 underline-offset-2"
            >
              public ledger in Git
            </a>
            , and committed rows are never changed. A game that tips with no seal is recorded as
            missed and is never backfilled. If the scheduled job is running late, a game on today&apos;s
            slate shows a <em>provisional</em> number from the latest ratings. It is labeled as such,
            and it is never stored or scored. GitHub often runs scheduled jobs hours late, so season
            odds typically update within a few hours of a final.
          </p>
        </Section>

        <Section title="In-game estimates">
          <p>
            During a game, the bar shows an estimate from the current margin, the time left and the
            sealed expected margin, using a noise setting of {IN_GAME_SIGMA} points. Live scores reach
            only this estimate. They never change ratings or sealed forecasts.
          </p>
          <p>
            It passed checks at the end of the first, second and third quarters on 2025-26 games not
            used to fit it. Values between those points, and especially the final minutes, are
            interpolation and have not been validated. It ignores possession and fouls.
          </p>
        </Section>

        <Section title="Season, playoff and title odds">
          <p>
            Each run simulates the rest of the season {" "}
            20,000 times. Every simulated season draws team strengths from the rating uncertainty, so
            a team that is better than expected stays better through that season. The simulation then
            applies NBA tiebreakers, the play-in tournament and a best-of-seven bracket with home court
            by regular-season record.
          </p>
          <p>
            The tiebreak code reproduced all 100 real seeds across 2021-22 to 2025-26. It leaves out
            the rules comparing records against playoff-eligible teams, which those seasons did not
            need. Games the league has not scheduled yet, such as NBA Cup knockout slots, are played
            against an average opponent on a neutral floor until the real game appears.
          </p>
          <p>
            Once the regular season ends, the page switches on its own to the play-in and then the
            playoffs. Real results replace simulation as they happen: finished play-in games, the
            actual bracket and the current score of each series. Eliminated teams drop to zero, and
            each series shows the chance of the favorite winning it from its current score. This logic
            was replayed over the real 2021-22 to 2025-26 postseasons.
          </p>
        </Section>

        <Section title="How it tested">
          <p>
            Gates were written down before any validation season was scored (
            <a
              href="https://github.com/bilguutei2k/playoff-pulse/blob/main/docs/live/registration.md"
              className="underline decoration-2 underline-offset-2"
            >
              registration
            </a>
            ). Every number below is walk-forward: each forecast uses only earlier games.
          </p>
          <div className="overflow-x-auto">
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
                  <th scope="row">Elo with margin</th>
                  <td className="num">{fixed(gate.elo.brier)}</td>
                  <td className="num">{fixed(separate.elo.brier)}</td>
                </tr>
                <tr>
                  <th scope="row">Season-to-date SRS</th>
                  <td className="num">{fixed(gate.srs.brier)}</td>
                  <td className="num">{fixed(separate.srs.brier)}</td>
                </tr>
                <tr>
                  <th scope="row">Prior home-win rate</th>
                  <td className="num">{fixed(gate.homeRate.brier)}</td>
                  <td className="num">{fixed(separate.homeRate.brier)}</td>
                </tr>
                <tr>
                  <th scope="row">Favorite won</th>
                  <td className="num">{(gate.kalman.accuracy * 100).toFixed(1)}%</td>
                  <td className="num">{(separate.kalman.accuracy * 100).toFixed(1)}%</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs leading-5 text-[var(--color-text-muted)]">
            Lower Brier is better. Against Elo, the difference on the first window is{" "}
            {fixed(gate.againstElo.difference, 4)} (95% interval{" "}
            {interval(gate.againstElo.lower, gate.againstElo.upper)}, season-clustered). *An early test
            on these seasons influenced the choice of model type, so they are reported separately. Only
            forecasts sealed from 2026-27 on are fully untouched.
          </p>

          <div className="overflow-x-auto">
            <table className="pp-table">
              <caption className="sr-only">Season-level checks by date</caption>
              <thead>
                <tr>
                  <th scope="col">Season simulator</th>
                  <th scope="col" className="num">
                    Playoff odds, Brier
                  </th>
                  <th scope="col" className="num">
                    Win-% baseline
                  </th>
                  <th scope="col" className="num">
                    Win total error
                  </th>
                  <th scope="col" className="num">
                    Extrapolation
                  </th>
                </tr>
              </thead>
              <tbody>
                {checkpointRows.map(([label, row]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td className="num">{fixed(row.makePlayoffsBrier)}</td>
                    <td className="num">{row.baselineBrier === null ? "n/a" : fixed(row.baselineBrier)}</td>
                    <td className="num">{fixed(row.winTotalRmse, 2)}</td>
                    <td className="num">
                      {row.extrapolationRmse === null ? "n/a" : fixed(row.extrapolationRmse, 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs leading-5 text-[var(--color-text-muted)]">
            Seasons 2015-16 to 2018-19 and 2021-22. The two irregular pandemic seasons are excluded.
          </p>
        </Section>

        <Section title="Where it fell short">
          <ul className="grid list-disc gap-2 pl-5">
            <li>
              <strong>Game forecasts are mildly overconfident.</strong> The calibration slope was{" "}
              {fixed(gate.calibrationSlope, 2)} against a target range of 0.90 to 1.10, so a stated 80%
              has been closer to 77%. The one permitted fix changed nothing, and any further correction
              would have been tuned on the test seasons, so it ships as is with this disclosure.
            </li>
            <li>
              <strong>Midseason playoff odds are not claimed to be well calibrated.</strong> They failed
              the registered reliability check at opening night, Dec 1 and Feb 1, in small samples. On
              2022-23 to 2025-26 they also did not beat a simple win-percentage read on Dec 1 and Feb 1.
            </li>
            <li>
              <strong>No skill is claimed for title odds.</strong> A handful of champions cannot measure
              it.
            </li>
            <li>
              <strong>No playoff edge is claimed.</strong> Series Brier was {fixed(series.gateSeasons.kalmanBrier)}{" "}
              against {fixed(series.gateSeasons.srsHomeBrier)} for the SRS + home reference on{" "}
              {series.gateSeasons.n} series from 2015-16 to 2021-22, and that interval (
              {interval(series.gateSeasons.lower, series.gateSeasons.upper)}) crosses zero.
            </li>
            <li>
              <strong>Prospective results are the real test.</strong> Everything above is reconstructed
              after the fact. The sealed record on the live page is the only forecast record made in
              advance, and it needs at least 500 games to mean much.
            </li>
          </ul>
        </Section>
      </div>
    </main>
  );
}
