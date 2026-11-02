import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Day, game, team and record pages read the games store and the ledger with fs;
  // trace both into every server bundle so ISR re-renders can read them too.
  outputFileTracingIncludes: {
    "/**": ["./data/live/games/*.json", "./data/live/ledger/*.jsonl"],
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
