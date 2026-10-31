import { parseDate } from "./dates";
import type { Issue, Payroll, ProjectHeader, WageRate } from "./types";
import { formatMoney, timeAndHalf } from "./units";

const HEADER_FIELDS: [keyof ProjectHeader, string][] = [
  ["contractorName", "Contractor or subcontractor name"],
  ["contractorAddress", "Business address"],
  ["projectName", "Project name"],
  ["projectLocation", "Project location"],
  ["projectNumber", "Project or contract number"],
  ["payrollNumber", "Payroll number"],
  ["weekEnding", "Week ending date"],
];

export function validateHeader(header: ProjectHeader): Issue[] {
  const issues: Issue[] = [];
  for (const [key, label] of HEADER_FIELDS) {
    if (String(header[key]).trim() === "") issues.push({ level: "error", code: "header-missing", message: `${label} is required.` });
  }
  if (header.weekEnding && !parseDate(header.weekEnding)) {
    issues.push({ level: "error", code: "header-week-ending", message: "Week ending date is not a valid date." });
  }
  if (header.wageDeterminationNumber.trim() === "") {
    issues.push({
      level: "warning",
      code: "header-wd-missing",
      message: "No wage determination number. Most awarding agencies expect it on every payroll.",
    });
  }
  return issues;
}

function matchRate(classification: string, rates: WageRate[]): WageRate | undefined {
  const key = classification.trim().toLowerCase();
  return rates.find((r) => r.classification.trim().toLowerCase() === key);
}

export function validatePayroll(payroll: Payroll, rates: WageRate[]): Issue[] {
  const issues: Issue[] = [];
  const unmatched = new Set<string>();

  for (const row of payroll.rows) {
    const who = row.workerName;

    if (!/^\d{4}$/.test(row.workerId)) {
      issues.push({
        level: "warning",
        code: "worker-id-format",
        workerName: who,
        message: `${who}: ID "${row.workerId}" is not four digits. The form expects the last four of the SSN or another worker ID.`,
      });
    }
    for (const day of row.days) {
      if (day.straight + day.overtime > 24_00) {
        issues.push({ level: "error", code: "day-over-24", workerName: who, message: `${who}: more than 24 hours on ${day.date}.` });
      }
      if (day.straight < 0 || day.overtime < 0) {
        issues.push({ level: "error", code: "negative-hours", workerName: who, message: `${who}: negative hours on ${day.date}.` });
      }
    }
    if (row.totalOvertime > 0 && row.overtimeRate < timeAndHalf(row.baseRate)) {
      issues.push({
        level: "error",
        code: "overtime-rate-low",
        workerName: who,
        message: `${who}: overtime rate $${formatMoney(row.overtimeRate)} is below 1.5 x $${formatMoney(row.baseRate)}.`,
      });
    }
    if (row.status === "RA" && row.apprenticeLevel.trim() === "") {
      issues.push({
        level: "warning",
        code: "apprentice-level",
        workerName: who,
        message: `${who}: registered apprentice with no progression level.`,
      });
    }
    if (row.carriesWorkerTotals && row.netPay < 0) {
      issues.push({ level: "error", code: "net-negative", workerName: who, message: `${who}: deductions exceed gross pay.` });
    }

    if (rates.length === 0) continue;
    const rate = matchRate(row.classification, rates);
    if (!rate) {
      unmatched.add(row.classification);
      continue;
    }
    if (row.status === "J" && row.baseRate < rate.base) {
      issues.push({
        level: "error",
        code: "below-prevailing-base",
        workerName: who,
        message: `${who}: $${formatMoney(row.baseRate)}/hr is below the $${formatMoney(rate.base)} base rate for ${rate.classification}.`,
      });
    }
    const fringePaid = row.fringeCreditedPerHour + row.fringeCashPerHour;
    const shortfall = rate.fringe - fringePaid;
    const excessBase = Math.max(0, row.baseRate - rate.base);
    if (row.status === "J" && shortfall > excessBase) {
      issues.push({
        level: "error",
        code: "below-prevailing-fringe",
        workerName: who,
        message: `${who}: fringe of $${formatMoney(fringePaid)}/hr (plus $${formatMoney(excessBase)} above base) does not cover the $${formatMoney(rate.fringe)} fringe for ${rate.classification}.`,
      });
    }
  }

  for (const classification of unmatched) {
    issues.push({
      level: "warning",
      code: "classification-not-in-wd",
      message: `"${classification}" is not in the wage determination you loaded. Check the spelling, or request a conformance if the classification is missing.`,
    });
  }
  if (rates.length === 0) {
    issues.push({
      level: "warning",
      code: "no-wage-determination",
      message: "No wage rates loaded, so pay was not checked against the wage determination.",
    });
  }
  return issues;
}
