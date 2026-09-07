import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // New react-hooks rules (React compiler era) flag pre-existing patterns in the
    // tool pages. Real fixes are tracked as M1 debt in docs/dev-platform/status.md;
    // keep them visible as warnings, not gate failures.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/static-components": "warn",
    },
  },
  {
    // Tests exercise internals; `any` is acceptable ergonomics there.
    files: ["**/*.test.ts", "**/*.spec.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prototype sandbox (HTML drafts + CommonJS test rigs); not shipped product code.
    "drafts/**",
  ]),
]);

export default eslintConfig;
