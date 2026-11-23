import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config({ ignores: ["dist", "node_modules", "supabase/functions", "public"] }, js.configs.recommended, ...tseslint.configs.recommended, {
  rules: {
    "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
    eqeqeq: ["error", "always"],
    "no-console": "error",
  },
},
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly", fetch: "readonly", setTimeout: "readonly" },
    },
    rules: { "no-console": "off", "preserve-caught-error": "off" },
  },
);
