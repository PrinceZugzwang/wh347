import type { Payroll, PayrollRow } from "../types";

/**
 * State portal upload files built from a finished payroll.
 *
 * California DIR eCPR, XML version 2.0:
 *   https://www.dir.ca.gov/Public-Works/cpr/eCPR-XML-Guidelines-V2.pdf
 *   sample: https://dir.ca.gov/Public-Works/CPR/V2-eCPR-Sample-Schema.xml
 * New York DOL certified payroll bulk upload (schema 2.0):
 *   https://dol.ny.gov/certified-payroll-bulk-upload-formatting-guide
 *
 * Both portals need a few things a WH-347 doesn't carry (registration and
 * project numbers, worker home addresses, and for California the full SSN).
 * Those come in as `details`; anything missing is listed in `missing` and no
 * file is produced, so a half-filled upload never reaches an agency.
 */

export interface WorkerAddress {
  street: string;
  city: string;
  /** Two-letter state code. */
  state: string;
  /** 12345 or 12345-6789. */
  zip: string;
}

export interface CaWorkerDetails extends WorkerAddress {
  /** Full 9-digit SSN or ITIN. California requires it; it is never saved to an account. */
  ssn: string;
  /** DIR craft name, e.g. "Electrician"; defaults to the classification. */
  craft?: string;
  checkNum?: string;
}

export interface CaDetails {
  /** DIR public works contractor registration number, 10 digits. */
  contractorPWCR: string;
  /** DIR project ID (numeric). */
  projectId: string;
  awardingBody?: string;
  workers: Record<string, CaWorkerDetails>;
}

export interface NyDetails {
  /** Prevailing Rate Case number, 10 characters. */
  prcNumber: string;
  workers: Record<string, WorkerAddress>;
}

export interface StateFile {
  xml: string | null;
  missing: string[];
}

export interface WorkerGroup {
  key: string;
  name: string;
  workerId: string;
  rows: PayrollRow[];
}

/** One entry per worker, in payroll order. A worker in two classifications has two rows. */
export function workersOf(payroll: Payroll): WorkerGroup[] {
  const groups = new Map<string, WorkerGroup>();
  for (const row of payroll.rows) {
    const key = workerDetailsKey(row.workerName, row.workerId);
    const group = groups.get(key) ?? { key, name: row.workerName, workerId: row.workerId, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Details are remembered per worker by name and the last four of the ID. */
export function workerDetailsKey(name: string, workerId: string): string {
  return `${name.trim().toLowerCase()}|${workerId.replace(/\D/g, "").slice(-4)}`;
}

/** "Ramirez, Daniel" or "Daniel Ramirez" → first, middle, last. */
export function splitName(full: string): { first: string; middle: string; last: string } {
  const name = full.trim().replace(/\s+/g, " ");
  if (name.includes(",")) {
    const [last, rest = ""] = name.split(",", 2).map((s) => s.trim());
    const [first = "", ...middle] = rest.split(" ").filter(Boolean);
    return { first, middle: middle.join(" "), last };
  }
  const parts = name.split(" ");
  if (parts.length === 1) return { first: parts[0], middle: "", last: parts[0] };
  return { first: parts[0], middle: parts.slice(1, -1).join(" "), last: parts[parts.length - 1] };
}

/** "3rd period", "3", "Period 3" → "3"; empty when there's no level from 1 to 10. */
export function apprenticePeriod(level: string): string {
  const n = Number(/\d{1,2}/.exec(level)?.[0] ?? "");
  return n >= 1 && n <= 10 ? String(n) : "";
}

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Cents → "1234.50". */
function money(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}

/** Hundredths of an hour → "8.00". */
function hours(hundredths: number): string {
  return (hundredths / 100).toFixed(2);
}

function sum<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((s, item) => s + pick(item), 0);
}

function workerTotals(group: WorkerGroup) {
  const head = group.rows.find((r) => r.carriesWorkerTotals) ?? group.rows[0];
  return {
    grossThisProject: sum(group.rows, (r) => r.grossThisProject),
    grossAllWork: Math.max(
      head.grossAllWork,
      sum(group.rows, (r) => r.grossThisProject),
    ),
    deductions: {
      fica: sum(group.rows, (r) => r.deductions.fica),
      federal: sum(group.rows, (r) => r.deductions.federal),
      state: sum(group.rows, (r) => r.deductions.state),
      other: sum(group.rows, (r) => r.deductions.other),
    },
    deductionsTotal: sum(group.rows, (r) => r.deductionsTotal),
    netPay: sum(group.rows, (r) => r.netPay),
  };
}

function addressProblems(who: string, a: WorkerAddress | undefined, zipPattern: RegExp): string[] {
  if (!a) return [`${who}: home address`];
  const out: string[] = [];
  if (!a.street.trim()) out.push(`${who}: street address`);
  if (!a.city.trim()) out.push(`${who}: city`);
  if (!/^[A-Za-z]{2}$/.test(a.state.trim())) out.push(`${who}: two-letter state`);
  if (!zipPattern.test(a.zip.trim())) out.push(`${who}: ZIP code`);
  return out;
}

/* ------------------------------------------------------------------ */
/* California DIR eCPR v2                                              */
/* ------------------------------------------------------------------ */

export function renderCaEcpr(payroll: Payroll, details: CaDetails): StateFile {
  const missing: string[] = [];
  const contractorName = payroll.header.contractorName.trim();
  if (!contractorName) missing.push("Your company name");
  if (!/^\d{10}$/.test(details.contractorPWCR.trim())) missing.push("DIR contractor registration number (10 digits)");
  if (!/^\d+$/.test(details.projectId.trim())) missing.push("DIR project ID (numbers only)");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payroll.header.weekEnding)) missing.push("Week ending date");

  const workers = workersOf(payroll);
  if (workers.length > 500) missing.push("California takes at most 500 workers per file");
  const ssns = new Set<string>();
  for (const w of workers) {
    const d = details.workers[w.key];
    missing.push(...addressProblems(w.name, d, /^\d{5}(-\d{4})?$/));
    const ssn = (d?.ssn ?? "").replace(/\D/g, "");
    if (ssn.length !== 9) missing.push(`${w.name}: full 9-digit SSN or ITIN`);
    else if (ssns.has(ssn)) missing.push(`${w.name}: SSN repeats another worker's`);
    else ssns.add(ssn);
    for (const r of w.rows) {
      if (r.status === "RA" && !apprenticePeriod(r.apprenticeLevel))
        missing.push(`${w.name}: apprentice period (1 to 10) for ${r.classification}`);
    }
  }
  if (missing.length) return { xml: null, missing };

  const days = payroll.weekDates;
  const lines: string[] = [];
  const el = (indent: number, name: string, value: string) => lines.push(`${"  ".repeat(indent)}<CPR:${name}>${esc(value)}</CPR:${name}>`);
  const open = (indent: number, name: string, attrs = "") => lines.push(`${"  ".repeat(indent)}<CPR:${name}${attrs}>`);
  const close = (indent: number, name: string) => lines.push(`${"  ".repeat(indent)}</CPR:${name}>`);

  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  lines.push('<CPR:eCPR xmlns:CPR="https://www.dir.ca.gov/Public-Works/CPR/eCPR-v2.xsd">');
  el(1, "version", "2.0");
  open(1, "contractorInfo");
  el(2, "contractorName", contractorName.slice(0, 56));
  el(2, "contractorPWCR", details.contractorPWCR.trim());
  close(1, "contractorInfo");
  open(1, "projectInfo");
  el(2, "awardingBody", (details.awardingBody ?? "").trim().slice(0, 56));
  el(2, "projectID", details.projectId.trim());
  close(1, "projectInfo");
  open(1, "payrollInfo");
  el(2, "statementOfNP", workers.length === 0 ? "true" : "false");
  el(2, "forWeekEnding", payroll.header.weekEnding);
  open(2, "employees");

  for (const w of workers) {
    const d = details.workers[w.key];
    const name = splitName(w.name);
    const t = workerTotals(w);
    open(3, "employee");
    el(4, "firstName", name.first.slice(0, 56));
    el(4, "lastName", name.last.slice(0, 56));
    el(4, "middleName", name.middle.slice(0, 56));
    open(4, "address");
    el(5, "street", d.street.trim().slice(0, 100));
    el(5, "city", d.city.trim().slice(0, 250));
    el(5, "state", d.state.trim().toUpperCase());
    el(5, "zip", d.zip.trim());
    close(4, "address");
    el(4, "ssn", d.ssn.replace(/\D/g, ""));
    el(4, "itin", "");
    el(4, "notes", "");
    open(4, "classifications");
    for (const r of w.rows) {
      const fringePerHour = r.fringeCreditedPerHour + r.fringeCashPerHour;
      open(5, "classification", ` name="${esc(r.classification)}"`);
      el(6, "craft", (d.craft || r.classification).trim());
      el(6, "employeeLevel", r.status === "RA" ? "apprentice" : "journeyman");
      el(6, "apprenticeLevel", r.status === "RA" ? apprenticePeriod(r.apprenticeLevel) : "");
      open(6, "hrsWorkedEachDay");
      days.forEach((date, i) => {
        const day = r.days.find((x) => x.date === date) ?? { date, straight: 0, overtime: 0 };
        open(7, "day", ` id="${i + 1}"`);
        el(8, "date", date);
        el(8, "straightTime", hours(day.straight));
        el(8, "overtime", hours(day.overtime));
        el(8, "doubletime", "0.00");
        close(7, "day");
      });
      close(6, "hrsWorkedEachDay");
      open(6, "fringePaid");
      // DIR requires at least one to be true, even when no fringe is owed.
      const toEmployee = r.fringeCashPerHour > 0;
      el(7, "paidToEmployee", String(toEmployee));
      el(7, "paidToBenefitPlan", String(r.fringeCreditedPerHour > 0 || !toEmployee));
      close(6, "fringePaid");
      // The WH-347 carries one fringe figure; DIR splits it five ways. Without a split it goes under "other".
      open(6, "fringe");
      el(7, "healthWelfare", "0.00");
      el(7, "vacationHoliday", "0.00");
      el(7, "pension", "0.00");
      el(7, "training", "0.00");
      el(7, "other", money(fringePerHour));
      close(6, "fringe");
      open(6, "totHrs");
      el(7, "totHrsStraightTime", hours(r.totalStraight));
      el(7, "totHrsOvertime", hours(r.totalOvertime));
      el(7, "totHrsDoubletime", "0.00");
      close(6, "totHrs");
      open(6, "hrlyPayRate");
      el(7, "hrlyPayRateStraightTime", money(r.baseRate));
      el(7, "hrlyPayRateOvertime", money(r.overtimeRate));
      el(7, "hrlyPayRateDoubletime", "0.00");
      el(7, "totalHrlyPayRateStraightTime", money(r.baseRate + fringePerHour));
      el(7, "totalHrlyPayRateOvertime", money(r.overtimeRate + fringePerHour));
      el(7, "totalHrlyPayRateDoubletime", "0.00");
      close(6, "hrlyPayRate");
      close(5, "classification");
    }
    close(4, "classifications");
    open(4, "payments");
    el(5, "travelSubs", "0.00");
    close(4, "payments");
    open(4, "deductions");
    el(5, "fedTax", money(t.deductions.federal));
    el(5, "FICA", money(t.deductions.fica));
    el(5, "stateTax", money(t.deductions.state));
    el(5, "SDI", "0.00");
    el(5, "fundAdmin", "0.00");
    el(5, "savings", "0.00");
    el(5, "dues", "0.00");
    el(5, "other", money(t.deductions.other));
    el(5, "totalDeductions", money(t.deductionsTotal));
    close(4, "deductions");
    open(4, "earnings");
    el(5, "grossThisProject", money(t.grossThisProject));
    el(5, "grossAllWork", money(t.grossAllWork));
    el(5, "netWagePaidWeek", money(t.netPay));
    el(5, "checkNum", (d.checkNum || "").trim().slice(0, 20));
    close(4, "earnings");
    close(3, "employee");
  }

  close(2, "employees");
  close(1, "payrollInfo");
  lines.push("</CPR:eCPR>");
  return { xml: lines.join("\n") + "\n", missing: [] };
}

/* ------------------------------------------------------------------ */
/* New York DOL certified payroll bulk upload                          */
/* ------------------------------------------------------------------ */

const NY_DEDUCTIONS: [keyof ReturnType<typeof workerTotals>["deductions"], string][] = [
  ["fica", "FICA"],
  ["federal", "Federal Tax"],
  ["state", "State Tax"],
  ["other", "Other"],
];

export function renderNyXml(payroll: Payroll, details: NyDetails): StateFile {
  const missing: string[] = [];
  if (!/^.{10}$/.test(details.prcNumber.trim())) missing.push("Prevailing Rate Case (PRC) number, 10 characters");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payroll.header.weekEnding)) missing.push("Week ending date");

  const workers = workersOf(payroll);
  if (workers.length > 500) missing.push("New York takes at most 500 workers per file");
  for (const w of workers) {
    missing.push(...addressProblems(w.name, details.workers[w.key], /^\d{5}(-\d{4})?$/));
    if (!/\d{4}$/.test(w.workerId.replace(/\D/g, ""))) missing.push(`${w.name}: last 4 of SSN`);
    for (const r of w.rows) {
      if (r.baseRate > 99_999 || r.overtimeRate > 99_999) missing.push(`${w.name}: hourly rate over $999.99`);
    }
    const t = workerTotals(w);
    for (const [kind] of NY_DEDUCTIONS) {
      if (t.deductions[kind] > 999_999) missing.push(`${w.name}: ${kind} deduction over $9,999.99`);
    }
  }
  if (missing.length) return { xml: null, missing };

  const lines: string[] = [];
  const el = (indent: number, name: string, value: string) => lines.push(`${"  ".repeat(indent)}<${name}>${esc(value)}</${name}>`);
  const open = (indent: number, name: string) => lines.push(`${"  ".repeat(indent)}<${name}>`);
  const close = (indent: number, name: string) => lines.push(`${"  ".repeat(indent)}</${name}>`);

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<ProjectRollup xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="NYDOL_CertPayroll.xsd">');
  el(1, "prcNumber", details.prcNumber.trim());
  el(1, "weekEndingDate", `${payroll.header.weekEnding}T00:00:00.000Z`);
  open(1, "employeeWorkWeeks");

  for (const w of workers) {
    const a = details.workers[w.key];
    const name = splitName(w.name);
    const t = workerTotals(w);
    const [zip, zipExt] = a.zip.trim().split("-");
    open(2, "employeeWorkWeek");
    open(3, "employee");
    el(4, "firstName", name.first.slice(0, 45));
    if (name.middle) el(4, "middleName", name.middle.slice(0, 45));
    el(4, "lastName", name.last.slice(0, 45));
    el(4, "ssnLast4", w.workerId.replace(/\D/g, "").slice(-4));
    el(4, "nysRegisteredApprentice", String(w.rows.some((r) => r.status === "RA")));
    open(4, "address");
    el(5, "address1", a.street.trim().slice(0, 42));
    el(5, "city", a.city.trim().slice(0, 40));
    el(5, "state", a.state.trim().toUpperCase());
    el(5, "postalCode", zip);
    if (zipExt) el(5, "postalCodeExt", zipExt);
    el(5, "country", "United States");
    close(4, "address");
    close(3, "employee");
    // NY's field for the gross the deductions are taken from: gross for all work, as on the WH-347.
    el(3, "deductionsGrossEarnings", money(t.grossAllWork));
    el(3, "netWages", money(t.netPay));
    open(3, "workWeeks");
    for (const r of w.rows) {
      open(4, "workWeek");
      el(5, "workCategory", r.classification.slice(0, 300));
      el(5, "stHourlyRate", money(r.baseRate));
      el(5, "otHourlyRate", money(r.overtimeRate));
      open(5, "days");
      for (const date of payroll.weekDates) {
        const day = r.days.find((x) => x.date === date);
        if (!day || day.straight + day.overtime === 0) continue;
        open(6, "day");
        el(7, "day", date);
        el(7, "standardTimeHours", hours(day.straight));
        el(7, "overTimeHours", hours(day.overtime));
        close(6, "day");
      }
      close(5, "days");
      close(4, "workWeek");
    }
    close(3, "workWeeks");
    open(3, "deductions");
    for (const [kind, label] of NY_DEDUCTIONS) {
      if (t.deductions[kind] <= 0) continue;
      open(4, "deduction");
      el(5, "type", label);
      el(5, "amount", money(t.deductions[kind]));
      close(4, "deduction");
    }
    close(3, "deductions");
    open(3, "supplementalPayments");
    for (const r of w.rows) {
      const parts: [number, string][] = [
        [r.fringeCreditedPerHour, "Fringe benefits paid to plans"],
        [r.fringeCashPerHour, "Fringe benefits paid in cash"],
      ];
      for (const [perHour, explanation] of parts) {
        if (perHour <= 0) continue;
        open(4, "supplementalPayment");
        el(5, "type", "Other Benefit (Type)");
        el(5, "workCategory", r.classification.slice(0, 300));
        el(5, "explanation", explanation);
        el(5, "standardHourlyRate", money(perHour));
        el(5, "overtimeHourlyRate", money(perHour));
        close(4, "supplementalPayment");
      }
    }
    close(3, "supplementalPayments");
    close(2, "employeeWorkWeek");
  }

  close(1, "employeeWorkWeeks");
  lines.push("</ProjectRollup>");
  return { xml: lines.join("\n") + "\n", missing: [] };
}
