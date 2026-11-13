import "@fontsource/public-sans/400.css";
import "@fontsource/public-sans/600.css";
import "@fontsource/public-sans/700.css";
import "@fontsource/public-sans/800.css";
import "./payroll.css";
import { initAdTag, track } from "../ui/analytics";

/**
 * The payroll landing page is a demand test: the price check and the early
 * access request are counted (worker counts and current provider only, never
 * an email address), so we can tell interest apart from people who actually
 * write in.
 */

initAdTag();

const PER_CHECK = 3;
const LICENSE = 390;
const LICENSE_PER_CHECK = 1.5;
const WEEKS_PER_MONTH = 52 / 12;

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Rough worker-count buckets, so analytics never holds an exact company size. */
function bucket(workers: number): string {
  if (workers <= 4) return "1-4";
  if (workers <= 9) return "5-9";
  if (workers <= 19) return "10-19";
  if (workers <= 49) return "20-49";
  return "50+";
}

function readWorkers(input: HTMLInputElement | null): number | null {
  const n = Math.round(Number(input?.value));
  return Number.isFinite(n) && n >= 1 && n <= 500 ? n : null;
}

const quoteOut = document.getElementById("quote-out");
document.getElementById("quote")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const workers = readWorkers(document.getElementById("workers") as HTMLInputElement | null);
  if (!quoteOut) return;
  if (workers === null) {
    quoteOut.textContent = "Enter how many field workers you pay, from 1 to 500.";
    return;
  }
  const checks = workers * WEEKS_PER_MONTH;
  const payg = checks * PER_CHECK;
  const licensed = LICENSE / 12 + checks * LICENSE_PER_CHECK;
  const best = Math.min(payg, licensed);
  quoteOut.textContent =
    `About ${money(best)} a month for ${workers} worker${workers === 1 ? "" : "s"} paid weekly ` +
    `(${Math.round(checks)} paychecks)` +
    (licensed < payg
      ? `, on the yearly license ($390 a year plus about $1.50 a paycheck). Pay as you go would be about ${money(payg)}. `
      : ", pay as you go, with nothing in months you don't run payroll. ") +
    "Certified payroll for every project included.";
  track("Payroll price checked", { workers: bucket(workers) });
  const early = document.getElementById("early-workers") as HTMLInputElement | null;
  if (early && !early.value) early.value = String(workers);
});

document.getElementById("early-form")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const workers = readWorkers(document.getElementById("early-workers") as HTMLInputElement | null);
  const provider = (document.getElementById("early-provider") as HTMLSelectElement | null)?.value ?? "";
  if (workers === null || !provider) return;
  track("Payroll interest", { workers: bucket(workers), provider });
  const subject = "EasyWH347 Payroll early access";
  const body = [
    `Field workers on payroll: ${workers}`,
    `How we run payroll now: ${provider}`,
    "",
    "Company:",
    "States we work in:",
    "If switching, attach your last payroll invoice for the free move.",
  ].join("\n");
  window.location.href = `mailto:support@easywh347.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
});

for (const el of document.querySelectorAll<HTMLElement>("[data-track]")) {
  el.addEventListener("click", () => track("Payroll cta", { where: el.dataset.track ?? "" }));
}
