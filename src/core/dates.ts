const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const US = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function valid(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Normalises the date shapes payroll exports actually produce to YYYY-MM-DD. */
export function parseDate(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return `${raw.getUTCFullYear()}-${pad(raw.getUTCMonth() + 1)}-${pad(raw.getUTCDate())}`;
  }
  const text = String(raw).trim();
  let match = ISO.exec(text);
  if (match) {
    const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
    return valid(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
  }
  match = US.exec(text);
  if (match) {
    const m = Number(match[1]);
    const d = Number(match[2]);
    let y = Number(match[3]);
    if (y < 100) y += 2000;
    return valid(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
  }
  return null;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** The seven dates of the workweek that ends on `weekEnding`, oldest first. */
export function workweek(weekEnding: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekEnding, i - 6));
}

const DAY_LETTERS = ["Su", "M", "Tu", "W", "Th", "F", "Sa"];

export function dayLetter(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return DAY_LETTERS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${m}/${d}`;
}

export function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${pad(m)}/${pad(d)}/${y}`;
}
