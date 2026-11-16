// The live watchdog's pure decisions (scripts/live/watchdog-decision.mjs).
import { describe, expect, it } from "vitest";
import * as navLinks from "@/components/layout/NavLinks";
import * as siteFooter from "@/components/layout/SiteFooter";
import {
  alertBody,
  decideWatchdog,
  failureStreak,
  mustPersist,
  PROBE_ROUTES,
  probePlan,
  probeRoutes,
  renderedStamp,
  reportedKeys,
  rotationIndex,
  rscStamp,
  settledSiteAlerts,
  siteAlerts,
  // @ts-expect-error a plain Node module with no types, run by the watchdog workflow without a build
} from "../scripts/live/watchdog-decision.mjs";
import { liveScript, run as runCommand } from "./support/shell";

type Alert = { key: string; text: string };
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

describe("issue text", () => {
  it("round-trips its keys through the hidden marker", () => {
    const body = alertBody({ now, dataCommit: "abc", runUrl: "https://example.test/run", alerts: [{ key: "restart", text: "a" }, { key: "unsealed-g1", text: "b" }] });
    expect(body).toContain("- a\n- b");
    expect(body).toContain("cc @bilguutei2k");
    expect([...reportedKeys(["unrelated", body, "<!-- live-watchdog: stale-x -->"])]).toEqual(["restart", "unsealed-g1", "stale-x"]);
    expect(reportedKeys([null, ""]).size).toBe(0);
  });
});

describe("probe plan", () => {
  // 2026-11-05T20:00Z is quarter-hour 1,970,560; 14 routes with the day page.
  const at = (iso: string, all = false) => (probePlan({ now: iso, all }) as Array<{ path: string; kind: string }>).map(({ path, kind }) => `${kind} ${path}`);

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

  it("reads RSC too only in the run whose UTC minute is under 15, and never reads a route twice", () => {
    const quarter = 15 * 60_000;
    // Find a time in the first quarter hour whose rotation lands on `/`, and one that does not.
    const hours = Array.from({ length: 14 }, (_, hour) => Date.parse("2026-11-05T00:05:00Z") + hour * 3_600_000);
    const onHome = hours.find((time) => rotationIndex(time, 14) === 0)!;
    const elsewhere = hours.find((time) => rotationIndex(time, 14) !== 0)!;
    const other = probeRoutes(new Date(elsewhere).toISOString())[rotationIndex(elsewhere, 14)];
    expect(at(new Date(elsewhere).toISOString())).toEqual(["html /", `html ${other}`, "rsc /", `rsc ${other}`]);
    expect(at(new Date(onHome).toISOString())).toEqual(["html /", "rsc /"]);
    expect(at(new Date(elsewhere + quarter).toISOString())).toHaveLength(2);
    expect(at(new Date(elsewhere + quarter).toISOString()).every((read) => read.startsWith("html "))).toBe(true);
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
    expect(noAnswer).toEqual({ key: "page-error-/odds-rsc", text: "GET /odds (RSC) got no answer: fetch failed: ECONNREFUSED." });
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

  it("counts a behind condition only when two readings show it, and every other condition from either", () => {
    expect(["site-behind-publication", "page-behind-/-html", "page-behind-/record-rsc"].every(mustPersist)).toBe(true);
    expect(["site-stored-copy", "page-cached-/-html", "page-error-/-html", "page-stamp-unreadable-/-rsc", "health-unknown"].some(mustPersist)).toBe(false);
    const alert = (key: string, text = key): Alert => ({ key, text });
    const keys = (first: Alert[], second: Alert[]) => (settledSiteAlerts(first, second) as Alert[]).map((entry) => entry.key);
    // A publication that had not reached the server yet: behind once, then not.
    expect(keys([alert("site-behind-publication"), alert("page-behind-/-html")], [])).toEqual([]);
    // Behind in the second reading only (a publication landed between the two): not yet.
    expect(keys([alert("page-behind-/-html")], [alert("page-behind-/odds-html")])).toEqual([]);
    // Behind both times: reported, with the second reading's text.
    expect(settledSiteAlerts([alert("site-behind-publication", "first")], [alert("site-behind-publication", "second")])).toEqual([alert("site-behind-publication", "second")]);
    // Everything else counts from either reading, once: the second reading's order, then
    // what only the first showed.
    expect(keys([alert("page-error-/-html"), alert("page-behind-/-html"), alert("health-unknown")], [alert("page-cached-/lab-rsc"), alert("page-error-/-html"), alert("page-behind-/-html")])).toEqual([
      "page-cached-/lab-rsc",
      "page-error-/-html",
      "page-behind-/-html",
      "health-unknown",
    ]);
  });

  it("reports a server rendering its stored copy, with a 503 body still read", () => {
    const stored = health({ status: "stale", delivery: "stored", generatedAt: "2026-11-03T06:00:14Z", data: { source: "bundled", commit: null, head: null, problem: "the head commit of live-data is unknown" } });
    const alerts = check([page({ stamp: { generatedAt: "2026-11-03T06:00:14Z", delivery: "stored" } })], { health: stored, publication: now });
    expect(alerts.map((alert) => alert.key)).toEqual(["site-behind-publication", "site-stored-copy"]);
    expect(alerts[1].text).toContain("data.problem the head commit of live-data is unknown");
  });
});
