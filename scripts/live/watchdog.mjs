import { execFileSync } from "node:child_process";
import { decideWatchdog } from "./watchdog-decision.mjs";

// Only GITHUB_TOKEN is needed. The live job exercises this only in dry-run mode;
// production monitoring runs independently in live-watchdog.yml.
const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
const repo = process.env.GITHUB_REPOSITORY;
if (!repo) throw new Error("GITHUB_REPOSITORY is required");
const now = new Date().toISOString();
const dry = process.env.DRY_RUN === "1";
// Paginate active runs separately: an old queued/waiting run must not be hidden by
// a page full of newer completed runs. Fetch failures abort rather than guess idle.
const api = (query) => JSON.parse(gh("api", "--paginate", "--slurp",
  `repos/${repo}/actions/workflows/live-forecast.yml/runs?per_page=100${query}`))
  .flatMap((page) => page.workflow_runs);
const since = new Date(Date.parse(now) - 7 * 86400_000).toISOString();
const runs = api(`&created=>=${since}`);
for (const status of ["queued", "in_progress", "waiting", "pending", "requested"]) {
  runs.push(...api(`&status=${status}`));
}
const uniqueRuns = [...new Map(runs.map((run) => [run.id, run])).values()];
// A broken/missing publication must not prevent idle-chain recovery or other alerts.
const readProblems = [];
const attempt = (label, fn) => {
  try { return fn(); }
  catch { readProblems.push(`Cannot read published ${label}; check live-data.`); return null; }
};
const ref = attempt("commit", () => git("rev-parse", "origin/live-data"));
const read = (file) => {
  if (!ref) throw new Error("No data commit");
  return git("show", `${ref}:data/live/${file}`);
};
const state = attempt("state.json", () => JSON.parse(read("state.json")));
const games = state && attempt("games", () => JSON.parse(read(`games/${state.season}.json`)));
const ledger = state && attempt("ledger", () => read(`ledger/${state.seasonLabel}.jsonl`)
  .split("\n").filter(Boolean).map((line) => JSON.parse(line)));
const health = attempt("health.json", () => JSON.parse(read("health.json")));
const decision = decideWatchdog({ now, runs: uniqueRuns, state, games, ledger, health });
decision.alerts.push(...readProblems);
console.log(JSON.stringify({ now, dataCommit: ref, ...decision }, null, 2));
if (dry) {
  console.log("Dry run: no dispatch and no issue create/comment.");
} else {
  // Alert delivery must still be attempted if dispatch fails.
  let dispatchError;
  if (decision.dispatch) {
    try { gh("workflow", "run", "live-forecast.yml", "--ref", "main"); }
    catch (error) { dispatchError = error; }
  }
  if (decision.alerts.length) {
    const title = `Live watchdog on ${now.slice(0, 10)}`;
    const issues = JSON.parse(gh("api", "--paginate", "--slurp", `repos/${repo}/issues?state=all&per_page=100`)).flat();
    const existing = issues.find((issue) => !issue.pull_request && issue.title === title);
    const body = `Watchdog at ${now}; live-data ${ref}\n\n${decision.alerts.join("\n\n")}\n\nRun: https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}\n\nThis monitor shares GitHub Actions with the producer; issue creation does not verify notification delivery.`;
    if (existing) gh("issue", "comment", String(existing.number), "--body", body);
    else gh("issue", "create", "--title", title, "--body", body);
  }
  if (dispatchError) throw dispatchError;
}
