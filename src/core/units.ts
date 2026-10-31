/**
 * Money is held in integer cents and hours in integer hundredths of an hour,
 * so totals on a legal filing never drift through floating-point rounding.
 */

export function parseMoney(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.round(raw * 100) : null;
  const text = String(raw).trim();
  if (text === "") return null;
  const negative = /^\(.*\)$/.test(text) || text.startsWith("-");
  const cleaned = text.replace(/[()$,\s-]/g, "");
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === "" || cleaned === ".") return null;
  const cents = Math.round(Number(cleaned) * 100);
  return negative ? -cents : cents;
}

export function parseHours(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.round(raw * 100) : null;
  const text = String(raw).trim();
  if (text === "") return null;
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(text);
  if (clock) return Number(clock[1]) * 100 + Math.round((Number(clock[2]) / 60) * 100);
  if (!/^-?\d*\.?\d+$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}

/** Multiplies a cents-per-hour rate by hundredths of an hour, rounding half up to the cent. */
export function extend(rateCents: number, hundredths: number): number {
  return Math.round((rateCents * hundredths) / 100);
}

/** Time-and-a-half of a cents rate, rounded to the cent. */
export function timeAndHalf(rateCents: number): number {
  return Math.round(rateCents * 1.5);
}

export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

export function formatHours(hundredths: number): string {
  if (hundredths === 0) return "";
  const whole = Math.trunc(hundredths / 100);
  const frac = Math.abs(hundredths % 100);
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}
