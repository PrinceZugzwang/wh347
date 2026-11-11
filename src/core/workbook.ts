import { parseDate } from "./dates";
import { type CrewEntry, emptyEntry, lastFour } from "./manual";
import type { Cell } from "./timecards";
import type { ProjectHeader } from "./types";

/**
 * The Excel workbook a contractor can download, fill in or keep, and bring
 * back. One layout serves three uses: the free template, "download this week
 * as Excel", and import. It is described here as plain data so the layout and
 * the reader can't drift apart; the UI turns it into an .xlsx file.
 */

export const WORKBOOK_TITLE = "Certified payroll (Form WH-347) workbook from EasyWH347";

const HEADER_ROWS: { label: string; key: keyof ProjectHeader }[] = [
  { label: "Your company", key: "contractorName" },
  { label: "Business address", key: "contractorAddress" },
  { label: "Project", key: "projectName" },
  { label: "Project location", key: "projectLocation" },
  { label: "Project or contract no.", key: "projectNumber" },
  { label: "Wage determination no.", key: "wageDeterminationNumber" },
  { label: "Payroll no.", key: "payrollNumber" },
  { label: "Week ending (a Saturday)", key: "weekEnding" },
  { label: "Prime contractor or subcontractor", key: "role" },
  { label: "Final payroll (yes or no)", key: "isFinal" },
];

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Columns of the worker table, in order. The last four are worked out by Excel formulas. */
export const WORKER_COLUMNS = [
  "Name",
  "Last 4 of SSN or ID",
  "Classification",
  "J or RA",
  "Apprentice level",
  ...DAY_NAMES,
  "Rate / hr",
  "Fringe to plan / hr",
  "Fringe in cash / hr",
  "FICA",
  "Federal tax",
  "State tax",
  "Other deductions",
  "Gross for all work, if more than this project",
  "Total hours",
  "Overtime hours",
  "Gross on this project",
  "Net pay",
] as const;

export const FIRST_FORMULA_COLUMN = WORKER_COLUMNS.indexOf("Total hours");

export type WorkbookCell =
  | { kind: "title" | "note" | "label" | "columnHead"; value: string }
  | { kind: "input"; value: string | number | null; money?: boolean }
  | { kind: "formula"; formula: string; money?: boolean };

const col = (i: number) => String.fromCharCode(65 + i);

/** Formulas for one worker row (1-based Excel row number), mirroring the payroll rules used for the PDF. */
function formulas(r: number): WorkbookCell[] {
  const days = `${col(5)}${r}:${col(11)}${r}`;
  const [rate, cash, fica, other, allWork, total, ot, gross] = [12, 14, 15, 18, 19, 20, 21, 22].map((i) => `${col(i)}${r}`);
  return [
    { kind: "formula", formula: `IF(COUNT(${days})=0,"",SUM(${days}))` },
    { kind: "formula", formula: `IF(${total}="","",MAX(0,${total}-40))` },
    {
      kind: "formula",
      money: true,
      formula: `IF(${total}="","",ROUND((${total}-${ot})*${rate}+${ot}*ROUND(${rate}*1.5,2)+${total}*N(${cash}),2))`,
    },
    {
      kind: "formula",
      money: true,
      formula: `IF(${total}="","",ROUND(IF(N(${allWork})>0,${allWork},${gross})-SUM(${fica}:${other}),2))`,
    },
  ];
}

function num(raw: string): string | number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : t;
}

/**
 * The workbook as rows of cells. With no crew it is the blank template; with
 * a crew it is that week's payroll, ready to keep or to import again.
 */
export function workbookRows(
  header: ProjectHeader | null,
  crew: CrewEntry[],
  weekDates: string[] | null,
  blankRows = 25,
): WorkbookCell[][] {
  const rows: WorkbookCell[][] = [
    [{ kind: "title", value: WORKBOOK_TITLE }],
    [
      {
        kind: "note",
        value:
          "Fill in the white cells. Totals, overtime past 40 hours, gross and net pay are worked out for you. " +
          "To get the finished WH-347 as a PDF, drop this file on easywh347.com.",
      },
    ],
    [],
  ];

  for (const { label, key } of HEADER_ROWS) {
    let value: string | number | null = null;
    if (header) {
      if (key === "role") value = header.role === "prime" ? "Prime contractor" : "Subcontractor";
      else if (key === "isFinal") value = header.isFinal ? "Yes" : "No";
      else value = String(header[key] ?? "") || null;
    }
    rows.push([
      { kind: "label", value: label },
      { kind: "input", value },
    ]);
  }
  rows.push([]);

  const dayHeads =
    weekDates?.length === 7 ? weekDates.map((d, i) => `${DAY_NAMES[i]} ${Number(d.slice(5, 7))}/${Number(d.slice(8))}`) : DAY_NAMES;
  rows.push(WORKER_COLUMNS.map((c, i) => ({ kind: "columnHead" as const, value: i >= 5 && i <= 11 ? dayHeads[i - 5] : c })));

  const filled = crew.filter((e) => e.name.trim() || e.hours.some((h) => h.trim()));
  const count = Math.max(filled.length + 5, filled.length === 0 ? blankRows : 0);
  for (let i = 0; i < count; i++) {
    const e = filled[i];
    const excelRow = rows.length + 1;
    const money = (v: string | undefined): WorkbookCell => ({ kind: "input", value: num(v ?? ""), money: true });
    rows.push([
      { kind: "input", value: e?.name.trim() || null },
      { kind: "input", value: e ? lastFour(e.workerId) || null : null },
      { kind: "input", value: e?.classification.trim() || null },
      { kind: "input", value: e ? e.status : null },
      { kind: "input", value: e?.status === "RA" ? e.apprenticeLevel.trim() || null : null },
      ...Array.from({ length: 7 }, (_, d): WorkbookCell => ({ kind: "input", value: num(e?.hours[d] ?? "") })),
      money(e?.baseRate),
      money(e?.fringePlan),
      money(e?.fringeCash),
      money(e?.fica),
      money(e?.federal),
      money(e?.state),
      money(e?.other),
      money(e?.grossAllWork),
      ...formulas(excelRow),
    ]);
  }
  return rows;
}

const norm = (v: Cell) =>
  String(v ?? "")
    .trim()
    .toLowerCase();

function text(v: Cell, money = false): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return money ? v.toFixed(2) : String(Math.round(v * 100) / 100);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

/**
 * Reads a sheet back into a report header and crew, or returns null when
 * the sheet isn't an EasyWH347 workbook (so ordinary payroll exports still
 * go through column matching).
 */
export function readWorkbook(grid: Cell[][]): { header: Partial<ProjectHeader>; crew: CrewEntry[] } | null {
  const headIndex = grid.findIndex((row) => norm(row?.[0]) === "name" && norm(row?.[1]).startsWith("last 4"));
  if (headIndex < 0) return null;

  const header: Partial<ProjectHeader> = {};
  for (const row of grid.slice(0, headIndex)) {
    const spec = HEADER_ROWS.find((h) => norm(row?.[0]) === h.label.toLowerCase());
    if (!spec) continue;
    const raw = row?.[1];
    if (raw === null || raw === undefined || text(raw) === "") continue;
    if (spec.key === "weekEnding") {
      const iso = parseDate(raw);
      if (iso) header.weekEnding = iso;
    } else if (spec.key === "role") {
      header.role = norm(raw).startsWith("prime") ? "prime" : "subcontractor";
    } else if (spec.key === "isFinal") {
      header.isFinal = ["yes", "y", "true", "final"].includes(norm(raw));
    } else {
      (header as Record<string, string>)[spec.key] = text(raw);
    }
  }

  const crew: CrewEntry[] = [];
  for (const row of grid.slice(headIndex + 1)) {
    const cells = WORKER_COLUMNS.slice(0, FIRST_FORMULA_COLUMN).map((_, i) => row?.[i] ?? null);
    if (cells.every((c) => text(c) === "")) continue;
    const status = norm(cells[3]);
    crew.push({
      ...emptyEntry(),
      name: text(cells[0]),
      workerId: lastFour(text(cells[1])),
      classification: text(cells[2]),
      status: status === "ra" || status.startsWith("apprentice") || status.startsWith("registered") ? "RA" : "J",
      apprenticeLevel: text(cells[4]),
      hours: cells.slice(5, 12).map((c) => text(c)),
      baseRate: text(cells[12], true),
      fringePlan: text(cells[13], true),
      fringeCash: text(cells[14], true),
      fica: text(cells[15], true),
      federal: text(cells[16], true),
      state: text(cells[17], true),
      other: text(cells[18], true),
      grossAllWork: text(cells[19], true),
    });
  }
  return { header, crew };
}
