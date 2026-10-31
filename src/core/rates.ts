import type { WageRate } from "./types";
import { parseMoney } from "./units";

/**
 * Reads wage rates pasted from a wage determination on SAM.gov. Accepts one
 * classification per line in either of the layouts people copy:
 *   ELECTRICIAN  $48.10  21.30
 *   Electrician, 48.10, 21.30
 * Lines without two dollar amounts are ignored, which skips the headings and
 * footnotes that come along with a copy-paste.
 */
export function parseRates(input: string): WageRate[] {
  const rates: WageRate[] = [];
  for (const raw of input.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const amounts = [...line.matchAll(/\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2})\b/g)];
    if (amounts.length < 2) continue;
    const name = line
      .slice(0, amounts[0].index)
      .replace(/[\s.,\t:$]+$/, "")
      .replace(/\s+/g, " ")
      .trim();
    const base = parseMoney(amounts[0][1]);
    const fringe = parseMoney(amounts[1][1]);
    if (!name || base === null || fringe === null) continue;
    rates.push({ classification: name, base, fringe });
  }
  return rates;
}
