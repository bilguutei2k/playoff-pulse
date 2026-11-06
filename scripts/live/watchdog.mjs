// The live watchdog (.github/workflows/live-watchdog.yml): reads live-forecast's runs and
// live-data's published files, decides (scripts/live/watchdog-decision.mjs), restarts an
// idle chain and reports problems in one issue per UTC day, "Live watchdog on <date>",
// each condition once per issue. A second path on the same platform, not an external
// monitor; see watchdog-decision.mjs. tests/live-watchdog-runner.test.ts runs it against
// fake gh and git.
//
// Needs gh (with GH_TOKEN; only GITHUB_TOKEN's actions and issues permissions), git with
// origin/live-data fetched, and GITHUB_REPOSITORY. DRY_RUN=1 logs every decision and the
// issue text it would post, and dispatches nothing and writes no issue or comment (it
// still reads). A read that fails never stops the chain check or the other alerts; a
// failed dispatch never stops the alerts. Exits 1, after everything else, when it could
// not list runs, dispatch, or post, so GitHub reports the failed watchdog run; that never
// touches the live job.
import { execFileSync } from "node:child_process";
import { alertBody, decideWatchdog, reportedKeys } from "./watchdog-decision.mjs";

const repo = process.env.GITHUB_REPOSITORY;
if (!repo) throw new Error("GITHUB_REPOSITORY is required");
const dry = process.env.DRY_RUN === "1";
const runUrl = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : null;
const now = new Date().toISOString();
const log = (message) => console.log(message);
const run = (command, args) => execFileSync(command, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trim();
const gh = (...args) => run("gh", args);
const git = (...args) => run("git", args);
const reason = (error) => (error?.stderr?.toString().trim() || error?.message || String(error)).split("\n")[0];

const problems = [];
const readProblems = [];
function attempt(label, read) {
  try {
    return read();
  } catch (error) {
    readProblems.push({ key: `unreadable-${label}`, text: `Could not read ${label}: ${reason(error)}` });
    return null;
  }
}

// live-forecast's state and runs. Non-completed runs are listed by status as well, so an
// old queued run is not hidden behind a day of completed ones.
const workflowState = attempt("live-forecast-state", () => gh("api", `repos/${repo}/actions/workflows/live-forecast.yml`, "--jq", ".state"));
let runs = null;
try {
  const list = (query) =>
    JSON.parse(gh("api", "--paginate", "--slurp", `repos/${repo}/actions/workflows/live-forecast.yml/runs?per_page=100&${query}`))
      .flatMap((page) => page.workflow_runs ?? []);
  const since = new Date(Date.parse(now) - 24 * 3_600_000).toISOString();
  const found = list(`created=${encodeURIComponent(`>=${since}`)}`);
  for (const status of ["queued", "in_progress", "waiting", "pending", "requested"]) found.push(...list(`status=${status}`));
  runs = [...new Map(found.map((entry) => [entry.id, entry])).values()];
} catch (error) {
  problems.push(`could not list live-forecast runs: ${reason(error)}`);
}

// live-data's published files, at the commit the workflow fetched.
const dataCommit = attempt("live-data", () => git("rev-parse", "--verify", "origin/live-data^{commit}"));
const show = (file) => git("show", `${dataCommit}:data/live/${file}`);
const state = dataCommit ? attempt("state.json", () => JSON.parse(show("state.json"))) : null;
const games = state ? attempt("games", () => JSON.parse(show(`games/${state.season}.json`))) : null;
const ledger = state
  ? attempt("ledger", () => show(`ledger/${state.seasonLabel}.jsonl`).split("\n").filter(Boolean).map((line) => JSON.parse(line)))
  : null;

const decision = decideWatchdog({ now, workflowState, runs, state, games, ledger });
const alerts = [...decision.alerts, ...readProblems];
log(JSON.stringify({ now, dryRun: dry, workflowState, dataCommit, ...decision, alerts }, null, 2));

if (decision.paused) {
  log("live-forecast.yml is disabled by hand (how the chain is stopped): no dispatch and no alerts.");
} else {
  if (decision.dispatch) {
    if (dry) {
      log("Dry run: would dispatch live-forecast.yml on main.");
    } else {
      try {
        gh("workflow", "run", "live-forecast.yml", "--ref", "main");
        log("Dispatched live-forecast.yml on main.");
      } catch (error) {
        const text = `Could not dispatch live-forecast.yml: ${reason(error)}`;
        alerts.push({ key: "dispatch-failed", text });
        problems.push(text);
      }
    }
  }
  if (alerts.length === 0) {
    log("No alerts.");
  } else {
    const title = `Live watchdog on ${now.slice(0, 10)}`;
    try {
      const issue = JSON.parse(gh("issue", "list", "--state", "all", "--search", `"${title}" in:title`, "--json", "number,title", "--limit", "20"))
        .find((entry) => entry.title === title);
      const posted = issue
        ? reportedKeys([
            gh("api", `repos/${repo}/issues/${issue.number}`, "--jq", ".body"),
            ...JSON.parse(gh("api", "--paginate", "--slurp", `repos/${repo}/issues/${issue.number}/comments?per_page=100`))
              .flat()
              .map((comment) => comment.body),
          ])
        : new Set();
      const fresh = alerts.filter((alert) => !posted.has(alert.key));
      if (fresh.length === 0) {
        log(`Already reported in #${issue.number}: ${alerts.map((alert) => alert.key).join(", ")}`);
      } else {
        const body = alertBody({ now, dataCommit, runUrl, alerts: fresh });
        const where = issue ? `comment on #${issue.number}` : `open "${title}"`;
        if (dry) {
          log(`Dry run: would ${where}:\n${body}`);
        } else {
          if (issue) gh("issue", "comment", String(issue.number), "--body", body);
          else gh("issue", "create", "--title", title, "--body", body);
          log(`Reported (${where}): ${fresh.map((alert) => alert.key).join(", ")}`);
        }
      }
    } catch (error) {
      problems.push(`could not report to the daily issue: ${reason(error)}`);
    }
  }
}

if (dry) log("Dry run: no dispatch and no issue create/comment.");
if (problems.length > 0) {
  for (const problem of problems) console.error(`[watchdog] ${problem}`);
  process.exit(1);
}
