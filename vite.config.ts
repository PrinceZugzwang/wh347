import preact from "@preact/preset-vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // GitHub Pages serves the site from /wh347/; other hosts use the root.
  base: process.env.BASE_PATH ?? "/",
  plugins: [preact()],
  build: {
    // One shared script bundle instead of six small ones: on a slow connection
    // each extra file costs a round trip.
    rollupOptions: {
      output: {
        advancedChunks: {
          groups: [
            {
              name: "app",
              test: /[\\/]src[\\/](ui|core[\\/](?!render)|pro[\\/](config|model))|[\\/]node_modules[\\/](preact|@fontsource)/,
            },
          ],
        },
      },
      input: [
        "index.html",
        "privacy.html",
        "terms.html",
        "certified-payroll-excel-template.html",
        "primes.html",
        "dol-fillable-wh347-vs-easywh347.html",
        "lcptracker-vs-easywh347.html",
        "payroll.html",
        "start.html",
        "records.html",
        "wage-determination.html",
        "lcptracker-payroll.html",
      ],
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
