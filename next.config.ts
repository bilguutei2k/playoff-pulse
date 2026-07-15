import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/case-study",
        destination: "/",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
