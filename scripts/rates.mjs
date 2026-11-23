// Builds the public rate pages from SAM.gov's Davis-Bacon wage determinations.
//
//   RATE_STATES=MN,CA node scripts/rates.mjs
//
// Writes into public/rates/ (generated, not committed): a page per wage
// determination, a page per county, a page per state, the plain text each
// determination is published as (so the form can load it), and a sitemap.
// Runs before every deploy and weekly, because DOL publishes changes on Fridays.

import { mkdir, rm, writeFile } from "node:fs/promises";
import { countySlug, parseWageDetermination } from "./wd-parse.mjs";

const STATES = (process.env.RATE_STATES ?? "MN,CA")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const OUT = "public/rates";
const SITE = "https://easywh347.com";
const API = "https://sam.gov/api/prod";
const HEADERS = { accept: "application/hal+json", "user-agent": "EasyWH347 rate pages (support@easywh347.com)" };
const SUPABASE_URL = "https://xianpoudlasueezkatwl.supabase.co";
const SUPABASE_KEY = "sb_publishable_ERJzVioIm75PsF1Caxz2RQ_1UNmALPe";

const STATE_NAMES = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
};

// States with their own prevailing wage law, where state-funded jobs use the state's rates instead.
const STATE_LAW = {
  CA: { agency: "the California Department of Industrial Relations", url: "https://www.dir.ca.gov/oprl/dprewagedetermination.htm" },
  MN: { agency: "the Minnesota Department of Labor and Industry", url: "https://dli.mn.gov/prevailing-wage" },
};

const TRADES = [
  "Electrician",
  "Plumber",
  "Pipefitter",
  "Carpenter",
  "Laborer",
  "Operating engineer",
  "Ironworker",
  "Welder",
  "Painter",
  "Other",
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const today = new Date().toISOString().slice(0, 10);
const longDate = (mdy) => {
  const [m, d, y] = mdy.split("/").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.ok) return await res.json();
      if (res.status === 404) return null;
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (attempt >= 4) throw new Error(`${url}: ${err.message}`);
      await sleep(1000 * attempt);
    }
  }
}

async function listState(state) {
  const items = [];
  for (let page = 0; page < 50; page++) {
    const j = await getJson(`${API}/sgs/v1/search/?index=dbra&page=${page}&size=100&mode=search&is_active=true&state=${state}`);
    const batch = j?._embedded ? Object.values(j._embedded)[0] : [];
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** Rates that changed between the previous modification and this one. */
function changes(prev, cur) {
  if (!prev) return [];
  const before = new Map(prev.rates.map((r) => [r.classification, r]));
  const after = new Map(cur.rates.map((r) => [r.classification, r]));
  const out = [];
  for (const [name, r] of after) {
    const p = before.get(name);
    if (!p) out.push({ name, kind: "added", text: `$${r.base} + ${r.fringe}` });
    else if (p.base !== r.base || p.fringe !== r.fringe)
      out.push({ name, kind: "changed", text: `$${p.base} + ${p.fringe} → $${r.base} + ${r.fringe}` });
  }
  for (const name of before.keys()) if (!after.has(name)) out.push({ name, kind: "removed", text: "" });
  return out;
}

const HEAD = (title, description, path) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <link rel="canonical" href="${SITE}${path}" />
    <meta name="description" content="${esc(description)}" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/rates-assets/rates.css" />
    <script async src="https://plausible.io/js/pa-LsqnZrZ_AWqSKRzTcPYEM.js"></script>
    <script>window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)};plausible.init=plausible.init||function(i){plausible.o=i||{}};plausible.init();</script>
    <script defer src="/rates-assets/rates.js"></script>
  </head>
  <body>
    <header class="site"><a href="/">EasyWH347</a><nav><a href="/rates/">Prevailing wage rates</a><a href="/">Fill in a WH&#8209;347</a></nav></header>
    <main>`;

const FOOT = `
    </main>
    <footer class="site">
      <p>
        Rates are copied from the U.S. Department of Labor's wage determinations on SAM.gov and checked weekly; the determination in your
        contract is the one that applies. Last checked ${longDate(today.slice(5, 7) + "/" + today.slice(8) + "/" + today.slice(0, 4))}.
        EasyWH347 is an independent tool and is not affiliated with the U.S. Department of Labor.
      </p>
      <p><a href="/wage-determination.html">How to find your wage determination</a> · <a href="/lcptracker-payroll.html">Entering payroll in LCPtracker</a> · <a href="/privacy.html">Privacy</a> · support@easywh347.com</p>
    </footer>
  </body>
</html>
`;

function alertForm(ctx) {
  return `
      <form class="alert" data-alert data-supabase="${SUPABASE_URL}" data-key="${SUPABASE_KEY}" data-wd="${esc(ctx.wd ?? "")}" data-state="${esc(ctx.state)}" data-county="${esc(ctx.county ?? "")}">
        <h2>Email me when these rates change</h2>
        <p>DOL changes wage determinations on Fridays. We'll email you when a rate here changes, and nothing else.</p>
        <div class="alert-fields">
          <label>Email<input type="email" name="email" autocomplete="email" required /></label>
          <label>Your trade<select name="trade" required><option value="">Choose one</option>${TRADES.map((t) => `<option>${t}</option>`).join("")}</select></label>
          <label>Field workers<select name="crew" required><option value="">Choose one</option><option>1-4</option><option>5-9</option><option>10-19</option><option>20-49</option><option>50+</option></select></label>
          <button type="submit">Email me</button>
        </div>
        <p class="alert-status" role="status"></p>
      </form>`;
}

function wdPage(state, wd, parsed, counties, delta) {
  const name = STATE_NAMES[state];
  const types = wd.constructionTypes.join(", ");
  const countyNames = counties.map((c) => c.value);
  const shortWhere =
    countyNames.length <= 3
      ? `${countyNames.join(", ")} ${countyNames.length === 1 ? "County" : "Counties"}`
      : `${countyNames.length} counties`;
  const latest = parsed.mods.at(-1);
  const path = `/rates/${state.toLowerCase()}/${wd.fullReferenceNumber.toLowerCase()}.html`;
  const title = `${shortWhere}, ${state} ${types.toLowerCase()} prevailing wage rates (${wd.fullReferenceNumber})`;
  const description = `Davis-Bacon base rates and fringe benefits for ${parsed.rates.length} classifications on ${types.toLowerCase()} projects in ${shortWhere}, ${name}. Wage determination ${wd.fullReferenceNumber}, modification ${latest?.number ?? 0}. Checked weekly.`;
  const law = STATE_LAW[state];
  return {
    path,
    html: `${HEAD(title, description, path)}
      <p class="crumbs"><a href="/rates/">Rates</a> / <a href="/rates/${state.toLowerCase()}/">${name}</a> / ${esc(wd.fullReferenceNumber)}</p>
      <h1>${esc(shortWhere)}, ${name}: ${esc(types)} rates</h1>
      <p class="lede">Davis-Bacon wage determination <b>${esc(wd.fullReferenceNumber)}</b>, modification ${latest?.number ?? 0}, published ${latest ? longDate(latest.date) : ""}. ${parsed.rates.length} classifications, each with the minimum base rate and fringe benefit per hour.</p>

      <div class="actions">
        <a class="button" href="/?wd=${esc(wd.fullReferenceNumber)}" data-track="Rates check">Check your payroll against these rates</a>
        <p>Opens the free WH&#8209;347 form with these rates loaded. Every worker is checked as you type. Nothing is uploaded.</p>
      </div>
${
  delta.length
    ? `
      <h2>What changed in modification ${latest?.number}</h2>
      <ul class="changes">${delta
        .slice(0, 40)
        .map(
          (d) =>
            `<li><b>${esc(d.name)}</b>: ${d.kind === "changed" ? esc(d.text) : d.kind === "added" ? `added at ${esc(d.text)}` : "removed"}</li>`,
        )
        .join("")}${delta.length > 40 ? `<li>and ${delta.length - 40} more</li>` : ""}</ul>`
    : ""
}
      <h2>Rates</h2>
      <div class="table-wrap"><table class="rates">
        <thead><tr><th>Classification</th><th class="num">Base rate</th><th class="num">Fringe</th></tr></thead>
        <tbody>${parsed.rates
          .map(
            (r) =>
              `<tr><td>${esc(r.classification)}</td><td class="num">$${esc(r.base)}</td><td class="num">${/^[\d.]+$/.test(r.fringe) ? "$" + esc(r.fringe) : esc(r.fringe)}</td></tr>`,
          )
          .join("")}</tbody>
      </table></div>
      <p class="note">Fringe can be paid into a bona fide benefit plan (column 6B on the WH&#8209;347), in cash (6C), or a mix. A percentage fringe is a share of the base rate.</p>
${alertForm({ wd: wd.fullReferenceNumber, state, county: countyNames.length === 1 ? countyNames[0] : "" })}

      <h2>Counties</h2>
      <p class="counties">${counties.map((c) => `<a href="/rates/${state.toLowerCase()}/${countySlug(c.value, state)}.html">${esc(c.value)}</a>`).join(" · ")}</p>
${law ? `\n      <p class="note">${name} also has its own prevailing wage law. On projects paid for only with state or local money, the rates come from ${law.agency}, not this federal determination. <a href="${law.url}">State rates</a>.</p>` : ""}
      <details class="official">
        <summary>The full wage determination, as published</summary>
        <pre>${esc(parsed.text)}</pre>
      </details>
      <p class="note">Source: <a href="https://sam.gov/wage-determination/${esc(wd.fullReferenceNumber)}/${wd.revisionNumber}">${esc(wd.fullReferenceNumber)} on SAM.gov</a>. Use the determination named in your contract; when it was included is set by 29 CFR 1.6. See <a href="/wage-determination.html">how to find yours</a>.</p>
${FOOT}`,
  };
}

function countyPage(state, county, entries) {
  const name = STATE_NAMES[state];
  const slug = countySlug(county, state);
  const path = `/rates/${state.toLowerCase()}/${slug}.html`;
  const label = state === "LA" ? `${county} Parish` : /city|borough/i.test(county) ? county : `${county} County`;
  const title = `${label}, ${name} prevailing wage rates (Davis-Bacon, ${new Date().getFullYear()})`;
  const byType = {};
  for (const e of entries) for (const t of e.wd.constructionTypes) (byType[t] ??= []).push(e);
  const order = ["Building", "Heavy", "Highway", "Residential"];
  const pick = (e, re) => e.parsed.rates.find((r) => re.test(r.classification));
  const law = STATE_LAW[state];
  return {
    path,
    html: `${HEAD(title, `Current Davis-Bacon prevailing wage rates for ${label}, ${name}: building, heavy, highway and residential construction. Base rates and fringe for every trade, checked weekly.`, path)}
      <p class="crumbs"><a href="/rates/">Rates</a> / <a href="/rates/${state.toLowerCase()}/">${name}</a> / ${esc(label)}</p>
      <h1>Prevailing wage rates in ${esc(label)}, ${name}</h1>
      <p class="lede">Federal Davis-Bacon rates for ${esc(label)} come from ${entries.length} wage determination${entries.length === 1 ? "" : "s"}, by type of construction. Pick the one in your contract.</p>
${[...new Set(order.flatMap((t) => byType[t] ?? []))]
  .map((e) => {
    const types = order.filter((t) => e.wd.constructionTypes.includes(t)).join(" and ");
    const samples = [/^ELECTRICIAN/, /^PLUMBER/, /^CARPENTER/, /^LABORER/].map((re) => pick(e, re)).filter(Boolean);
    const href = `/rates/${state.toLowerCase()}/${e.wd.fullReferenceNumber.toLowerCase()}.html`;
    return `
      <section class="wd-card">
        <h2>${types}: <a href="${href}">${esc(e.wd.fullReferenceNumber)}</a></h2>
        <p class="note">Modification ${e.parsed.mods.at(-1)?.number ?? 0}, ${e.parsed.rates.length} classifications.</p>
        ${samples.length ? `<table class="rates"><tbody>${samples.map((r) => `<tr><td>${esc(r.classification)}</td><td class="num">$${esc(r.base)}</td><td class="num">${esc(r.fringe)}</td></tr>`).join("")}</tbody></table>` : ""}
        <p><a href="${href}">All ${e.parsed.rates.length} rates</a> · <a href="/?wd=${esc(e.wd.fullReferenceNumber)}" data-track="Rates check">Check your payroll against them</a></p>
      </section>`;
  })
  .join("")}
${alertForm({ state, county })}
${law ? `\n      <p class="note">${name} also has its own prevailing wage law. On projects paid for only with state or local money, the rates come from ${law.agency}. <a href="${law.url}">State rates</a>.</p>` : ""}
${FOOT}`,
  };
}

function statePage(state, counties, wds) {
  const name = STATE_NAMES[state];
  const path = `/rates/${state.toLowerCase()}/`;
  return {
    path,
    html: `${HEAD(`${name} prevailing wage rates by county (Davis-Bacon, ${new Date().getFullYear()})`, `Davis-Bacon prevailing wage rates for every county in ${name}, from the Department of Labor's ${wds.length} current wage determinations. Checked weekly.`, path)}
      <p class="crumbs"><a href="/rates/">Rates</a> / ${name}</p>
      <h1>${name} prevailing wage rates</h1>
      <p class="lede">The Department of Labor has ${wds.length} current Davis-Bacon wage determinations for ${name}, covering ${counties.length} counties. Choose your county.</p>
      <p class="county-index">${counties.map((c) => `<a href="/rates/${state.toLowerCase()}/${countySlug(c, state)}.html">${esc(c)}</a>`).join("")}</p>
${alertForm({ state })}
${FOOT}`,
  };
}

function indexPage(states) {
  const path = "/rates/";
  return {
    path,
    html: `${HEAD("Prevailing wage rates by state and county (Davis-Bacon)", "Current Davis-Bacon prevailing wage rates by state and county, from the Department of Labor's wage determinations, checked weekly.", path)}
      <h1>Prevailing wage rates</h1>
      <p class="lede">Current Davis-Bacon rates from the Department of Labor's wage determinations, by state and county, checked every week. More states are being added.</p>
      <ul class="state-list">${states.map((s) => `<li><a href="/rates/${s.toLowerCase()}/">${STATE_NAMES[s]}</a></li>`).join("")}</ul>
${FOOT}`,
  };
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  const pages = [];
  const done = [];

  for (const state of STATES) {
    const list = await listState(state);
    if (list.length === 0) {
      console.warn(`${state}: no wage determinations returned`);
      continue;
    }
    const entries = await mapLimit(list, 4, async (wd) => {
      const cur = await getJson(`${API}/wdol/v1/wd/${wd.fullReferenceNumber}/${wd.revisionNumber}`);
      const prev = wd.revisionNumber > 0 ? await getJson(`${API}/wdol/v1/wd/${wd.fullReferenceNumber}/${wd.revisionNumber - 1}`) : null;
      const text = String(cur?.document ?? "").replace(/^"|"$/g, "");
      const parsed = { ...parseWageDetermination(text), text };
      const before = prev ? parseWageDetermination(String(prev.document ?? "")) : null;
      return { wd, parsed, delta: changes(before, parsed) };
    });

    await mkdir(`${OUT}/${state.toLowerCase()}`, { recursive: true });
    await mkdir(`${OUT}/wd`, { recursive: true });
    const byCounty = new Map();
    for (const e of entries) {
      const counties = e.wd.location?.state?.counties ?? [];
      pages.push(wdPage(state, e.wd, e.parsed, counties, e.delta));
      // One line per classification, in the layout the form's rate check reads.
      const lines = e.parsed.rates.map((r) => `${r.classification} $ ${r.base}   ${r.fringe}`);
      await writeFile(`${OUT}/wd/${e.wd.fullReferenceNumber}.txt`, `${lines.join("\n")}\n`);
      for (const c of counties) {
        if (!byCounty.has(c.value)) byCounty.set(c.value, []);
        byCounty.get(c.value).push(e);
      }
    }
    const countyNames = [...byCounty.keys()].sort((a, b) => a.localeCompare(b));
    for (const c of countyNames) pages.push(countyPage(state, c, byCounty.get(c)));
    pages.push(statePage(state, countyNames, list));
    done.push(state);
    console.log(`${state}: ${list.length} wage determinations, ${countyNames.length} counties`);
  }

  if (done.length === 0) {
    console.warn("No rate pages generated.");
    return;
  }
  pages.push(indexPage(done));
  for (const p of pages) {
    const file = p.path.endsWith("/") ? `public${p.path}index.html` : `public${p.path}`;
    await mkdir(file.slice(0, file.lastIndexOf("/")), { recursive: true });
    await writeFile(file, p.html);
  }
  await writeFile(
    "public/sitemap-rates.xml",
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((p) => `  <url><loc>${SITE}${p.path}</loc><lastmod>${today}</lastmod></url>`).join("\n")}\n</urlset>\n`,
  );
  console.log(`Wrote ${pages.length} pages.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
