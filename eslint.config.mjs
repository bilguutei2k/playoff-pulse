import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      ".vercel/**",
      "design-reference/claude-export/**",
    ],
  },
  ...nextVitals,
  ...nextTypeScript,
];

export default eslintConfig;
