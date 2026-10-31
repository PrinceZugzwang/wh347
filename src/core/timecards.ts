import type { ColumnMapping, Field } from "./columns";
import { parseDate } from "./dates";
import type { DeductionKind, Issue, TimecardLine, WorkerStatus } from "./types";
import { parseHours, parseMoney } from "./units";

export type Cell = string | number | boolean | Date | null | undefined;

export interface Sheet {
  headers: string[];
  rows: Cell[][];
  /** 1-based spreadsheet row number of the first data row. */
  firstDataRow: number;
}

/** Finds the header row: the first row with at least three filled cells. */
export function toSheet(grid: Cell[][]): Sheet {
  const headerIndex = grid.findIndex((r) => r.filter((c) => c !== null && c !== undefined && String(c).trim() !== "").length >= 3);
  if (headerIndex < 0) throw new Error("No header row found. The file needs a row of column names above the data.");
  const headers = grid[headerIndex].map((c) => (c === null || c === undefined ? "" : String(c).trim()));
  const rows = grid.slice(headerIndex + 1).filter((r) => r.some((c) => c !== null && c !== undefined && String(c).trim() !== ""));
  return { headers, rows, firstDataRow: headerIndex + 2 };
}

function cell(row: Cell[], mapping: ColumnMapping, field: Field): Cell {
  const index = mapping[field];
  return index === undefined ? undefined : row[index];
}

function text(value: Cell): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function status(value: Cell): WorkerStatus {
  const t = text(value).toLowerCase();
  return t === "ra" || t.startsWith("appr") || t === "a" || t.includes("registered apprentice") ? "RA" : "J";
}

/** Keeps only the last four digits; a full SSN must never reach the printed payroll. */
function workerId(value: Cell): string {
  const digits = text(value).replace(/\D/g, "");
  if (digits.length >= 4) return digits.slice(-4);
  return text(value);
}

export function readTimecards(sheet: Sheet, mapping: ColumnMapping): { lines: TimecardLine[]; issues: Issue[] } {
  const lines: TimecardLine[] = [];
  const issues: Issue[] = [];
  let fullSsnRows = 0;

  sheet.rows.forEach((row, i) => {
    const sourceRow = sheet.firstDataRow + i;
    const name =
      text(cell(row, mapping, "workerName")) ||
      [text(cell(row, mapping, "lastName")), text(cell(row, mapping, "firstName"))].filter(Boolean).join(", ");
    const rawId = text(cell(row, mapping, "workerId"));
    const date = parseDate(cell(row, mapping, "date"));
    const hours = parseHours(cell(row, mapping, "hours"));
    const baseRate = parseMoney(cell(row, mapping, "baseRate"));
    const classification = text(cell(row, mapping, "classification"));

    const problems: string[] = [];
    if (!name) problems.push("no worker name");
    if (!rawId) problems.push("no worker ID");
    if (!classification) problems.push("no classification");
    if (!date) problems.push(`unreadable date "${text(cell(row, mapping, "date"))}"`);
    if (hours === null) problems.push(`unreadable hours "${text(cell(row, mapping, "hours"))}"`);
    if (baseRate === null) problems.push(`unreadable rate "${text(cell(row, mapping, "baseRate"))}"`);
    if (problems.length > 0) {
      issues.push({
        level: "error",
        code: "row-unreadable",
        sourceRow,
        workerName: name || undefined,
        message: `Row ${sourceRow}: ${problems.join(", ")}.`,
      });
      return;
    }

    if (rawId.replace(/\D/g, "").length >= 9) fullSsnRows += 1;

    const deductions: Partial<Record<DeductionKind, number>> = {};
    for (const kind of ["fica", "federal", "state", "other"] as const) {
      const value = parseMoney(cell(row, mapping, kind));
      if (value !== null) deductions[kind] = Math.abs(value);
    }

    lines.push({
      sourceRow,
      workerName: name,
      workerId: workerId(rawId),
      status: status(cell(row, mapping, "status")),
      apprenticeLevel: text(cell(row, mapping, "apprenticeLevel")),
      classification,
      date: date as string,
      hours: hours as number,
      overtimeHours: parseHours(cell(row, mapping, "overtimeHours")),
      baseRate: baseRate as number,
      overtimeRate: parseMoney(cell(row, mapping, "overtimeRate")),
      fringeCredited: parseMoney(cell(row, mapping, "fringeCredited")) ?? 0,
      fringeCash: parseMoney(cell(row, mapping, "fringeCash")) ?? 0,
      deductions,
      grossAllWork: parseMoney(cell(row, mapping, "grossAllWork")),
    });
  });

  if (fullSsnRows > 0) {
    issues.push({
      level: "warning",
      code: "full-ssn-in-source",
      message: `Your file has full Social Security numbers on ${fullSsnRows} ${fullSsnRows === 1 ? "row" : "rows"}. Only the last four digits are printed, and the file never leaves this browser.`,
    });
  }
  return { lines, issues };
}
