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
];

export default eslintConfig;
