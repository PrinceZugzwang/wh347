/* global URL */
// Writes the homepage's first screen into dist/index.html at build time, so
// visitors see the page before the JavaScript has downloaded. The app then
// renders over the same markup.
import { readFileSync, rmSync, writeFileSync } from "node:fs";

const { prerender } = await import(new URL("../dist-ssr/prerender-entry.js", import.meta.url));
const file = new URL("../dist/index.html", import.meta.url);
const html = readFileSync(file, "utf8");
const marker = '<div id="app"></div>';
if (!html.includes(marker)) throw new Error("index.html has no empty #app to fill");
writeFileSync(file, html.replace(marker, `<div id="app">${prerender()}</div>`));
rmSync(new URL("../dist-ssr", import.meta.url), { recursive: true, force: true });
console.log("prerendered dist/index.html");
