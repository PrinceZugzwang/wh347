import preact from "@preact/preset-vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // GitHub Pages serves the site from /wh347/; other hosts use the root.
  base: process.env.BASE_PATH ?? "/",
  plugins: [preact()],
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
