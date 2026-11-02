import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
