// Reads a Davis-Bacon wage determination as SAM.gov publishes it (plain text)
// into its modifications and rate lines. Kept free of Node and browser APIs so
// the tests can import it.

const RATE = /^(.*?)[\s.]*\$\s*(\d{1,3}(?:,\d{3})*\.\d{2})\s*(.*)$/;
const SOURCE = /^\s*([A-Z]{2,8}\d{0,4}-\d{3}|UAVG-[A-Z]{2}-\d{4})\s+(\d{2}\/\d{2}\/\d{4})/;
const MOD = /^\s*(\d{1,3})\s+(\d{2}\/\d{2}\/\d{4})\s*$/;

/** Mostly capital letters: a classification name, not a footnote. */
function looksLikeName(line) {
  const letters = line.replace(/[^A-Za-z]/g, "");
  if (letters.length < 2) return false;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper / letters.length > 0.8;
}

function clean(name) {
  return name
    .replace(/\s+/g, " ")
    .replace(/\s*\bFOOTNOTES?\b.*$/i, "")
    .replace(/[\s.:]+$/, "")
    .trim();
}

export function parseWageDetermination(raw) {
  const text = String(raw).replace(/^"|"$/g, "").replace(/\r/g, "");
  const lines = text.split("\n");
  const mods = [];
  const rates = [];
  let source = "";
  let buffer = [];
  let inMods = false;

  for (const line of lines) {
    if (/Modification Number\s+Publication Date/i.test(line)) {
      inMods = true;
      continue;
    }
    if (inMods) {
      const m = line.match(MOD);
      if (m) {
        mods.push({ number: Number(m[1]), date: m[2] });
        continue;
      }
      if (line.trim() === "") continue;
      inMods = false;
    }

    const src = line.match(SOURCE);
    if (src) {
      source = `${src[1]} ${src[2]}`;
      buffer = [];
      continue;
    }

    const rate = line.match(RATE);
    if (rate) {
      const name = clean([...buffer, rate[1]].join(" "));
      buffer = [];
      if (!name || /^rates?$/i.test(name) || !looksLikeName(name)) continue;
      rates.push({ classification: name, base: rate[2].replace(/,/g, ""), fringe: rate[3].trim() || "0.00", source });
      continue;
    }

    const trimmed = line.trim();
    if (trimmed === "" || /^[-=]{5,}/.test(trimmed) || /^Rates\s+Fringes/i.test(trimmed) || !looksLikeName(trimmed)) {
      buffer = [];
      continue;
    }
    buffer.push(trimmed);
  }

  const header = text.match(/General Decision Number:\s*([A-Z]{2}\d{8})\s+(\d{2}\/\d{2}\/\d{4})/);
  return { number: header?.[1] ?? "", date: header?.[2] ?? "", mods, rates };
}

/** "hennepin" → "hennepin-county"; Louisiana parishes and independent cities keep their own words. */
export function countySlug(name, state) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (state === "LA") return `${base}-parish`;
  if (/city|borough|census-area|municipality/.test(base)) return base;
  return `${base}-county`;
}
