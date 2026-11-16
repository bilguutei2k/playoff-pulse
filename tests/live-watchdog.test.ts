// The live watchdog's pure decisions (scripts/live/watchdog-decision.mjs).
import { describe, expect, it } from "vitest";
import * as navLinks from "@/components/layout/NavLinks";
import * as siteFooter from "@/components/layout/SiteFooter";
import {
  checkedKeys,
  decideWatchdog,
  failureStreak,
  INCIDENT_MARKER,
  incidentRechecks,
  incidentTitle,
  isIncident,
  openKeys,
  planIncident,
  PROBE_ROUTES,
  probePlan,
  probeRoutes,
  renderedStamp,
  rotationIndex,
  rscRotationIndex,
  rscStamp,
  siteAlerts,
  // @ts-expect-error a plain Node module with no types, run by the watchdog workflow without a build
} from "../scripts/live/watchdog-decision.mjs";
import { liveScript, run as runCommand } from "./support/shell";

type Alert = { key: string; text: string; kind: "state" | "event" };
const now = "2026-11-05T20:00:00Z";
let nextId = 1;
const run = (minutesAgo: number, conclusion: string | null = "success", status = "completed", title = "Live forecast") => ({
  id: nextId++,
  created_at: new Date(Date.parse(now) - minutesAgo * 60_000).toISOString(),
  status,
  conclusion,
  display_title: title,
});
const game = { id: "g1", etDate: "2026-11-05", tipUtc: "2026-11-05T19:49Z", status: "scheduled", homeId: "1", awayId: "2" };
const seal = { type: "seal", gameId: "g1", modelVersion: "live-2026.27-v2", sealKind: "morning" };
const decide = (overrides: Record<string, unknown> = {}) =>
  decideWatchdog({ now, workflowState: "active", runs: [run(5)], state: { generatedAt: now }, games: [], ledger: [], ...overrides });
const keys = (overrides: Record<string, unknown> = {}) => (decide(overrides).alerts as Alert[]).map((alert) => alert.key);

describe("restarting the chain", () => {
  it("dispatches only with no real run created in the last 25 minutes", () => {
    expect(decide()).toMatchObject({ dispatch: false, recent: true, active: false });
    expect(decide({ runs: [run(25)] }).dispatch).toBe(false);
    expect(decide({ runs: [run(26)] })).toMatchObject({ dispatch: true, recent: false });
    expect(keys({ runs: [run(26)] })).toEqual(["restart"]);
    expect(decide({ runs: [] }).dispatch).toBe(true);
  });

  it.each(["queued", "in_progress", "waiting", "pending", "requested"])("does not dispatch while a run is %s", (status) => {
    expect(decide({ runs: [run(80, null, status)] })).toMatchObject({ dispatch: false, active: true });
  });

  it("does not count a run that has shown as not completed for over 90 minutes", () => {
    expect(decide({ runs: [run(90, null, "in_progress")] }).dispatch).toBe(false);
    expect(decide({ runs: [run(91, null, "queued")] })).toMatchObject({ dispatch: true, active: false });
  });

  it("ignores dry runs, recent or running", () => {
    expect(decide({ runs: [run(1, "success", "completed", "Live forecast (dry run)")] }).dispatch).toBe(true);
    expect(decide({ runs: [run(1, null, "in_progress", "Live forecast (dry run)")] }).dispatch).toBe(true);
  });

  it("stays silent and idle when live-forecast is disabled by hand", () => {
    expect(decide({ runs: [], state: { generatedAt: "2026-11-01T00:00:00Z" }, workflowState: "disabled_manually" })).toEqual({
      paused: true, dispatch: false, active: null, recent: null, streak: null, alerts: [],
    });
  });

  it("alerts instead of dispatching when live-forecast is disabled otherwise", () => {
    expect(decide({ runs: [], workflowState: "disabled_inactivity" })).toMatchObject({ dispatch: false, paused: false });
    expect(keys({ runs: [], workflowState: "disabled_inactivity" })).toEqual(["workflow-disabled_inactivity"]);
  });

  it("still dispatches when the workflow's state could not be read", () => {
    expect(decide({ runs: [], workflowState: null }).dispatch).toBe(true);
  });

  it("neither dispatches nor guesses when the runs could not be listed", () => {
    expect(decide({ runs: null })).toMatchObject({ dispatch: false, streak: null, active: null });
    expect(keys({ runs: null })).toEqual(["runs-unreadable"]);
  });
});

describe("stale state", () => {
  it("alerts strictly past 2.5 hours, keyed by the stale timestamp", () => {
    expect(keys({ state: { generatedAt: "2026-11-05T17:30:00Z" } })).toEqual([]);
    expect(keys({ state: { generatedAt: "2026-11-05T17:29:59Z" } })).toEqual(["stale-2026-11-05T17:29:59Z"]);
  });

  it("alerts on an unreadable or missing timestamp", () => {
    expect(keys({ state: { generatedAt: "garbage" } })).toEqual(["stale-garbage"]);
    expect(keys({ state: {} })).toEqual(["stale-undefined"]);
  });
});

describe("tipped games without a v2 final or morning seal", () => {
  it("alerts per game, keyed by game", () => {
    expect(keys({ games: [game, { ...game, id: "g2" }] })).toEqual(["unsealed-g1", "unsealed-g2"]);
  });

  it.each(["morning", "final"])("a v2 %s seal is enough", (sealKind) => {
    expect(keys({ games: [game], ledger: [{ ...seal, sealKind }] })).toEqual([]);
  });

  it("a reissued seal, a v1 seal or a result row does not hide a gap", () => {
    for (const row of [{ ...seal, sealKind: "reissued" }, { ...seal, modelVersion: "live-2026.27-v1", sealKind: null }, { type: "result", gameId: "g1" }]) {
      expect(keys({ games: [game], ledger: [row] })).toEqual(["unsealed-g1"]);
    }
  });

  it("skips games before v2, canceled or postponed, inside the 10 minutes, untipped, or older than 24 hours", () => {
    for (const g of [
      { ...game, etDate: "2026-11-01" },
      { ...game, status: "canceled" },
      { ...game, status: "postponed" },
      { ...game, tipUtc: "2026-11-05T19:50Z" },
      { ...game, tipUtc: "2026-11-05T21:00Z" },
      { ...game, tipUtc: "2026-11-04T19:59Z" },
      { ...game, tipUtc: "garbage" },
    ]) {
      expect(keys({ games: [g] })).toEqual([]);
    }
    expect(keys({ games: [{ ...game, tipUtc: "2026-11-04T20:00Z" }] })).toEqual(["unsealed-g1"]);
  });

  it("does not guess when the games or the ledger could not be read", () => {
    expect(keys({ games: [game], ledger: null })).toEqual([]);
    expect(keys({ games: null, ledger: [] })).toEqual([]);
  });
});

describe("failure streak", () => {
  it("alerts at three failed real runs in a row, keyed by the streak's first run", () => {
    const runs = [run(1, "failure"), run(2, "cancelled"), run(3, "timed_out"), run(4, "startup_failure"), run(5, "success")];
    const decision = decide({ runs });
    expect(decision.streak).toBe(3);
    expect(keys({ runs })).toEqual([`failing-since-${runs[3].id}`]);
    expect(decide({ runs: runs.slice(1) }).streak).toBe(2);
  });

  it("ignores in-progress and dry runs, and ends at any other conclusion", () => {
    const failing = [run(2, "failure"), run(3, "failure"), run(4, "failure")];
    expect(decide({ runs: [run(1, null, "in_progress"), ...failing] }).streak).toBe(3);
    expect(decide({ runs: [run(0, "success", "completed", "Live forecast (dry run)"), ...failing] }).streak).toBe(3);
    expect(decide({ runs: [run(1, "neutral"), ...failing] }).streak).toBe(0);
  });

  it("sorts by creation time, not list order", () => {
    expect(failureStreak([run(10, "failure"), run(1, "success"), run(20, "failure")]).streak).toBe(0);
  });

  it.each([
    ["failure", "failure", "failure"],
    ["failure", "cancelled", "failure", "skipped", "failure", "success", "failure"],
    ["cancelled", "cancelled", "success", "failure"],
    ["startup_failure", "timed_out", "stale", "action_required", "failure"],
    [],
  ])("counts like scripts/live/chain-decision.sh: %j", (...conclusions: string[]) => {
    const runs = conclusions.map((conclusion, index) => run(index + 1, conclusion));
    const [newest = "cancelled", ...earlier] = conclusions;
    const script = runCommand("bash", [liveScript("chain-decision.sh"), newest, ...earlier], process.cwd());
    expect(script.status, script.stderr).toBe(0);
    expect(failureStreak(runs).streak).toBe(Number(/streak=(\d+)/.exec(script.stdout)?.[1]));
  });
});

describe("probe plan", () => {
  // 2026-11-05T20:00Z is quarter-hour 1,970,560; 14 routes with the day page.
  const at = (iso: string, all = false, also: Array<{ path: string; kind: string }> = []) =>
    (probePlan({ now: iso, all, also }) as Array<{ path: string; kind: string }>).map(({ path, kind }) => `${kind} ${path}`);

  it("probes the linked routes plus yesterday's ET day page", () => {
    expect(probeRoutes(now)).toEqual([...PROBE_ROUTES, "/games/2026-11-04"]);
    // 03:30 UTC on 2026-11-06 is still 2026-11-05 in New York, so yesterday is the 4th.
    expect(probeRoutes("2026-11-06T03:30:00Z").at(-1)).toBe("/games/2026-11-04");
    expect(probeRoutes("2026-11-06T05:30:00Z").at(-1)).toBe("/games/2026-11-05");
  });

  it("rotates one route per quarter hour, by floor(now / 15 min) mod N", () => {
    const quarter = 15 * 60_000;
    expect(rotationIndex(0, 14)).toBe(0);
    expect(rotationIndex(quarter - 1, 14)).toBe(0);
    expect(rotationIndex(quarter, 14)).toBe(1);
    expect(rotationIndex(14 * quarter, 14)).toBe(0);
    const index = rotationIndex(Date.parse("2026-11-05T20:20:00Z"), 14);
    expect(index).toBe(Math.floor(Date.parse("2026-11-05T20:20:00Z") / quarter) % 14);
    expect(at("2026-11-05T20:20:00Z")).toEqual(["html /", `html ${probeRoutes(now)[index]}`]);
    // Every route is covered once in 14 consecutive quarter hours.
    const start = Date.parse("2026-11-05T12:00:00Z");
    const seen = new Set(Array.from({ length: 14 }, (_, step) => at(new Date(start + step * quarter + 16 * 60_000).toISOString()).at(-1)));
    expect(seen.size).toBe(14);
  });

  it("reads RSC only in the run whose UTC minute is under 15: `/` and a route rotating hourly", () => {
    expect(at("2026-11-05T20:05:00Z")).toEqual(["html /", "html /evidence", "rsc /", "rsc /how-it-works"]);
    // The HTML rotation lands on `/` here, and `/` is read once per form.
    expect(at("2026-11-05T21:05:00Z")).toEqual(["html /", "rsc /", "rsc /about"]);
    expect(at("2026-11-05T20:20:00Z")).toEqual(["html /", "html /methodology"]);
    expect(rscRotationIndex(Date.parse("2026-11-05T20:59:59Z"), 14)).toBe(rscRotationIndex(Date.parse("2026-11-05T20:00:00Z"), 14));
  });

  it("reads every route as RSC within 14 hourly runs (the quarter-hour index alone would skip half)", () => {
    // 01:03 to 14:03 in New York, so yesterday's day page is the same in every run.
    const start = Date.parse("2026-11-05T06:03:00Z");
    const runs = Array.from({ length: 14 }, (_, hour) => new Date(start + hour * 3_600_000).toISOString());
    const rsc = new Set(runs.flatMap((iso) => at(iso).filter((read) => read.startsWith("rsc ")).map((read) => read.slice(4))));
    expect(rsc).toEqual(new Set(probeRoutes(runs[0])));
    // The quarter-hour index at minute 3 of each hour only ever lands on even indexes.
    expect(new Set(runs.map((iso) => rotationIndex(Date.parse(iso), 14) % 2)).size).toBe(1);
  });

  it("adds the reads an open incident waits for, once, and only for routes still probed", () => {
    const also = [
      { path: "/lab", kind: "rsc" },
      { path: "/", kind: "html" },
      { path: "/games/2026-11-01", kind: "html" },
    ];
    expect(at("2026-11-05T20:20:00Z", false, also)).toEqual(["html /", "html /methodology", "rsc /lab"]);
  });

  it("reads every route in both forms with PROBE_ALL", () => {
    const all = at("2026-11-05T20:40:00Z", true);
    expect(all).toHaveLength(28);
    expect(all.slice(0, 2)).toEqual(["html /", "rsc /"]);
    for (const path of probeRoutes(now)) expect(all).toEqual(expect.arrayContaining([`html ${path}`, `rsc ${path}`]));
  });

  it("equals the routes the nav and the footer link to", () => {
    // NavLinks.tsx exports NAV_ITEMS, SiteFooter.tsx FORECAST_LINKS and ARCHIVE_LINKS: a route
    // added to either without being probed fails here.
    const lists = [
      (navLinks as Record<string, unknown>).NAV_ITEMS,
      (siteFooter as Record<string, unknown>).FORECAST_LINKS,
      (siteFooter as Record<string, unknown>).ARCHIVE_LINKS,
    ] as Array<Array<{ href: string }> | undefined>;
    for (const list of lists) expect(Array.isArray(list)).toBe(true);
    const linked = new Set(lists.flatMap((list) => (list ?? []).map((item) => item.href)));
    expect([...PROBE_ROUTES].sort()).toEqual([...linked].sort());
  });
});

describe("served pages", () => {
  const ago = (minutes: number) => new Date(Date.parse(now) - minutes * 60_000).toISOString();
  const chip = (stamp: string, delivery = "current") =>
    `<html><body><p class="x"><time dateTime="${stamp}" data-state-stamp="" data-state-delivery="${delivery}">Updated 4 min ago</time></p><time datetime="2020-01-01">other</time></body></html>`;
  const health = (overrides: Record<string, unknown> = {}) => ({
    status: "ok",
    generatedAt: now,
    delivery: "current",
    data: { source: "network", commit: "c1", head: "c1", problem: null },
    ...overrides,
  });
  const page = (overrides: Record<string, unknown> = {}) => ({
    path: "/",
    kind: "html",
    status: 200,
    error: null,
    stamp: { generatedAt: now, delivery: "current" },
    cache: "MISS",
    ...overrides,
  });
  const check = (pages: unknown[], input: Record<string, unknown> = {}) =>
    siteAlerts({ health: health(), publication: now, pages, ...input }) as Alert[];
  const pageKeys = (pages: unknown[], input: Record<string, unknown> = {}) => check(pages, input).map((alert) => alert.key);

  it("reads the chip's stamp and delivery, not another <time>, and null without one", () => {
    expect(renderedStamp(chip(now))).toEqual({ generatedAt: now, delivery: "current" });
    expect(renderedStamp(chip(now, "stored"))).toEqual({ generatedAt: now, delivery: "stored" });
    expect(renderedStamp(`<time data-state-stamp="" datetime="${now}">x</time>`)).toEqual({ generatedAt: now, delivery: null });
    expect(renderedStamp("<html><time datetime=\"2020-01-01\">x</time></html>")).toBeNull();
    expect(renderedStamp("<time data-state-stamp=\"\" datetime=\"\">x</time>")).toBeNull();
    expect(renderedStamp("")).toBeNull();
    expect(renderedStamp(null)).toBeNull();
  });

  it("reads an RSC payload's stamp only when every generatedAt agrees", () => {
    const guard = `1:["$","$L5",null,{"generatedAt":"${now}","delivery":"current"}]`;
    const pageStamp = `7:["$","$L9",null,{"generatedAt":"${now}"}]`;
    expect(rscStamp(`0:{"b":"x"}\n${guard}\n${pageStamp}\n`)).toEqual({ generatedAt: now, delivery: "current" });
    expect(rscStamp(`${guard}\n7:{"generatedAt":"${ago(60)}"}`)).toBeNull();
    expect(rscStamp(`0:{"b":"x"}`)).toBeNull();
    expect(rscStamp(`1:{"generatedAt":"garbage"}`)).toBeNull();
    expect(rscStamp(`1:{"generatedAt":"${now}"}`)).toEqual({ generatedAt: now, delivery: null });
    expect(rscStamp(`1:{"generatedAt":"${now}","delivery":"current"}\n2:{"delivery":"stored"}`)).toEqual({ generatedAt: now, delivery: null });
    expect(rscStamp(null)).toBeNull();
  });

  it("stays quiet on a page matching a healthy server, however old the state", () => {
    const old = ago(48 * 60);
    expect(pageKeys([page({ stamp: { generatedAt: old, delivery: "current" }, age: 172_800 })], { health: health({ generatedAt: old }), publication: old })).toEqual([]);
    expect(pageKeys([page(), page({ kind: "rsc" }), page({ path: "/record", cache: "BYPASS" }), page({ cache: null })])).toEqual([]);
    // A copy newer than the server is not behind.
    expect(pageKeys([page({ stamp: { generatedAt: ago(-5), delivery: "current" } })])).toEqual([]);
  });

  it("reports a page strictly more than 15 minutes behind the server, per path and kind", () => {
    expect(pageKeys([page({ stamp: { generatedAt: ago(15), delivery: "current" } })])).toEqual([]);
    const behind = { generatedAt: "2026-11-05T19:44:59Z", delivery: "older" };
    expect(pageKeys([page({ stamp: behind }), page({ path: "/record", kind: "rsc", stamp: behind })])).toEqual(["page-behind-/-html", "page-behind-/record-rsc"]);
    const [alert] = check([page({ stamp: { generatedAt: ago(2710), delivery: "current" }, cache: "MISS" })]);
    expect(alert.text).toContain("2710 minutes behind the server's 2026-11-05T20:00:00Z");
    expect(alert.text).toContain("delivery current, x-vercel-cache MISS");
  });

  it("reports a page served from Vercel's cache, whatever its stamp", () => {
    expect(pageKeys([page({ cache: "PRERENDER" }), page({ kind: "rsc", cache: "hit" }), page({ path: "/lab", cache: "STALE" })])).toEqual([
      "page-cached-/-html",
      "page-cached-/-rsc",
      "page-cached-/lab-html",
    ]);
    // The 2026-11-14 deploy-time copy: both conditions, each under its own key.
    expect(pageKeys([page({ cache: "PRERENDER", stamp: { generatedAt: ago(2710), delivery: "current" } })])).toEqual(["page-cached-/-html", "page-behind-/-html"]);
    expect(pageKeys([page({ cache: "MISS" }), page({ cache: "BYPASS" }), page({ cache: "REVALIDATED" })])).toEqual([]);
  });

  it("separates an unreadable stamp from a failed request", () => {
    expect(pageKeys([page({ stamp: null })])).toEqual(["page-stamp-unreadable-/-html"]);
    expect(pageKeys([page({ kind: "rsc", stamp: { generatedAt: "garbage", delivery: null } })])).toEqual(["page-stamp-unreadable-/-rsc"]);
    expect(pageKeys([page({ status: 500, stamp: null })])).toEqual(["page-error-/-html"]);
    expect(pageKeys([page({ status: 404, stamp: null, cache: "HIT" })])).toEqual(["page-cached-/-html", "page-error-/-html"]);
    const [noAnswer] = check([page({ path: "/odds", kind: "rsc", status: null, error: "fetch failed: ECONNREFUSED", stamp: null, cache: null })]);
    expect(noAnswer).toEqual({ kind: "state", key: "page-error-/odds-rsc", text: "GET /odds (RSC) got no answer: fetch failed: ECONNREFUSED." });
  });

  it("judges no page against a health it could not read", () => {
    const behind = page({ stamp: { generatedAt: ago(600), delivery: "current" }, age: 99_999 });
    expect(pageKeys([behind], { health: null, healthProblem: "fetch failed" })).toEqual(["health-unknown"]);
    expect(check([behind], { health: null, healthProblem: "fetch failed" })[0].text).toContain("(fetch failed)");
    expect(pageKeys([behind], { health: health({ generatedAt: "garbage" }) })).toEqual(["health-unknown"]);
    expect(pageKeys([behind], { health: { error: "x" } })).toEqual(["health-unknown"]);
    // What does not need health is still reported.
    expect(pageKeys([page({ status: 502, stamp: null }), page({ path: "/teams", stamp: null }), page({ path: "/lab", cache: "PRERENDER" })], { health: null })).toEqual([
      "health-unknown",
      "page-error-/-html",
      "page-stamp-unreadable-/teams-html",
      "page-cached-/lab-html",
    ]);
  });

  it("reports the server strictly more than 15 minutes behind the publication, with where its data came from", () => {
    expect(pageKeys([], { health: health({ generatedAt: ago(15) }), publication: now })).toEqual([]);
    const lagging = health({ generatedAt: ago(16), delivery: "older", data: { source: "network", commit: "c0", head: "c1", problem: "manifest hash mismatch" } });
    const alerts = check([], { health: lagging, publication: now });
    expect(alerts.map((alert) => alert.key)).toEqual(["site-behind-publication"]);
    expect(alerts[0].text).toContain("16 minutes behind live-data's state.json (2026-11-05T20:00:00Z)");
    expect(alerts[0].text).toContain("delivery older, data.commit c0, data.head c1, data.problem manifest hash mismatch");
    // A server ahead of git's copy, or an unreadable publication, is not behind.
    expect(pageKeys([], { health: health(), publication: ago(30) })).toEqual([]);
    expect(pageKeys([], { health: health({ generatedAt: ago(600) }), publication: null })).toEqual([]);
    expect(pageKeys([], { health: health({ generatedAt: ago(600) }), publication: "garbage" })).toEqual([]);
  });

  it("reports a server rendering its stored copy, with a 503 body still read", () => {
    const stored = health({ status: "stale", delivery: "stored", generatedAt: "2026-11-03T06:00:14Z", data: { source: "bundled", commit: null, head: null, problem: "the head commit of live-data is unknown" } });
    const alerts = check([page({ stamp: { generatedAt: "2026-11-03T06:00:14Z", delivery: "stored" } })], { health: stored, publication: now });
    expect(alerts.map((alert) => alert.key)).toEqual(["site-behind-publication", "site-stored-copy"]);
    expect(alerts[1].text).toContain("data.problem the head commit of live-data is unknown");
  });
});

describe("alert kinds", () => {
  it("marks restarts as events and every other condition as a state", () => {
    const decision = decide({ runs: [run(1, "failure"), run(2, "failure"), run(3, "failure"), run(40)].map((entry) => ({ ...entry, created_at: new Date(Date.parse(now) - 30 * 60_000).toISOString() })), state: { generatedAt: "2026-11-05T10:00:00Z" }, games: [game], workflowState: "disabled_inactivity" });
    const kinds = Object.fromEntries((decision.alerts as Alert[]).map((alert) => [alert.key.replace(/-.*/, ""), alert.kind]));
    expect(kinds).toEqual({ workflow: "state", failing: "state", stale: "state", unsealed: "state" });
    expect((decide({ runs: [] }).alerts as Alert[]).map((alert) => [alert.key, alert.kind])).toEqual([["restart", "event"]]);
    expect((decide({ runs: null }).alerts as Alert[])[0].kind).toBe("state");
    const site = siteAlerts({ health: null, publication: null, pages: [{ path: "/", kind: "html", status: 500, stamp: null, cache: "HIT" }] }) as Alert[];
    expect(site.every((alert) => alert.kind === "state")).toBe(true);
  });
});

describe("incidents", () => {
  const state = (key: string): Alert => ({ key, text: `text of ${key}`, kind: "state" });
  const event = (key: string): Alert => ({ key, text: `text of ${key}`, kind: "event" });
  const healthy = { generatedAt: now, status: "ok", delivery: "current" };
  const read = (path: string, kind = "html", overrides: Record<string, unknown> = {}) => ({ path, kind, status: 200, stamp: { generatedAt: now, delivery: "current" }, cache: "MISS", ...overrides });
  const checker = (overrides: Record<string, unknown> = {}, site: Record<string, unknown> = {}) =>
    checkedKeys({
      now,
      workflowState: "active",
      runs: [],
      state: { generatedAt: now },
      games: [game],
      ledger: [],
      attempted: ["live-forecast-state", "live-data", "state.json", "games", "ledger"],
      site: { enabled: true, health: healthy, publication: now, pages: [read("/")], ...site },
      ...overrides,
    });
  const plan = (input: Record<string, unknown>) => planIncident({ now, checked: checker(), context: { dataCommit: "abc", runUrl: "https://example.test/run" }, ...input });

  it("titles an incident by its UTC date and minute and recognises it by title and marker", () => {
    expect(incidentTitle("2026-11-05T20:07:59.123Z")).toBe("Live watchdog incident from 2026-11-05 20:07 UTC");
    expect(isIncident({ title: "Live watchdog incident from 2026-11-05 20:07 UTC", body: `x\n${INCIDENT_MARKER}` })).toBe(true);
    expect(isIncident({ title: "Live watchdog incident from 2026-11-05 20:07 UTC", body: "x" })).toBe(false);
    expect(isIncident({ title: "Live watchdog on 2026-11-05", body: INCIDENT_MARKER })).toBe(false);
  });

  it("does nothing with no incident and no alert", () => {
    expect(plan({ incident: null, alerts: [] })).toEqual({ action: "none" });
  });

  it("opens an incident listing every alert, with only the states open, linking the previous one", () => {
    const result = plan({ incident: null, alerts: [event("restart"), state("stale-x"), state("page-behind-/-html")], previous: { number: 40, closedAt: "2026-11-04T10:00:00Z" } });
    expect(result).toMatchObject({ action: "create", title: "Live watchdog incident from 2026-11-05 20:00 UTC", open: ["stale-x", "page-behind-/-html"] });
    expect(result.body).toContain("The previous incident was #40, closed 2026-11-04T10:00:00Z.");
    expect(result.body).toContain("Open conditions:\n- text of stale-x\n- text of page-behind-/-html");
    expect(result.body).toContain("Events:\n- text of restart");
    expect(result.body).toContain("https://example.test/run");
    expect(result.body).toContain("cc @bilguutei2k");
    expect(result.body).toContain(INCIDENT_MARKER);
    expect(openKeys([result.body])).toEqual(["stale-x", "page-behind-/-html"]);
    expect(plan({ incident: null, alerts: [state("stale-x")] }).body).not.toContain("previous incident");
  });

  it("reads the open keys from the body and comments in order", () => {
    expect(
      openKeys([
        "<!-- live-watchdog-open: a b -->",
        "<!-- live-watchdog-resolved: a -->",
        "<!-- live-watchdog-open: c -->\n<!-- live-watchdog-open: a -->",
        null,
        "<!-- live-watchdog-open: -->",
      ]),
    ).toEqual(["b", "c", "a"]);
  });

  it("comments only on new keys, and says nothing while the open ones still fire", () => {
    const incident = { number: 7, open: ["stale-x"] };
    expect(plan({ incident, alerts: [state("stale-x")] })).toEqual({ action: "none" });
    const result = plan({ incident, alerts: [state("stale-x"), state("unsealed-g1")] });
    expect(result).toMatchObject({ action: "comment", number: 7, open: ["stale-x", "unsealed-g1"], recovered: [] });
    expect(result.body).toContain("New conditions:\n- text of unsealed-g1");
    expect(result.body).not.toContain("text of stale-x");
    expect(openKeys(["<!-- live-watchdog-open: stale-x -->", result.body])).toEqual(["stale-x", "unsealed-g1"]);
  });

  it("reports every event, but an event never keeps an incident open", () => {
    const incident = { number: 7, open: [] };
    const again = plan({ incident, alerts: [event("restart")] });
    expect(again).toMatchObject({ action: "comment", open: [] });
    expect(again.body).toContain("Events:\n- text of restart");
    expect(again.body).not.toContain("live-watchdog-open");
    // An incident of events only closes on the next clean run.
    const created = plan({ incident: null, alerts: [event("restart")] });
    expect(created).toMatchObject({ action: "create", open: [] });
    const closed = plan({ incident: { number: 8, open: openKeys([created.body]) }, alerts: [] });
    expect(closed.action).toBe("close");
    expect(closed.body).toContain("the incident is closed");
  });

  it("counts an open state as recovered only when this run checked it", () => {
    const incident = { number: 7, open: ["page-behind-/lab-html", "stale-x"] };
    // The rotation read `/` only, so /lab is neither recovered nor closed; stale-x was checked.
    const partial = plan({ incident, alerts: [] });
    expect(partial).toMatchObject({ action: "comment", recovered: ["stale-x"], open: ["page-behind-/lab-html"] });
    expect(partial.body).toContain("recovered: stale-x");
    expect(partial.body).toContain("<!-- live-watchdog-resolved: stale-x -->");
    // Unchanged on the next run that again skips /lab.
    expect(plan({ incident: { number: 7, open: ["page-behind-/lab-html"] }, alerts: [] })).toEqual({ action: "none" });
    // The run that reads /lab and finds it current closes the incident.
    const checked = checker({}, { pages: [read("/"), read("/lab")] });
    const closed = plan({ incident: { number: 7, open: ["page-behind-/lab-html"] }, alerts: [], checked });
    expect(closed).toMatchObject({ action: "close", recovered: ["page-behind-/lab-html"], open: [] });
    expect(closed.body).toContain("recovered: page-behind-/lab-html");
  });

  it("never closes while a state is open or the run had a read problem", () => {
    const incident = { number: 7, open: ["stale-x"] };
    const reading = plan({ incident, alerts: [state("unreadable-state.json")], checked: checker({ state: null }) });
    expect(reading).toMatchObject({ action: "comment", recovered: [], open: ["stale-x", "unreadable-state.json"] });
    const healthLost = plan({ incident: { number: 7, open: ["page-behind-/-html"] }, alerts: [state("health-unknown")], checked: checker({}, { health: null }) });
    expect(healthLost).toMatchObject({ action: "comment", recovered: [], open: ["page-behind-/-html", "health-unknown"] });
    // A clean run after both recover closes it.
    expect(plan({ incident: { number: 7, open: ["stale-x", "unreadable-state.json"] }, alerts: [] }).action).toBe("close");
  });

  it("retires a condition on yesterday's day page after midnight ET, and a game past the lookback", () => {
    const incident = { number: 7, open: ["page-behind-/games/2026-11-03-html", "unsealed-old", "page-behind-/games/2026-11-04-rsc"] };
    const result = plan({ incident, alerts: [] });
    expect(result).toMatchObject({ action: "comment", retired: ["page-behind-/games/2026-11-03-html", "unsealed-old"], open: ["page-behind-/games/2026-11-04-rsc"] });
    expect(result.body).toContain("No longer watched");
    expect(result.body).toContain("<!-- live-watchdog-resolved: page-behind-/games/2026-11-03-html unsealed-old -->");
  });

  it("checks each kind of key only when its read happened", () => {
    const c = checker({}, { pages: [read("/"), read("/odds", "rsc", { status: 500, stamp: null }), read("/lab", "html", { stamp: null }), read("/teams", "html", { status: null, stamp: null, cache: null })] });
    const yes = ["runs-unreadable", "workflow-disabled_inactivity", "failing-since-3", "stale-x", "unsealed-g1", "unreadable-state.json", "health-unknown", "site-stored-copy", "site-behind-publication", "page-behind-/-html", "page-cached-/-html", "page-stamp-unreadable-/-html", "page-error-/-html", "page-error-/odds-rsc", "page-cached-/odds-rsc", "page-stamp-unreadable-/lab-html", "page-error-/teams-html"];
    const no = ["restart", "dispatch-failed", "page-behind-/-rsc", "page-behind-/odds-rsc", "page-stamp-unreadable-/odds-rsc", "page-behind-/lab-html", "page-cached-/teams-html", "unreadable-elsewhere", "something-else", "unsealed-unknown"];
    for (const key of yes) expect(c.has(key), key).toBe(true);
    for (const key of no) expect(c.has(key), key).toBe(false);
    const blind = checker({ workflowState: null, runs: null, state: null, games: null, attempted: [] }, { health: null, publication: null });
    for (const key of ["workflow-disabled_inactivity", "failing-since-3", "stale-x", "unsealed-g1", "unreadable-state.json", "site-stored-copy", "site-behind-publication", "page-behind-/-html"]) {
      expect(blind.has(key), key).toBe(false);
    }
    expect(blind.has("page-error-/-html")).toBe(true);
    const off = checker({}, { enabled: false, pages: [] });
    expect(off.has("health-unknown")).toBe(false);
    expect(off.has("site-stored-copy")).toBe(false);
  });

  it("names the reads an incident's open page keys need", () => {
    expect(incidentRechecks(["stale-x", "page-behind-/how-it-works-rsc", "page-error-/how-it-works-rsc", "page-cached-/-html", "page-stamp-unreadable-/games/2026-11-04-html"])).toEqual([
      { path: "/how-it-works", kind: "rsc" },
      { path: "/", kind: "html" },
      { path: "/games/2026-11-04", kind: "html" },
    ]);
  });
});
