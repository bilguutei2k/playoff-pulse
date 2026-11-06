import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
// Reproduce React's per-render memoization in this non-React test harness.
vi.mock("react", () => ({ cache: (fn: (...args: unknown[]) => unknown) => {
  const calls = new Map<string, unknown>();
  return (...args: unknown[]) => {
    const key = JSON.stringify(args);
    if (!calls.has(key)) calls.set(key, fn(...args));
    return calls.get(key);
  };
} }));

let server: Server | undefined;
afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve());
  server = undefined;
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function fixture(fail?: string, malformed = false) {
  vi.resetModules();
  const state = JSON.parse(readFileSync("data/live/state.json", "utf8"));
  const originalStamp = state.generatedAt;
  state.generatedAt = "2026-11-05T19:55:00Z";
  const manifest = JSON.parse(readFileSync("data/live/site/manifest.json", "utf8"));
  const files: Record<string, string> = {};
  for (const relative of Object.keys(manifest.files)) files[relative] = readFileSync(`data/live/${relative}`, "utf8");
  files["state.json"] = JSON.stringify(state);
  const view = `site/${state.seasonLabel}/projections.json`;
  files[view] = JSON.stringify({ version: 1, seasonLabel: state.seasonLabel, fromEtDate: "2026-11-05", games: [] });
  if (fail && malformed) files[fail] = "{}";
  manifest.files = Object.fromEntries(Object.entries(files).map(([key, value]) => [key, createHash("sha256").update(value).digest("hex")]));
  const commit = "d".repeat(40);
  const requests: string[] = [];
  server = createServer((req, res) => {
    const url = req.url ?? "";
    requests.push(url);
    if (url === "/refs") return res.end(`${commit} refs/heads/live-data\n`);
    const relative = url.replace(`/${commit}/data/live/`, "");
    if (relative === fail && !malformed) { res.statusCode = 503; return res.end("unavailable"); }
    if (relative === "site/manifest.json") return res.end(JSON.stringify(manifest));
    if (files[relative]) return res.end(files[relative]);
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test port");
  vi.stubEnv("LIVE_DATA_BASE_URL", `http://127.0.0.1:${address.port}`);
  vi.stubEnv("LIVE_DATA_REFS_URL", `http://127.0.0.1:${address.port}/refs`);
  vi.stubEnv("LIVE_DATA_SOURCE", "network");
  return { published: await import("@/lib/live-data/published"), originalStamp, requests, commit, view };
}

describe("atomic published snapshot", () => {
  it("uses one pinned complete network snapshot", async () => {
    const { published: p, commit } = await fixture();
    expect((await p.getLiveState()).generatedAt).toBe("2026-11-05T19:55:00Z");
    expect(await p.getLiveDataStatus()).toMatchObject({ source: "network", state: "network", games: "network", commit });
    expect(await p.getProjections()).not.toBeNull();
    expect((await p.getSeasonLedger()).length).toBeGreaterThan(0);
  });
  it.each([
    "site/2026-27/months/2026-11.json",
    "site/2026-27/days/2026-11-02.json",
    "site/2026-27/projections.json",
    "state.json",
  ])("selects the whole bundle when %s fails, even with state fetched", async (failed) => {
    const { published: p, originalStamp, requests, commit } = await fixture(failed);
    const [state, source, ledger, day] = await Promise.all([
      p.getLiveState(), p.getLiveStateSource(), p.getSeasonLedger(), p.getDaySeals("2026-11-02"),
    ]);
    expect(requests).toContain(`/${commit}/data/live/state.json`);
    expect(state.generatedAt).toBe(originalStamp);
    expect(source).toBe("bundled");
    expect(await p.getLiveDataStatus()).toMatchObject({ source: "bundled", state: "bundled", games: "bundled", commit: null });
    expect(ledger.length).toBeGreaterThan(0);
    expect(day.length).toBeGreaterThan(0);
    expect(await p.getProjections()).toBeNull();
  });
  it("also rejects an invalid artifact whose manifest hash matches", async () => {
    const { published: p, originalStamp } = await fixture("site/2026-27/months/2026-11.json", true);
    expect((await p.getLiveState()).generatedAt).toBe(originalStamp);
    expect(await p.getLiveStateSource()).toBe("bundled");
  });
});
