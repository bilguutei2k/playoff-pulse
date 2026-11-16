// The live watchdog's side effects (scripts/live/watchdog.mjs) against fake gh and git and
// a local fake site: no network and no repository. Every gh call is logged, so the tests
// see exactly what it would dispatch, open or comment.
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error a plain Node module with no types, run by the watchdog workflow without a build
import { probePlan } from "../scripts/live/watchdog-decision.mjs";
import { removeTempDirs, REPO_ROOT, runAsync, tempDir } from "./support/shell";

// The fake site: /api/live/health and any page, as HTML or, with `RSC: 1`, as an RSC
// payload, each answering from this mutable fixture. Every request is recorded.
type Kind = "html" | "rsc";
type FakePage = { status: number; stamp: string | null; delivery?: string; age: string | null; cache: string | null; body?: string };
type FakeHealth = { status?: number; body: unknown };
const site: { health: () => FakeHealth; page: (path: string, kind: Kind) => FakePage } = {
  health: () => ({
    body: { status: "ok", generatedAt: new Date().toISOString(), delivery: "current", data: { source: "network", commit: "c1", head: "c1", problem: null } },
  }),
  page: () => ({ status: 200, stamp: new Date().toISOString(), age: "0", cache: "MISS" }),
};
const freshSite = { health: site.health, page: site.page };
const requests: Array<{ path: string; rsc: string | null }> = [];
const html = (stamp: string, delivery: string) =>
  `<html><body><p><time dateTime="${stamp}" data-state-stamp="" data-state-delivery="${delivery}">Updated</time></p></body></html>`;
const rsc = (stamp: string, delivery: string) =>
  `0:{"P":null,"b":"build"}\n4:["$","$L5",null,{"generatedAt":"${stamp}","delivery":"${delivery}"}]\n9:["$","$La",null,{"generatedAt":"${stamp}"}]\n`;
let server: http.Server;
let siteUrl = "";
beforeAll(async () => {
  server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://fake.test");
    const rscHeader = request.headers.rsc;
    requests.push({ path: url.pathname, rsc: typeof rscHeader === "string" ? rscHeader : null });
    if (url.pathname === "/api/live/health") {
      const health = site.health();
      response.statusCode = health.status ?? 200;
      response.setHeader("content-type", "application/json");
      response.end(typeof health.body === "string" ? health.body : JSON.stringify(health.body));
      return;
    }
    const kind: Kind = rscHeader === "1" ? "rsc" : "html";
    const page = site.page(url.pathname, kind);
    response.statusCode = page.status;
    if (page.age !== null) response.setHeader("age", page.age);
    if (page.cache !== null) response.setHeader("x-vercel-cache", page.cache);
    response.setHeader("content-type", kind === "rsc" ? "text/x-component" : "text/html");
    const delivery = page.delivery ?? "current";
    response.end(
      page.body ??
        (page.stamp === null ? (kind === "rsc" ? '0:{"b":"build"}\n' : "<html><body><p>no chip</p></body></html>") : kind === "rsc" ? rsc(page.stamp, delivery) : html(page.stamp, delivery)),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  siteUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(() => {
  Object.assign(site, freshSite);
  requests.length = 0;
});
afterAll(() => {
  server.close();
  removeTempDirs();
});

const FAKE_GH = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALL_LOG, JSON.stringify(args) + "\\n");
const env = (name, fallback) => process.env[name] ?? fallback;
const fail = (what) => { console.error("fake gh: " + what + " failing on purpose"); process.exit(1); };
const path = args.find((arg) => arg.startsWith("repos/")) ?? "";
const flag = (name) => args[args.indexOf(name) + 1];
if (args[0] === "workflow") { if (env("FAIL_DISPATCH") === "1") fail("dispatch"); process.exit(0); }
if (args[0] === "issue" && args[1] === "list") {
  if (env("FAIL_ISSUES") === "1") fail("issue list");
  console.log(flag("--state") === "closed" ? env("CLOSED_ISSUES", "[]") : env("OPEN_ISSUES", "[]"));
  process.exit(0);
}
if (args[0] === "issue") { if (env("FAIL_POST") === "1") fail("post"); process.exit(0); }
if (path.endsWith("/actions/workflows/live-forecast.yml")) { console.log(env("WORKFLOW_STATE", "active")); process.exit(0); }
if (path.includes("/runs?")) {
  if (env("FAIL_RUNS") === "1") fail("runs");
  console.log(JSON.stringify([{ workflow_runs: path.includes("created=") ? JSON.parse(env("RUNS", "[]")) : [] }]));
  process.exit(0);
}
if (path.includes("/comments")) { console.log(JSON.stringify([JSON.parse(env("COMMENTS", "[]")).map((body) => ({ body }))])); process.exit(0); }
fail("unhandled call " + args.join(" "));
`;

const FAKE_GIT = `#!/usr/bin/env node
const args = process.argv.slice(2);
const target = args[1] ?? "";
if (process.env.FAILED_READ && target.endsWith(process.env.FAILED_READ)) process.exit(128);
if (args[0] === "rev-parse") { console.log("c".repeat(40)); process.exit(0); }
if (target.endsWith("state.json")) console.log(process.env.STATE);
else if (target.includes("/games/")) console.log(process.env.GAMES ?? "[]");
else if (target.includes("/ledger/")) console.log(process.env.LEDGER ?? "");
else process.exit(128);
`;

interface Options {
  dry?: boolean;
  env?: Record<string, string>;
}

/** The test's clock is real, so fixtures are built relative to now. */
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const FRESH = JSON.stringify({ season: 2027, seasonLabel: "2026-27", generatedAt: minutesAgo(5) });
const STALE = JSON.stringify({ season: 2027, seasonLabel: "2026-27", generatedAt: "2026-11-01T00:00:00.000Z" });
const busy = JSON.stringify([{ id: 9, created_at: minutesAgo(3), status: "in_progress", conclusion: null, display_title: "Live forecast" }]);

// The watchdog is run without blocking, so the fake site in this process can answer it.
async function watchdog({ dry = false, env = {} }: Options = {}) {
  const dir = tempDir("pp-watchdog-");
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "gh"), FAKE_GH, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "git"), FAKE_GIT, { mode: 0o755 });
  const log = path.join(dir, "calls.jsonl");
  fs.writeFileSync(log, "");
  const result = await runAsync("node", [path.join(REPO_ROOT, "scripts/live/watchdog.mjs")], dir, {
    PATH: `${bin}:${process.env.PATH}`,
    CALL_LOG: log,
    GITHUB_REPOSITORY: "example/repo",
    GITHUB_RUN_ID: "123",
    DRY_RUN: dry ? "1" : "0",
    STATE: STALE,
    SITE_URL: siteUrl,
    ...env,
  });
  const calls = fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
  const writes = calls.filter((args) => args[0] === "workflow" || (args[0] === "issue" && args[1] !== "list"));
  const posted = writes.find((args) => args[0] === "issue")?.find((_, index, all) => all[index - 1] === "--body" || all[index - 1] === "--comment") ?? "";
  const logged = JSON.parse(result.stdout.slice(result.stdout.indexOf("{"), result.stdout.indexOf("\n}") + 2)) as {
    now: string;
    incident: { number: number; open: string[] } | null;
    alerts: Array<{ key: string; kind: string }>;
    site: { url: string | null; probeAll: boolean; health: unknown; pages: Array<{ path: string; kind: Kind; status: number | null; stamp: unknown; cache: string | null }> };
  };
  // The keys this run raised, as logged before any dispatch failure is added.
  const keys = logged.alerts.map((alert) => alert.key);
  return { ...result, calls, writes, posted, keys, logged };
}

// Each test starts node, which starts gh and git several times and reads the fake site;
// on a loaded runner that is well over vitest's five-second default.
const SLOW = { timeout: 60_000 };

const MARKER = "<!-- live-watchdog-incident -->";
const openIssue = (number: number, open: string[], title = "Live watchdog incident from 2026-11-15 10:03 UTC") =>
  JSON.stringify([{ number, title, url: `https://github.com/example/repo/issues/${number}`, body: `first\n${MARKER}\n<!-- live-watchdog-open: ${open.join(" ")} -->` }]);
const STALE_KEY = "stale-2026-11-01T00:00:00.000Z";
const minuteTitle = (now: string) => `Live watchdog incident from ${now.slice(0, 10)} ${now.slice(11, 16)} UTC`;

describe("watchdog side effects", SLOW, () => {
  it("dry run logs the dispatch and the incident it would open, and writes nothing", async () => {
    const result = await watchdog({ dry: true });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('"dispatch": true');
    expect(result.stdout).toContain("Dry run: would dispatch live-forecast.yml on main.");
    expect(result.stdout).toContain(`Dry run: would open "${minuteTitle(result.logged.now)}"`);
    expect(result.stdout).toContain("Dry run: no dispatch and no issue create, comment or close.");
    expect(result.writes).toEqual([]);
  });

  it("restarts an idle chain and opens an incident with the states open and the restart as an event", async () => {
    const result = await watchdog();
    expect(result.status, result.stderr).toBe(0);
    expect(result.writes[0]).toEqual(["workflow", "run", "live-forecast.yml", "--ref", "main"]);
    expect(result.writes[1].slice(0, 4)).toEqual(["issue", "create", "--title", minuteTitle(result.logged.now)]);
    expect(result.posted).toContain("Events:\n- No real live-forecast run");
    expect(result.posted).toContain("https://github.com/example/repo/actions/runs/123");
    expect(result.posted).toContain(MARKER);
    expect(result.posted).toMatch(new RegExp(`<!-- live-watchdog-open: ${STALE_KEY} -->$`));
    expect(result.posted).not.toContain("previous incident");
  });

  it("links the newest closed incident when a condition recurs", async () => {
    const closed = JSON.stringify([
      { number: 40, title: "Live watchdog incident from 2026-11-14 08:03 UTC", body: MARKER, closedAt: "2026-11-14T09:03:00Z" },
      { number: 44, title: "Live watchdog incident from 2026-11-14 12:03 UTC", body: MARKER, closedAt: "2026-11-14T13:03:00Z" },
      { number: 50, title: "Live watchdog incident from 2026-11-14 18:03 UTC", body: "no marker: not an incident" },
    ]);
    const result = await watchdog({ env: { RUNS: busy, CLOSED_ISSUES: closed } });
    expect(result.status, result.stderr).toBe(0);
    expect(result.writes.map((args) => args.slice(0, 2))).toEqual([["issue", "create"]]);
    expect(result.posted).toContain("The previous incident was #44, closed 2026-11-14T13:03:00Z.");
  });

  it("does nothing on a healthy, busy chain with no incident", async () => {
    const result = await watchdog({ env: { RUNS: busy, STATE: FRESH } });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("No alerts.");
    expect(result.writes).toEqual([]);
  });

  it("leaves an open incident alone while its condition still fires, and comments only on a new one", async () => {
    const quiet = await watchdog({ env: { RUNS: busy, OPEN_ISSUES: openIssue(42, [STALE_KEY]) } });
    expect(quiet.status, quiet.stderr).toBe(0);
    expect(quiet.logged.incident).toEqual({ number: 42, url: "https://github.com/example/repo/issues/42", open: [STALE_KEY] });
    expect(quiet.stdout).toContain(`Incident #42 unchanged; open: ${STALE_KEY}.`);
    expect(quiet.writes).toEqual([]);

    // A restart is an event: reported on the open incident, never added to its open keys.
    const restarted = await watchdog({ env: { OPEN_ISSUES: openIssue(42, [STALE_KEY]) } });
    expect(restarted.writes.map((args) => args.slice(0, 3))).toEqual([["workflow", "run", "live-forecast.yml"], ["issue", "comment", "42"]]);
    expect(restarted.posted).toContain("Events:");
    expect(restarted.posted).not.toContain("live-watchdog-open");
  });

  it("closes the incident on a run that finds its condition clear and raises nothing", async () => {
    const result = await watchdog({ env: { RUNS: busy, STATE: FRESH, OPEN_ISSUES: openIssue(42, [STALE_KEY]), COMMENTS: JSON.stringify(["later"]) } });
    expect(result.status, result.stderr).toBe(0);
    expect(result.writes.map((args) => args.slice(0, 4))).toEqual([["issue", "close", "42", "--comment"]]);
    expect(result.posted).toContain(`recovered: ${STALE_KEY}`);
    expect(result.posted).toContain("the incident is closed");
    expect(result.posted).toMatch(new RegExp(`<!-- live-watchdog-resolved: ${STALE_KEY} -->$`));
  });

  it("closes an incident of events only on the next clean run", async () => {
    const result = await watchdog({ env: { RUNS: busy, STATE: FRESH, OPEN_ISSUES: openIssue(43, []) } });
    expect(result.status, result.stderr).toBe(0);
    expect(result.writes.map((args) => args.slice(0, 3))).toEqual([["issue", "close", "43"]]);
  });

  it("keeps an incident open while a read it needs fails, and reports the read problem", async () => {
    const result = await watchdog({ env: { RUNS: busy, OPEN_ISSUES: openIssue(42, [STALE_KEY]), FAILED_READ: "state.json" } });
    expect(result.status, result.stderr).toBe(0);
    // The stale state was not checked, so it is not recovered; the read problem is new.
    expect(result.writes.map((args) => args.slice(0, 3))).toEqual([["issue", "comment", "42"]]);
    expect(result.posted).toContain("Could not read state.json");
    expect(result.posted).not.toContain("recovered");
    expect(result.posted).toMatch(/<!-- live-watchdog-open: unreadable-state.json -->$/);
  });

  it("rereads the route an open page condition names, even off the rotation, and closes once it is clear", async () => {
    const result = await watchdog({ env: { RUNS: busy, STATE: FRESH, OPEN_ISSUES: openIssue(42, ["page-behind-/lab-rsc"]) } });
    expect(result.status, result.stderr).toBe(0);
    expect(requests).toContainEqual({ path: "/lab", rsc: "1" });
    expect(result.writes.map((args) => args.slice(0, 3))).toEqual([["issue", "close", "42"]]);
    expect(result.posted).toContain("recovered: page-behind-/lab-rsc");
  });

  it("retires a condition on a day page no longer probed", async () => {
    const result = await watchdog({ env: { RUNS: busy, STATE: FRESH, OPEN_ISSUES: openIssue(42, ["page-cached-/games/2026-01-01-html"]) } });
    expect(result.status, result.stderr).toBe(0);
    expect(requests.some((request) => request.path === "/games/2026-01-01")).toBe(false);
    expect(result.writes.map((args) => args.slice(0, 3))).toEqual([["issue", "close", "42"]]);
    expect(result.posted).toContain("No longer watched");
  });

  it.each(["state.json", "2027.json", "2026-27.jsonl"])("still restarts and alerts when %s is unreadable", async (file) => {
    const result = await watchdog({ env: { FAILED_READ: file } });
    expect(result.status, result.stderr).toBe(0);
    expect(result.writes[0]).toEqual(["workflow", "run", "live-forecast.yml", "--ref", "main"]);
    expect(result.posted).toContain("Could not read");
  });

  it("still reports when the dispatch fails, then fails the watchdog run", async () => {
    const result = await watchdog({ env: { FAIL_DISPATCH: "1" } });
    expect(result.status).toBe(1);
    expect(result.posted).toContain("Could not dispatch live-forecast.yml");
    expect(result.posted).toContain("Events:");
  });

  it("neither dispatches nor guesses when runs cannot be listed, reports it and fails", async () => {
    const result = await watchdog({ env: { FAIL_RUNS: "1" } });
    expect(result.status).toBe(1);
    expect(result.writes.some((args) => args[0] === "workflow")).toBe(false);
    expect(result.posted).toContain("runs-unreadable");
  });

  it("opens, comments on or closes nothing when it cannot read the open incident, and fails", async () => {
    const result = await watchdog({ env: { FAIL_ISSUES: "1" } });
    expect(result.status).toBe(1);
    expect(result.writes).toEqual([["workflow", "run", "live-forecast.yml", "--ref", "main"]]);
    expect(result.stderr).toContain("could not read the open incident");
  });

  it("fails the run when it cannot write the incident", async () => {
    const result = await watchdog({ env: { FAIL_POST: "1" } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("could not create the incident");
  });

  it("stays idle and silent while live-forecast is disabled by hand, leaving an open incident as it is", async () => {
    const result = await watchdog({ env: { WORKFLOW_STATE: "disabled_manually", OPEN_ISSUES: openIssue(42, [STALE_KEY]) } });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("disabled by hand");
    expect(result.writes).toEqual([]);
  });
});

describe("served pages", SLOW, () => {
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
  const healthy = { RUNS: busy, STATE: FRESH };
  const read = (pages: Array<{ path: string; kind: string }>) => pages.map(({ path, kind }) => `${kind} ${path}`);

  it("reads health and this run's planned routes, and stays quiet when every copy matches the server", async () => {
    const result = await watchdog({ env: healthy });
    expect(result.status, result.stderr).toBe(0);
    expect(result.logged.site.url).toBe(siteUrl);
    expect(result.logged.site.probeAll).toBe(false);
    const plan = probePlan({ now: result.logged.now }) as Array<{ path: string; kind: string }>;
    expect(read(result.logged.site.pages)).toEqual(read(plan));
    expect(read(result.logged.site.pages)[0]).toBe("html /");
    expect(result.logged.site.pages.every((page) => page.status === 200 && page.stamp !== null)).toBe(true);
    expect(requests.filter((request) => request.path !== "/api/live/health")).toHaveLength(plan.length);
    expect(result.stdout).toContain("No alerts.");
    expect(result.writes).toEqual([]);
  });

  it("with PROBE_ALL reads every route as HTML and with `RSC: 1`, and stays quiet on a matching site", async () => {
    const result = await watchdog({ env: { ...healthy, PROBE_ALL: "1" } });
    expect(result.status, result.stderr).toBe(0);
    expect(result.logged.site.probeAll).toBe(true);
    const pages = result.logged.site.pages;
    expect(pages).toHaveLength(28);
    expect(new Set(pages.map((page) => page.path))).toEqual(new Set(["/", "/odds", "/injuries", "/players", "/teams", "/record", "/how-it-works", "/about", "/retrospective", "/snapshot", "/evidence", "/methodology", "/lab", expect.stringMatching(/^\/games\/\d{4}-\d{2}-\d{2}$/)]));
    expect(pages.filter((page) => page.kind === "rsc")).toHaveLength(14);
    const served = requests.filter((request) => request.path !== "/api/live/health");
    expect(served.filter((request) => request.rsc === "1")).toHaveLength(14);
    expect(served.filter((request) => request.rsc === null)).toHaveLength(14);
    expect(result.stdout).toContain("No alerts.");
  });

  it("reports pages served from Vercel's cache in either form, but not MISS or BYPASS", async () => {
    site.page = (path, kind) => {
      const fresh = freshSite.page(path, kind);
      if (path === "/") return { ...fresh, cache: kind === "html" ? "PRERENDER" : "HIT" };
      if (path === "/lab") return { ...fresh, cache: kind === "rsc" ? "STALE" : "BYPASS" };
      return fresh;
    };
    const result = await watchdog({ env: { ...healthy, PROBE_ALL: "1" } });
    expect(result.status, result.stderr).toBe(0);
    expect(result.keys).toEqual(["page-cached-/-html", "page-cached-/-rsc", "page-cached-/lab-rsc"]);
    expect(result.posted).toContain("GET / was served from a stored copy (x-vercel-cache PRERENDER)");
    expect(result.posted).toContain("GET /lab (RSC) was served from a stored copy (x-vercel-cache STALE)");
  });

  it("reports the deploy-time copy of #33: cached and hours behind, as two conditions", async () => {
    site.page = (path, kind) => (path === "/" && kind === "html" ? { status: 200, stamp: hoursAgo(45), age: "0", cache: "PRERENDER" } : freshSite.page(path, kind));
    const result = await watchdog({ env: healthy });
    expect(result.status, result.stderr).toBe(0);
    expect(result.writes.map((args) => args.slice(0, 2))).toEqual([["issue", "create"]]);
    expect(result.keys).toEqual(["page-cached-/-html", "page-behind-/-html"]);
    expect(result.posted).toMatch(/<!-- live-watchdog-open: page-cached-\/-html page-behind-\/-html -->$/);
    expect(result.posted).toMatch(/GET \/ showed state from \S+ \(delivery current, x-vercel-cache PRERENDER\), 2700 minutes behind/);
  });

  it("reports a server on its stored copy and behind the publication, read from a 503, without judging matching pages", async () => {
    const stored = "2026-11-03T06:00:14.000Z";
    site.health = () => ({
      status: 503,
      body: { status: "stale", generatedAt: stored, delivery: "stored", data: { source: "bundled", commit: null, head: null, problem: "the head commit of live-data is unknown" } },
    });
    site.page = () => ({ status: 200, stamp: stored, delivery: "stored", age: "0", cache: "MISS" });
    const result = await watchdog({ env: { ...healthy, PROBE_ALL: "1" } });
    expect(result.status, result.stderr).toBe(0);
    expect(result.keys).toEqual(["site-behind-publication", "site-stored-copy"]);
    expect(result.posted).toContain("delivery stored, data.commit null, data.head null, data.problem the head commit of live-data is unknown");
  });

  it("reports a site it cannot read without stopping the chain check or restart", async () => {
    const result = await watchdog({ env: { SITE_URL: "http://127.0.0.1:9" } });
    expect(result.status, result.stderr).toBe(0);
    expect(result.writes[0]).toEqual(["workflow", "run", "live-forecast.yml", "--ref", "main"]);
    expect(result.keys).toEqual(expect.arrayContaining(["restart", "health-unknown", "page-error-/-html"]));
    expect(result.keys.some((key) => key.startsWith("page-behind-"))).toBe(false);
    expect(result.posted).toContain("Could not read /api/live/health (fetch failed");
    expect(result.posted).toContain("GET / got no answer: fetch failed");
  });

  it("judges no page against an unreadable health, but still reports what needs none", async () => {
    site.health = () => ({ body: "<html>not json</html>" });
    site.page = (path, kind) => (path === "/" ? { status: 200, stamp: hoursAgo(10), age: "0", cache: "MISS" } : freshSite.page(path, kind));
    const result = await watchdog({ env: { ...healthy, PROBE_ALL: "1" } });
    expect(result.status, result.stderr).toBe(0);
    expect(result.keys).toEqual(["health-unknown"]);
  });

  it("separates a page without a readable stamp from one that failed", async () => {
    site.page = (path, kind) => {
      if (path === "/" && kind === "html") return { status: 200, stamp: null, age: "3", cache: "MISS" };
      if (path === "/" && kind === "rsc") return { status: 200, stamp: null, age: null, cache: "MISS", body: `1:{"generatedAt":"${new Date().toISOString()}"}\n2:{"generatedAt":"${hoursAgo(2)}"}\n` };
      if (path === "/odds") return { status: 500, stamp: null, age: null, cache: null };
      return freshSite.page(path, kind);
    };
    const result = await watchdog({ env: { ...healthy, PROBE_ALL: "1" } });
    expect(result.status, result.stderr).toBe(0);
    expect(result.keys).toEqual(["page-stamp-unreadable-/-html", "page-stamp-unreadable-/-rsc", "page-error-/odds-html", "page-error-/odds-rsc"]);
    expect(result.posted).toContain("GET /odds returned 500.");
  });

  it("reports nothing about an old state that the server and every page agree on", async () => {
    const old = hoursAgo(20);
    site.health = () => ({ body: { status: "ok", generatedAt: old, delivery: "current", data: { source: "network", commit: "c1", head: "c1", problem: null } } });
    site.page = () => ({ status: 200, stamp: old, age: "72000", cache: "MISS" });
    const published = new Date(Date.parse(old) + 60_000).toISOString();
    const result = await watchdog({ env: { RUNS: busy, STATE: JSON.stringify({ season: 2027, seasonLabel: "2026-27", generatedAt: published }) } });
    expect(result.status, result.stderr).toBe(0);
    // Only the publication's own age (over 2.5 hours) is reported, never the pages.
    expect(result.keys).toEqual([`stale-${published}`]);
  });

  it("skips the site entirely when SITE_URL is empty", async () => {
    const result = await watchdog({ env: { ...healthy, SITE_URL: "" } });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('"url": null');
    expect(result.stdout).toContain("No alerts.");
    expect(requests).toEqual([]);
  });
});
