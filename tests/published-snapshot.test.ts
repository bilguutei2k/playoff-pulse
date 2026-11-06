// Fault injection for src/lib/live-data/published.ts: the whole snapshot is the unit of
// fallback. A local HTTP server stands in for GitHub's ref advertisement and
// raw.githubusercontent.com; its network copies carry marker values (a state timestamp
// and a seal probability) that the bundled copy does not have, so any mixing shows.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

// React memoizes `cache` functions per render. Reproduce that: `render.next()` starts a new
// render; `render.memoize = false` imitates a route handler, where nothing is memoized.
const render = vi.hoisted(() => {
  const maps: Map<string, unknown>[] = [];
  return { maps, memoize: true, next: () => maps.forEach((map) => map.clear()) };
});
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("react", () => ({
  cache: (fn: (...args: unknown[]) => unknown) => {
    const calls = new Map<string, unknown>();
    render.maps.push(calls);
    return (...args: unknown[]) => {
      if (!render.memoize) return fn(...args);
      const key = JSON.stringify(args);
      if (!calls.has(key)) calls.set(key, fn(...args));
      return calls.get(key);
    };
  },
}));

const BUNDLED = JSON.parse(readFileSync("data/live/state.json", "utf8"));
const LABEL: string = BUNDLED.seasonLabel;
const MONTH = `site/${LABEL}/months/2026-11.json`;
const DAY = `site/${LABEL}/days/2026-11-02.json`;
const VIEW = `site/${LABEL}/projections.json`;
const A = "a".repeat(40);
const B = "b".repeat(40);
/** A projections view that differs from the default one, so it changes between commits. */
const NEXT_VIEW = JSON.stringify({ version: 1, seasonLabel: LABEL, fromEtDate: "2026-11-06", games: [] });

/** One published commit: every bundled site file plus a projections view, with markers. */
function publication(generatedAt: string, probability: number, extra: Record<string, string> = {}) {
  const manifest = JSON.parse(readFileSync("data/live/site/manifest.json", "utf8"));
  const files: Record<string, string> = {};
  for (const relative of Object.keys(manifest.files)) files[relative] = readFileSync(`data/live/${relative}`, "utf8");
  files["state.json"] = JSON.stringify({ ...BUNDLED, generatedAt });
  for (const relative of Object.keys(files).filter((file) => /\/(days|months)\//.test(file))) {
    const value = JSON.parse(files[relative]);
    for (const row of value.seals ?? value.rows) if (row.type === "seal") row.homeWinProbability = probability;
    files[relative] = JSON.stringify(value);
  }
  files[VIEW] = JSON.stringify({ version: 1, seasonLabel: LABEL, fromEtDate: "2026-11-05", games: [] });
  Object.assign(files, extra);
  manifest.files = Object.fromEntries(
    Object.entries(files).map(([key, value]) => [key, createHash("sha256").update(value).digest("hex")]),
  );
  return { files, manifest };
}

type Fault = "down" | "malformed" | { flaky: number };
let server: Server | undefined;
afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
  render.memoize = true;
  render.maps.length = 0;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** Serves commits; `site.head` is what the ref advertisement says, `site.faults` breaks files. */
async function serve(commits: Record<string, ReturnType<typeof publication>>, head: string) {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-06T08:00:00Z"));
  const site = { head, refsDown: false, faults: {} as Record<string, Fault>, requests: [] as string[] };
  server = createServer((req, res) => {
    const url = req.url ?? "";
    site.requests.push(url);
    if (url === "/refs") {
      if (site.refsDown) {
        res.statusCode = 503;
        return res.end();
      }
      return res.end(`${site.head} refs/heads/live-data\n`);
    }
    const [, commit, ...rest] = url.split("/");
    const relative = rest.join("/").replace(/^data\/live\//, "");
    const published = commits[commit];
    const fault = site.faults[`${commit}:${relative}`];
    if (fault === "down" || (typeof fault === "object" && fault.flaky-- > 0)) {
      res.statusCode = 503;
      return res.end("unavailable");
    }
    if (!published) {
      res.statusCode = 404;
      return res.end();
    }
    if (relative === "site/manifest.json") return res.end(JSON.stringify(published.manifest));
    if (fault === "malformed") return res.end("{}");
    if (relative in published.files) return res.end(published.files[relative]);
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test port");
  vi.stubEnv("LIVE_DATA_BASE_URL", `http://127.0.0.1:${address.port}`);
  vi.stubEnv("LIVE_DATA_REFS_URL", `http://127.0.0.1:${address.port}/refs`);
  vi.stubEnv("LIVE_DATA_SOURCE", "network");
  const p = await import("@/lib/live-data/published");
  /** Everything one page could combine, read the way React would: concurrently. */
  const page = async () => {
    const [state, via, ledger, day, view, status] = await Promise.all([
      p.getLiveState(), p.getLiveStateSource(), p.getSeasonLedger(), p.getDaySeals("2026-11-02"), p.getProjections(), p.getLiveDataStatus(),
    ]);
    const probabilities = new Set(
      [...ledger.filter((row) => row.type === "seal"), ...day].map((row) => (row as { homeWinProbability: number }).homeWinProbability),
    );
    return { generatedAt: state.generatedAt, via, probabilities, view, status, days: day.length, rows: ledger.length };
  };
  /** A later render, after the head cache (15 s) and the failed-commit pause (15 s). */
  const later = () => {
    vi.setSystemTime(Date.now() + 16_000);
    render.next();
  };
  return { site, page, later, p };
}

const fetched = (requests: string[], commit: string) =>
  requests.filter((url) => url.startsWith(`/${commit}/`)).map((url) => url.replace(`/${commit}/data/live/`, ""));

describe("one complete snapshot per render", () => {
  it("reads every file from one pinned network commit", async () => {
    const { page } = await serve({ [A]: publication("2026-11-06T07:50:00Z", 0.111) }, A);
    const view = await page();
    expect(view).toMatchObject({ generatedAt: "2026-11-06T07:50:00Z", via: "network", view: { fromEtDate: "2026-11-05" } });
    expect(view.status).toMatchObject({ source: "network", commit: A, head: A, problem: null });
    expect([...view.probabilities]).toEqual([0.111]);
    expect(view.days).toBeGreaterThan(0);
  });

  it.each([MONTH, DAY, VIEW, "state.json"])(
    "with no earlier snapshot, selects the whole bundle when %s fails",
    async (failing) => {
      const { site, page } = await serve({ [A]: publication("2026-11-06T07:50:00Z", 0.111) }, A);
      site.faults[`${A}:${failing}`] = "down";
      const view = await page();
      expect(fetched(site.requests, A)).toContain("state.json");
      expect(view.generatedAt).toBe(BUNDLED.generatedAt);
      expect(view.via).toBe("bundled");
      expect(view.probabilities.has(0.111)).toBe(false);
      expect(view.rows).toBeGreaterThan(0);
      expect(view.days).toBeGreaterThan(0);
      expect(view.view).toBeNull();
      expect(view.status).toMatchObject({ source: "bundled", commit: null, head: A, problem: expect.stringContaining(failing) });
    },
  );

  it("rejects an artifact that matches its manifest hash but does not validate", async () => {
    const broken = publication("2026-11-06T07:50:00Z", 0.111, { [MONTH]: "{}" });
    const { page } = await serve({ [A]: broken }, A);
    expect(await page()).toMatchObject({ via: "bundled", generatedAt: BUNDLED.generatedAt });
  });

  it("retries a read once, so one dropped request does not cost the snapshot", async () => {
    const { site, page } = await serve({ [A]: publication("2026-11-06T07:50:00Z", 0.111) }, A);
    site.faults[`${A}:${MONTH}`] = { flaky: 1 };
    expect(await page()).toMatchObject({ via: "network", generatedAt: "2026-11-06T07:50:00Z" });
    expect(fetched(site.requests, A).filter((file) => file === MONTH)).toHaveLength(2);
  });

  it("ignores artifacts this deployment does not read, even unreadable ones", async () => {
    const extra = { [`site/${LABEL}/future-view.json`]: "not json", "site/other/thing.json": "{}" };
    const { site, page } = await serve({ [A]: publication("2026-11-06T07:50:00Z", 0.111, extra) }, A);
    site.faults[`${A}:site/${LABEL}/future-view.json`] = "down";
    expect(await page()).toMatchObject({ via: "network", generatedAt: "2026-11-06T07:50:00Z" });
    expect(fetched(site.requests, A)).not.toContain(`site/${LABEL}/future-view.json`);
  });
});

describe("after a complete snapshot", () => {
  it("downloads only the artifacts whose hash changed at the next commit", async () => {
    const before = publication("2026-11-06T07:50:00Z", 0.111);
    const after = publication("2026-11-06T08:00:00Z", 0.111);
    const { site, page, later } = await serve({ [A]: before, [B]: after }, A);
    await page();
    site.head = B;
    later();
    expect(await page()).toMatchObject({ via: "network", generatedAt: "2026-11-06T08:00:00Z" });
    expect(fetched(site.requests, B).sort()).toEqual(["site/manifest.json", "state.json"]);
  });

  it.each([MONTH, DAY, VIEW, "state.json"])(
    "keeps the last complete snapshot, not a mix, when %s fails at the new head",
    async (failing) => {
      const { site, page, later } = await serve(
        { [A]: publication("2026-11-06T07:50:00Z", 0.111), [B]: publication("2026-11-06T08:00:00Z", 0.222, { [VIEW]: NEXT_VIEW }) },
        A,
      );
      await page();
      site.head = B;
      site.faults[`${B}:${failing}`] = "down";
      later();
      const view = await page();
      expect(view).toMatchObject({ via: "network", generatedAt: "2026-11-06T07:50:00Z", view: { fromEtDate: "2026-11-05" } });
      expect([...view.probabilities]).toEqual([0.111]);
      expect(view.status).toMatchObject({ source: "network", commit: A, head: B, problem: expect.stringContaining(failing) });

      // The fault clears: the next render after the pause shows the new head, all of it.
      delete site.faults[`${B}:${failing}`];
      later();
      const healed = await page();
      expect(healed).toMatchObject({ via: "network", generatedAt: "2026-11-06T08:00:00Z", view: { fromEtDate: "2026-11-06" } });
      expect([...healed.probabilities]).toEqual([0.222]);
      expect(healed.status).toMatchObject({ commit: B, head: B, problem: null });
    },
  );

  it("does not download a failing commit again on every render", async () => {
    const { site, page, later } = await serve(
      { [A]: publication("2026-11-06T07:50:00Z", 0.111), [B]: publication("2026-11-06T08:00:00Z", 0.222) },
      A,
    );
    await page();
    site.head = B;
    site.faults[`${B}:${MONTH}`] = "down";
    later();
    await page();
    const tries = fetched(site.requests, B).filter((file) => file === MONTH).length;
    vi.setSystemTime(Date.now() + 5_000);
    render.next();
    expect(await page()).toMatchObject({ generatedAt: "2026-11-06T07:50:00Z" });
    expect(fetched(site.requests, B).filter((file) => file === MONTH)).toHaveLength(tries);
  });

  it("keeps the last complete snapshot when the head cannot be resolved", async () => {
    const { site, page, later } = await serve({ [A]: publication("2026-11-06T07:50:00Z", 0.111) }, A);
    await page();
    site.refsDown = true;
    later();
    const view = await page();
    expect(view).toMatchObject({ via: "network", generatedAt: "2026-11-06T07:50:00Z" });
    expect(view.status).toMatchObject({ commit: A, head: null, problem: expect.stringContaining("unknown") });
  });
});

describe("the health endpoint's reader", () => {
  it("selects once per response, without React memoization", async () => {
    const { site, p } = await serve({ [A]: publication("2026-11-06T07:50:00Z", 0.111) }, A);
    render.memoize = false;
    site.faults[`${A}:state.json`] = "down";
    const snapshot = await p.getLiveHealthSnapshot();
    expect(snapshot.liveState.generatedAt).toBe(BUNDLED.generatedAt);
    expect(snapshot.data).toMatchObject({ source: "bundled", state: "bundled", games: "bundled", head: A });
    expect(snapshot.games.length).toBeGreaterThan(0);
  });
});
