/* global AbortSignal */
/**
 * Checks whether each certified-payroll filing portal answers, and appends the
 * result to a rolling 7-day history. Run every 15 minutes by
 * .github/workflows/portal-status.yml, which publishes status.json on the
 * `status` branch for the public status page.
 *
 * It only loads each portal's public login page. It can't tell whether
 * logging in or uploading works, and the page says so.
 *
 *   node scripts/portal-check.mjs path/to/status.json
 */
import { readFileSync, writeFileSync } from "node:fs";

export const PORTALS = [
  { id: "ca-ecpr", name: "California DIR eCPR", area: "California", url: "https://efiling.dir.ca.gov/eCPR/" },
  { id: "ca-pwcr", name: "California DIR contractor registration", area: "California", url: "https://efiling.dir.ca.gov/PWCR/" },
  { id: "lcptracker", name: "LCPtracker", area: "Many agencies", url: "https://prod.lcptracker.net/" },
  { id: "ny-mpwr", name: "New York certified payroll (MPWR)", area: "New York", url: "https://mpwr-public.labor.ny.gov/en/login" },
  { id: "nj-wagehub", name: "New Jersey Wage Hub", area: "New Jersey", url: "https://njwages.nj.gov/" },
  {
    id: "il-ctp",
    name: "Illinois Certified Transcript of Payroll",
    area: "Illinois",
    url: "https://webapps.illinois.gov/DOL/PayrollCertification/",
  },
  { id: "wa-pwic", name: "Washington L&I prevailing wage", area: "Washington", url: "https://secure.lni.wa.gov/pwic/" },
  { id: "sam-wd", name: "SAM.gov wage determinations", area: "Federal", url: "https://sam.gov/" },
];

const SLOW_MS = 8000;
const TIMEOUT_MS = 20000;
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

async function check(portal) {
  const start = Date.now();
  try {
    const res = await fetch(portal.url, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": "EasyWH347 portal status (https://easywh347.com/portal-status.html)" },
    });
    await res.arrayBuffer();
    const ms = Date.now() - start;
    // A login page may answer 401/403 to a script; it is still up. 5xx means the server is failing.
    const s = res.status >= 500 ? "down" : ms > SLOW_MS ? "slow" : "up";
    return { s, ms, code: res.status };
  } catch (e) {
    return { s: "down", ms: Date.now() - start, code: 0, err: String(e?.name ?? e).slice(0, 40) };
  }
}

const file = process.argv[2] ?? "status.json";
let prev = {};
try {
  prev = JSON.parse(readFileSync(file, "utf8"));
} catch {
  prev = {};
}

const now = Date.now();
const results = await Promise.all(PORTALS.map(check));
const portals = PORTALS.map((p, i) => {
  const old = prev.portals?.find((x) => x.id === p.id)?.history ?? [];
  const history = [...old, { t: now, ...results[i] }].filter((h) => now - h.t < KEEP_MS);
  return { ...p, history };
});

writeFileSync(file, JSON.stringify({ checkedAt: now, portals }));
for (const p of portals) console.log(`${p.history.at(-1).s.padEnd(5)} ${String(p.history.at(-1).ms).padStart(6)}ms ${p.name}`);
