import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pages read main's data/live over the network at render time
  // (src/lib/live-data/published.ts). The copies traced here are the fallback when GitHub
  // cannot be read: the games store and the ledger, from which the day and month files are
  // rebuilt. state.json is imported, so it is bundled anyway.
  outputFileTracingIncludes: {
    // Seals written before `driversComplete` (early November 2026) kept three drivers a
    // side; their full lists are rebuilt from that day's stored report, read only from this
    // bundled copy. Later seals list everyone, so later days' reports are not needed.
    "/**": [
      "./data/live/games/*.json",
      "./data/live/ledger/*.jsonl",
      "./data/live/reports/2026-27/2026-11-0*.json",
    ],
    "/teams/**": ["./data/season/games/*.json"],
  },
  async redirects() {
    return [
      // The live forecast moved to the homepage in the November 2026 redesign.
      { source: "/live", destination: "/", permanent: true },
      { source: "/live/methodology", destination: "/how-it-works", permanent: true },
      // The 2026 retrospective narrative moved from "/" to "/retrospective".
      { source: "/case-study", destination: "/retrospective", permanent: true },
    ];
  },
};

export default nextConfig;
