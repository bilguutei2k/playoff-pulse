// The live watchdog (.github/workflows/live-watchdog.yml): reads live-forecast's runs and
// live-data's published files, decides (scripts/live/watchdog-decision.mjs), restarts an
// idle chain and reports problems in one issue per UTC day, "Live watchdog on <date>",
// each condition once per issue. It also reads the site as a reader does (SITE_URL, default
// the production deployment; empty disables it): /api/live/health, then the routes
// probePlan picks for this run (`/` and one rotating route as HTML, both as RSC too in the
// run whose UTC minute is under 15; PROBE_ALL=1 reads every route in both forms), and
// reports what siteAlerts finds: the server behind the publication or on its stored copy,
// a page behind the server, served from a cache, without a stamp or failing. A second path
// on the same platform, not an external monitor; see watchdog-decision.mjs.
// tests/live-watchdog-runner.test.ts runs it against fake gh and git and a local fake site.
//
// Needs gh (with GH_TOKEN; only GITHUB_TOKEN's actions and issues permissions), git with
// origin/live-data fetched, and GITHUB_REPOSITORY. DRY_RUN=1 logs every decision and the
// issue text it would post, and dispatches nothing and writes no issue or comment (it
// still reads). A read that fails never stops the chain check or the other alerts; a
// failed dispatch never stops the alerts. Exits 1, after everything else, when it could
// not list runs, dispatch, or post, so GitHub reports the failed watchdog run; that never
// touches the live job.
import { execFileSync } from "node:child_process";
import { alertBody, decideWatchdog, probePlan, renderedStamp, reportedKeys, rscStamp, siteAlerts } from "./watchdog-decision.mjs";

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

// The site as a reader gets it. No cache-busting headers: the point is to see what the
// CDN serves. A page that cannot be fetched is a page-error alert, never a stop. Reads run
// a few at a time so PROBE_ALL (28 reads) stays well inside the job's timeout.
const SITE_URL = (process.env.SITE_URL ?? "https://548-sable.vercel.app").replace(/\/+$/, "");
const PROBE_ALL = process.env.PROBE_ALL === "1";
const FETCH_TIMEOUT_MS = 20_000;
const PARALLEL_READS = 4;
async function fetchPage(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { "user-agent": "548-live-watchdog", ...headers } });
    const age = response.headers.get("age");
    return {
      status: response.status,
      text: await response.text(),
      age: age === null || age.trim() === "" || !Number.isFinite(Number(age)) ? null : Number(age),
      cache: response.headers.get("x-vercel-cache"),
    };
  } finally {
    clearTimeout(timer);
  }
}
async function readPage({ path, kind }) {
  try {
    const page = await fetchPage(`${SITE_URL}${path}`, kind === "rsc" ? { RSC: "1" } : {});
    const stamp = page.status === 200 ? (kind === "rsc" ? rscStamp(page.text) : renderedStamp(page.text)) : null;
    return { path, kind, status: page.status, error: null, stamp, cache: page.cache, age: page.age };
  } catch (error) {
    const cause = error?.cause ? `: ${error.cause.code ?? error.cause.message ?? error.cause}` : "";
    return { path, kind, status: null, error: `${reason(error)}${cause}`, stamp: null, cache: null, age: null };
  }
}
async function probeSite(publication) {
  if (!SITE_URL) return { health: null, pages: [], alerts: [] };
  let health = null;
  let healthProblem = null;
  try {
    health = JSON.parse((await fetchPage(`${SITE_URL}/api/live/health`)).text);
    if (!health || typeof health !== "object") throw new Error("the answer is not a JSON object");
  } catch (error) {
    health = null;
    healthProblem = reason(error);
  }
  const plan = probePlan({ now, all: PROBE_ALL });
  const pages = new Array(plan.length);
  let next = 0;
  const worker = async () => {
    while (next < plan.length) {
      const index = next++;
      pages[index] = await readPage(plan[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_READS, plan.length) }, worker));
  return {
    health: health ? { generatedAt: health.generatedAt ?? null, status: health.status ?? null, delivery: health.delivery ?? null, data: health.data ?? null } : null,
    pages,
    alerts: siteAlerts({ health, healthProblem, publication, pages }),
  };
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

const site = await probeSite(state && typeof state.generatedAt === "string" ? state.generatedAt : null);
const decision = decideWatchdog({ now, workflowState, runs, state, games, ledger });
const alerts = [...decision.alerts, ...site.alerts, ...readProblems];
log(JSON.stringify({ now, dryRun: dry, workflowState, dataCommit, ...decision, site: { url: SITE_URL || null, probeAll: PROBE_ALL, health: site.health, pages: site.pages }, alerts }, null, 2));

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
