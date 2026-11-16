// verify:rendering. Run after `next build`. Every page renders at request time
// (`await connection()` in src/app/layout.tsx): a page with a build-time copy is what Vercel
// served for days once its runtime copy expired (`x-vercel-cache: PRERENDER`, 2026-11-14 to
// 16). Two checks:
//
// 1. The build's prerender manifest (.next/prerender-manifest.json) lists only the
//    metadata files that are meant to be static. Any other route, or any dynamic route
//    (a `generateStaticParams` page), is a page or handler that gained a build-time copy.
// 2. No page or layout under src/app exports `revalidate`, `dynamicParams` or
//    `generateStaticParams`. With `connection()` in the layout they make every
//    dynamic-segment URL answer 500 DYNAMIC_SERVER_USAGE while the build passes, so the
//    manifest alone cannot catch them.
//
// Usage: corepack pnpm exec tsx scripts/verify/rendering.ts [--manifest <path>] [--src <dir>]

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Static by design: generated images and robots.txt read no live data. */
const ALLOWED_STATIC_ROUTES = ["/_global-error", "/apple-icon", "/icon", "/opengraph-image", "/robots.txt"];

const FORBIDDEN_EXPORT = /^\s*export\s+(?:const|let|var|async\s+function|function)\s+(revalidate|dynamicParams|generateStaticParams)\b/m;

type Manifest = { routes?: Record<string, unknown>; dynamicRoutes?: Record<string, unknown> };

function manifestProblems(manifest: Manifest): string[] {
  const problems: string[] = [];
  for (const route of Object.keys(manifest.routes ?? {}).sort()) {
    if (ALLOWED_STATIC_ROUTES.includes(route)) continue;
    problems.push(
      `route ${route} was prerendered at build time. Pages and handlers must render at request time: ` +
        `remove any \`revalidate\`/\`dynamic = "force-static"\` export from its file, and for a route handler or ` +
        `metadata route that reads live data call \`await connection()\` (from "next/server") first, as ` +
        `src/app/sitemap.ts does. If it is truly static (reads no live data), add it to ALLOWED_STATIC_ROUTES ` +
        `in scripts/verify/rendering.ts with a reason.`,
    );
  }
  for (const route of Object.keys(manifest.dynamicRoutes ?? {}).sort()) {
    problems.push(
      `dynamic route ${route} has build-time params (generateStaticParams or ISR). Remove \`generateStaticParams\`, ` +
        `\`dynamicParams\` and \`revalidate\` from its page: the root layout's \`await connection()\` renders it on request.`,
    );
  }
  return problems;
}

function pageAndLayoutFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) return pageAndLayoutFiles(full);
    return /^(page|layout)\.(tsx|ts|jsx|js)$/.test(name) ? [full] : [];
  });
}

function sourceProblems(file: string, text: string): string[] {
  const problems: string[] = [];
  const pattern = new RegExp(FORBIDDEN_EXPORT.source, "gm");
  for (const match of text.matchAll(pattern)) {
    problems.push(
      `${file} exports \`${match[1]}\`. Delete it: every page renders at request time (\`await connection()\` in ` +
        `src/app/layout.tsx), and with it this export makes every dynamic-segment URL answer 500 ` +
        `DYNAMIC_SERVER_USAGE while the build still passes.`,
    );
  }
  return problems;
}

function main() {
  const args = process.argv.slice(2);
  const option = (name: string, fallback: string) => {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
  };
  const manifestPath = option("--manifest", path.join(".next", "prerender-manifest.json"));
  const srcApp = option("--src", path.join("src", "app"));

  const problems: string[] = [];
  if (!existsSync(manifestPath)) {
    problems.push(`${manifestPath} not found: run \`corepack pnpm build\` first.`);
  } else {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
    problems.push(...manifestProblems(manifest));
    const routes = Object.keys(manifest.routes ?? {});
    const missing = ALLOWED_STATIC_ROUTES.filter((route) => !routes.includes(route));
    if (missing.length > 0) console.log(`note: allowed static routes not in this build's manifest: ${missing.join(", ")}`);
  }
  const files = pageAndLayoutFiles(srcApp);
  for (const file of files) problems.push(...sourceProblems(file, readFileSync(file, "utf8")));

  if (problems.length > 0) {
    console.error(`verify:rendering failed (${problems.length}):`);
    for (const problem of problems) console.error(`- ${problem}`);
    process.exit(1);
  }
  console.log(`verify:rendering passed: only ${ALLOWED_STATIC_ROUTES.join(", ")} are static; ${files.length} pages and layouts checked.`);
}

main();
