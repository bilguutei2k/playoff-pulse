// verify:routes. Run after `next build`. Starts `next start` twice on a free port and
// checks every page route the way a reader and the watchdog get it:
//
// (a) LIVE_DATA_SOURCE=bundled, no network: every probed route (the masthead nav, the
//     footer, a day page) answers 200 as HTML and as RSC (`RSC: 1`), carries the state
//     stamp and `delivery`, and is `Cache-Control: private` (rendered at request time,
//     never a CDN copy); sample dynamic routes answer 200; the permanent redirects 308;
//     unknown ids and paths 404. No response is a 500, and the server never logs
//     DYNAMIC_SERVER_USAGE (the trap in src/app/layout.tsx).
// (b) The data host failing (LIVE_DATA_REFS_URL and LIVE_DATA_BASE_URL at
//     http://127.0.0.1:9, a port that refuses): a cold server shows the bundled copy, the
//     masthead says `data-state-delivery="stored"`, and /api/live/health answers 503 with
//     `delivery: "stored"`.
//
// Each server is stopped by its PID. Usage: node scripts/verify/route-smoke.mjs

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";

const ROOT = process.cwd();
const NEXT_BIN = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
const START_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 20_000;

// Samples that exist in the bundled copy (main's data/live, frozen at the cutover).
const SAMPLE_DAY = "/games/2026-11-02";
const SAMPLE_GAME = "/game/401909088";
const SAMPLE_TEAM = "/teams/bos";
const SAMPLE_PLAYER = "/players/3112335";

const REDIRECTS = [
  ["/teams/BOS", "/teams/bos"],
  ["/live", "/"],
  ["/live/methodology", "/how-it-works"],
  ["/case-study", "/retrospective"],
];
const NOT_FOUND = ["/teams/XYZ", "/games/1999-01-01", "/games/notadate", "/game/999", "/nope"];

/** The nav's and the footer's hrefs, read from their source so a new route is probed too. */
function probeRoutes() {
  const hrefs = (file, name) => {
    const text = readFileSync(path.join(ROOT, file), "utf8");
    const start = text.indexOf(`export const ${name} = [`);
    if (start < 0) throw new Error(`${name} not found in ${file}`);
    const block = text.slice(start, text.indexOf("];", start));
    return [...block.matchAll(/href:\s*"([^"]+)"/g)].map((match) => match[1]);
  };
  const routes = [
    ...hrefs("src/components/layout/NavLinks.tsx", "NAV_ITEMS"),
    ...hrefs("src/components/layout/SiteFooter.tsx", "FORECAST_LINKS"),
    ...hrefs("src/components/layout/SiteFooter.tsx", "ARCHIVE_LINKS"),
    SAMPLE_DAY,
  ];
  return [...new Set(routes)];
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startServer(env) {
  const port = await freePort();
  const childEnv = { ...process.env, ...env, PORT: String(port) };
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete childEnv[key];
  const child = spawn(process.execPath, [NEXT_BIN, "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: ROOT,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (chunk) => (log += chunk));
  child.stderr.on("data", (chunk) => (log += chunk));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next start exited with ${child.exitCode}:\n${log}`);
    try {
      await fetch(`${base}/robots.txt`, { signal: AbortSignal.timeout(2_000) });
      return { base, child, pid: child.pid, log: () => log };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  await stopServer({ child });
  throw new Error(`next start did not answer within ${START_TIMEOUT_MS / 1000} s:\n${log}`);
}

/** Stops the server by its PID: SIGTERM, then SIGKILL after five seconds. */
async function stopServer({ child }) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  process.kill(child.pid, "SIGTERM");
  const timer = setTimeout(() => {
    if (child.exitCode === null) process.kill(child.pid, "SIGKILL");
  }, 5_000);
  await exited;
  clearTimeout(timer);
}

async function get(base, route, headers = {}) {
  const response = await fetch(`${base}${route}`, {
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return { status: response.status, headers: response.headers, text: await response.text() };
}

const STAMP = /<time[^>]*\bdateTime="([^"]+)"[^>]*\bdata-state-stamp=""[^>]*\bdata-state-delivery="(current|older|stored)"/i;
const RSC_STAMP = /"generatedAt":"([^"]+)"/;
const RSC_DELIVERY = /"delivery":"(current|older|stored)"/;

async function runA(failures) {
  const server = await startServer({ LIVE_DATA_SOURCE: "bundled" });
  const fail = (message) => failures.push(`(a bundled) ${message}`);
  try {
    for (const route of probeRoutes()) {
      const html = await get(server.base, route);
      if (html.status !== 200) fail(`${route} HTML answered ${html.status}, not 200`);
      else if (!STAMP.test(html.text)) fail(`${route} HTML has no <time data-state-stamp data-state-delivery> in the masthead`);
      const htmlCache = html.headers.get("cache-control") ?? "";
      if (!htmlCache.includes("private")) fail(`${route} HTML Cache-Control is "${htmlCache}", not private: it is not rendered at request time`);

      const rsc = await get(server.base, route, { RSC: "1" });
      if (rsc.status !== 200) fail(`${route} RSC answered ${rsc.status}, not 200`);
      else {
        if (!RSC_STAMP.test(rsc.text)) fail(`${route} RSC payload has no "generatedAt"`);
        if (!RSC_DELIVERY.test(rsc.text)) fail(`${route} RSC payload has no "delivery" (FreshnessGuard's prop)`);
      }
      const rscCache = rsc.headers.get("cache-control") ?? "";
      if (!rscCache.includes("private")) fail(`${route} RSC Cache-Control is "${rscCache}", not private`);
    }
    for (const route of [SAMPLE_DAY, SAMPLE_GAME, SAMPLE_TEAM, SAMPLE_PLAYER]) {
      const { status } = await get(server.base, route);
      if (status !== 200) fail(`${route} answered ${status}, not 200`);
    }
    for (const [from, to] of REDIRECTS) {
      const { status, headers } = await get(server.base, from);
      const location = headers.get("location") ?? "";
      if (status !== 308 || !(location === to || location.endsWith(to) || new URL(location, server.base).pathname === to)) {
        fail(`${from} answered ${status} to "${location}", not 308 to ${to}`);
      }
    }
    for (const route of NOT_FOUND) {
      const { status } = await get(server.base, route);
      if (status !== 404) fail(`${route} answered ${status}, not 404`);
    }
    if (/DYNAMIC_SERVER_USAGE/.test(server.log())) {
      fail("the server logged DYNAMIC_SERVER_USAGE: a page or layout exports revalidate, dynamicParams or generateStaticParams");
    }
  } finally {
    await stopServer(server);
  }
}

async function runB(failures) {
  const server = await startServer({
    LIVE_DATA_SOURCE: undefined,
    LIVE_DATA_REFS_URL: "http://127.0.0.1:9/refs",
    LIVE_DATA_BASE_URL: "http://127.0.0.1:9",
  });
  const fail = (message) => failures.push(`(b upstream failing) ${message}`);
  try {
    const home = await get(server.base, "/");
    const match = STAMP.exec(home.text);
    if (home.status !== 200) fail(`/ answered ${home.status}, not 200`);
    else if (!match) fail("/ has no masthead stamp with data-state-delivery");
    else if (match[2] !== "stored") fail(`/ says data-state-delivery="${match[2]}", not "stored"`);
    if (home.status === 200 && !home.text.includes("Stored copy")) fail('/ does not say "Stored copy" in the masthead');

    const health = await get(server.base, "/api/live/health");
    let body = null;
    try {
      body = JSON.parse(health.text);
    } catch {
      fail(`/api/live/health is not JSON (status ${health.status})`);
    }
    if (health.status !== 503) fail(`/api/live/health answered ${health.status}, not 503`);
    if (body && body.delivery !== "stored") fail(`/api/live/health delivery is ${JSON.stringify(body.delivery)}, not "stored"`);
    if (body && body.data?.source !== "bundled") fail(`/api/live/health data.source is ${JSON.stringify(body.data?.source)}, not "bundled"`);
    if (/DYNAMIC_SERVER_USAGE/.test(server.log())) fail("the server logged DYNAMIC_SERVER_USAGE");
  } finally {
    await stopServer(server);
  }
}

async function main() {
  if (!existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
    console.error("verify:routes: no production build in .next; run `corepack pnpm build` first.");
    process.exit(1);
  }
  const failures = [];
  await runA(failures);
  await runB(failures);
  if (failures.length > 0) {
    console.error(`verify:routes failed (${failures.length}):`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(
    `verify:routes passed: ${probeRoutes().length} routes as HTML and RSC, 4 dynamic samples, ${REDIRECTS.length} redirects and ${NOT_FOUND.length} not-found paths on the bundled copy; the stored copy with the data host failing.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
