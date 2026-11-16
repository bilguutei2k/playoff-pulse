// The #418 reload harness (QA, not in CI). Rebuilt for the request-time rendering change
// after the PR #23 copy was lost.
//
// What it reproduces: a returning reader's browser runs the cached scripts while the HTML
// is still streaming in, so React starts hydrating before the whole payload has arrived
// (src/components/layout/HydrationGate.tsx and the keyed Fragment in src/app/layout.tsx
// prevent the #418 this used to cause). A local proxy sits in front of `next start` and,
// on every HTML response, pauses the stream once at a random byte offset for 100–800 ms.
// Each engine loads the page once (to warm its script cache), then reloads it N times in
// the same context, counting hydration console errors (#418 and friends, "Hydration
// failed", "did not match") and every pageerror.
//
// Usage (after `corepack pnpm build`):
//   PLAYWRIGHT_CORE_PATH=/path/to/node_modules/playwright-core \
//     node scripts/qa/hydration-reload.mjs [--reloads 500] [--engines chromium,webkit,firefox]
//       [--paths /,/teams/bos] [--base http://127.0.0.1:3000] [--bundled]
//       [--pause-min 100] [--pause-max 800] [--settle 250]
//       [--chromium-exe <path>] [--webkit-exe <path>] [--firefox-exe <path>]
// Without --base it starts `next start` itself on a free port (with --bundled, on the
// bundled data copy) and stops it by PID. Executables can also come from CHROMIUM_EXE,
// WEBKIT_EXE and FIREFOX_EXE; without one, playwright-core's own browser for that engine
// is used, which must match the playwright-core version. playwright-core is not a
// dependency of this repository: install it somewhere else and point PLAYWRIGHT_CORE_PATH
// at it. Exit code 1 when any engine saw a hydration error or a pageerror.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const ENGINES = ["chromium", "webkit", "firefox"];
const HYDRATION = /#418|#419|#421|#422|#423|#425|hydrat|did not match|server rendered html/i;

function parseArgs(argv) {
  const options = {
    reloads: 500,
    engines: ENGINES,
    paths: ["/"],
    base: null,
    bundled: false,
    pauseMin: 100,
    pauseMax: 800,
    settle: 250,
    exe: { chromium: process.env.CHROMIUM_EXE, webkit: process.env.WEBKIT_EXE, firefox: process.env.FIREFOX_EXE },
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} needs a value`);
      return next;
    };
    if (flag === "--reloads") options.reloads = Number(value());
    else if (flag === "--engines") options.engines = value().split(",").map((engine) => engine.trim());
    else if (flag === "--paths") options.paths = value().split(",").map((route) => route.trim());
    else if (flag === "--base") options.base = value().replace(/\/+$/, "");
    else if (flag === "--bundled") options.bundled = true;
    else if (flag === "--pause-min") options.pauseMin = Number(value());
    else if (flag === "--pause-max") options.pauseMax = Number(value());
    else if (flag === "--settle") options.settle = Number(value());
    else if (/^--(chromium|webkit|firefox)-exe$/.test(flag)) options.exe[flag.slice(2, -4)] = value();
    else if (flag === "--help" || flag === "-h") {
      console.log("See the header of scripts/qa/hydration-reload.mjs for usage.");
      process.exit(0);
    } else throw new Error(`unknown option ${flag}`);
  }
  for (const engine of options.engines) if (!ENGINES.includes(engine)) throw new Error(`unknown engine ${engine}`);
  if (!Number.isInteger(options.reloads) || options.reloads < 1) throw new Error("--reloads must be a positive integer");
  return options;
}

async function loadPlaywright() {
  const from = process.env.PLAYWRIGHT_CORE_PATH;
  try {
    if (from) {
      const entry = existsSync(path.join(from, "index.mjs")) ? path.join(from, "index.mjs") : path.join(from, "index.js");
      const loaded = await import(pathToFileURL(entry).href);
      return loaded.default ?? loaded;
    }
    const loaded = await import("playwright-core");
    return loaded.default ?? loaded;
  } catch (error) {
    console.error(
      "hydration-reload: cannot load playwright-core. It is not a dependency of this repository: install it\n" +
        "outside the repo (e.g. `npm install playwright-core@<version>` in a scratch folder) and set\n" +
        "PLAYWRIGHT_CORE_PATH to that folder's node_modules/playwright-core. Its version must match the\n" +
        "browsers you launch, or pass --<engine>-exe for each.\n" +
        `(${error instanceof Error ? error.message : error})`,
    );
    process.exit(2);
  }
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

async function startNext(bundled) {
  const port = await freePort();
  const env = { ...process.env, PORT: String(port) };
  if (bundled) env.LIVE_DATA_SOURCE = "bundled";
  const bin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [bin, "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (chunk) => (log += chunk));
  child.stderr.on("data", (chunk) => (log += chunk));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next start exited with ${child.exitCode}:\n${log}`);
    try {
      await fetch(`${base}/robots.txt`, { signal: AbortSignal.timeout(2_000) });
      return { base, child, log: () => log };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  stopChild(child);
  throw new Error(`next start did not answer within 60 s:\n${log}`);
}

/** Stops a child by its PID: SIGTERM, then SIGKILL after five seconds. */
async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  process.kill(child.pid, "SIGTERM");
  const timer = setTimeout(() => {
    if (child.exitCode === null) process.kill(child.pid, "SIGKILL");
  }, 5_000);
  await exited;
  clearTimeout(timer);
}

/**
 * A proxy that forwards everything to `upstream` and, on HTML responses, writes the first
 * part of the body, waits, then writes the rest: one pause per document at a random byte
 * offset within the length last seen for that path. Compression is turned off upstream so
 * the offset is a real point in the HTML.
 */
async function startProxy(upstream, { pauseMin, pauseMax }) {
  const target = new URL(upstream);
  const lengths = new Map();
  const stats = { documents: 0, paused: 0 };
  const server = http.createServer((req, res) => {
    const headers = { ...req.headers, host: target.host, "accept-encoding": "identity" };
    const forward = http.request(
      { hostname: target.hostname, port: target.port, path: req.url, method: req.method, headers },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        const html = String(upstreamRes.headers["content-type"] ?? "").includes("text/html");
        if (!html) {
          upstreamRes.pipe(res);
          return;
        }
        stats.documents += 1;
        const key = (req.url ?? "/").split("?")[0];
        const known = lengths.get(key) ?? 100_000;
        let pauseAt = Math.floor(Math.random() * known);
        let seen = 0;
        upstreamRes.on("data", (chunk) => {
          const start = seen;
          seen += chunk.length;
          if (pauseAt < 0 || seen <= pauseAt) {
            res.write(chunk);
            return;
          }
          const split = pauseAt - start;
          pauseAt = -1;
          res.write(chunk.subarray(0, split));
          upstreamRes.pause();
          stats.paused += 1;
          const wait = pauseMin + Math.random() * (pauseMax - pauseMin);
          setTimeout(() => {
            res.write(chunk.subarray(split));
            upstreamRes.resume();
          }, wait);
        });
        // "end" comes only after the paused stream resumed, so the rest is written by then.
        upstreamRes.on("end", () => {
          lengths.set(key, seen);
          res.end();
        });
        upstreamRes.on("error", () => res.destroy());
      },
    );
    forward.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(forward);
  });
  const port = await freePort();
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return { base: `http://127.0.0.1:${port}`, server, stats };
}

async function runEngine(playwright, engine, proxyBase, options) {
  const launchOptions = options.exe[engine] ? { executablePath: options.exe[engine] } : {};
  const browser = await playwright[engine].launch(launchOptions);
  const result = { engine, version: browser.version(), loads: 0, hydration: 0, pageErrors: 0, samples: [] };
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    let current = "";
    const note = (kind, text) => {
      if (result.samples.length < 8) result.samples.push(`${kind} on ${current}: ${text.split("\n")[0].slice(0, 200)}`);
    };
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      if (HYDRATION.test(text)) {
        result.hydration += 1;
        note("console", text);
      }
    });
    page.on("pageerror", (error) => {
      result.pageErrors += 1;
      const text = `${error.name}: ${error.message}`;
      if (HYDRATION.test(text)) result.hydration += 1;
      note("pageerror", text);
    });
    for (const route of options.paths) {
      current = route;
      // The first load warms the script cache; the reloads are the returning reader.
      await page.goto(`${proxyBase}${route}`, { waitUntil: "load" });
      await page.waitForTimeout(options.settle);
      for (let i = 0; i < options.reloads; i++) {
        await page.reload({ waitUntil: "load" });
        await page.waitForTimeout(options.settle);
        result.loads += 1;
        if ((i + 1) % 50 === 0) {
          console.log(`  ${engine} ${route}: ${i + 1}/${options.reloads} reloads, hydration ${result.hydration}, pageerrors ${result.pageErrors}`);
        }
      }
    }
  } finally {
    await browser.close();
  }
  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const playwright = await loadPlaywright();
  if (!options.base && !existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
    console.error("hydration-reload: no production build in .next; run `corepack pnpm build` first, or pass --base.");
    process.exit(1);
  }
  const next = options.base ? null : await startNext(options.bundled);
  const upstream = options.base ?? next.base;
  const proxy = await startProxy(upstream, options);
  console.log(`hydration-reload: ${upstream} through ${proxy.base}, ${options.reloads} reloads per path, paths ${options.paths.join(" ")}`);
  const results = [];
  try {
    for (const engine of options.engines) {
      const started = Date.now();
      try {
        const result = await runEngine(playwright, engine, proxy.base, options);
        result.seconds = Math.round((Date.now() - started) / 1000);
        results.push(result);
      } catch (error) {
        results.push({ engine, error: error instanceof Error ? error.message.split("\n")[0] : String(error) });
      }
    }
  } finally {
    proxy.server.closeAllConnections?.();
    proxy.server.close();
    if (next) await stopChild(next.child);
  }
  console.log(`\nproxy: ${proxy.stats.documents} HTML documents, ${proxy.stats.paused} paused mid-stream`);
  let failed = false;
  for (const result of results) {
    if (result.error) {
      failed = true;
      console.log(`${result.engine}: could not run (${result.error}). Pass --${result.engine}-exe for a browser that matches this playwright-core.`);
      continue;
    }
    if (result.hydration > 0 || result.pageErrors > 0) failed = true;
    console.log(
      `${result.engine} ${result.version}: ${result.loads} reloads in ${result.seconds} s, hydration errors ${result.hydration}, pageerrors ${result.pageErrors}`,
    );
    for (const sample of result.samples) console.log(`  ${sample}`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
