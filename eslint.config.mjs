import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      "**/.next/**",
      ".vercel/**",
      "design-reference/claude-export/**",
      // Nested checkouts, agent scratch space and drafts are not this tree's code.
      ".claude/**",
      ".t3/**",
      "drafts/**",
    ],
  },
  ...nextVitals,
  ...nextTypeScript,
  {
    // Link policy: every in-site link goes through SiteLink, which turns prefetching off
    // (its header comment gives the measured cost of prefetching request-time pages).
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/layout/SiteLink.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/link",
              message: "Import SiteLink from @/components/layout/SiteLink instead: it keeps prefetching off.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
