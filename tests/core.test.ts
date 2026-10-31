import { readFileSync } from "node:fs";
import Papa from "papaparse";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  buildPayroll,
  type Cell,
  extend,
  missingRequired,
  parseDate,
  parseHours,
  parseMoney,
  parseRates,
  type ProjectHeader,
  proposeMapping,
  readTimecards,
  timeAndHalf,
  toSheet,
  validateHeader,
  validatePayroll,
  workweek,
} from "../src/core";
import { renderPayrollCsv } from "../src/core/render/csv";
import { columnLayout, renderPayrollPdf } from "../src/core/render/pdf";

const header: ProjectHeader = {
  contractorName: "Bayline Electric Inc.",
  contractorAddress: "1180 Harbor Way, Richmond, CA 94804",
  role: "subcontractor",
  projectName: "Pinole Valley HS Modernization",
  projectLocation: "Pinole, CA",
  projectNumber: "WCCUSD-2026-114",
  payrollNumber: "7",
  weekEnding: "2026-10-24",
  wageDeterminationNumber: "CA20260001",
  isFinal: false,
};

function loadFixture() {
  const csv = readFileSync(new URL("../fixtures/sample-timecards.csv", import.meta.url), "utf8");
  const grid = Papa.parse<Cell[]>(csv, { skipEmptyLines: true }).data;
  const sheet = toSheet(grid);
  const mapping = proposeMapping(sheet.headers);
  return { sheet, mapping, ...readTimecards(sheet, mapping) };
}

describe("units", () => {
  it("parses money the way exports write it", () => {
    expect(parseMoney("$1,234.50")).toBe(123450);
    expect(parseMoney("(12.00)")).toBe(-1200);
    expect(parseMoney(48.1)).toBe(4810);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("n/a")).toBeNull();
  });

  it("parses decimal and clock hours", () => {
    expect(parseHours("7.5")).toBe(750);
    expect(parseHours("7:30")).toBe(750);
    expect(parseHours(8)).toBe(800);
    expect(parseHours("eight")).toBeNull();
  });

  it("extends rates without float drift", () => {
    expect(extend(4810, 4000)).toBe(192400);
    expect(extend(3333, 750)).toBe(24998);
    expect(timeAndHalf(4810)).toBe(7215);
    expect(timeAndHalf(2645)).toBe(3968);
  });
});

describe("dates", () => {
  it("accepts US and ISO dates and rejects impossible ones", () => {
    expect(parseDate("10/19/2026")).toBe("2026-10-19");
    expect(parseDate("10/19/26")).toBe("2026-10-19");
    expect(parseDate("2026-10-19")).toBe("2026-10-19");
    expect(parseDate("02/30/2026")).toBeNull();
  });

  it("builds the seven days ending on the week-ending date", () => {
    expect(workweek("2026-10-24")).toEqual([
      "2026-10-18",
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
    ]);
  });
});

describe("column mapping", () => {
  it("maps the sample export without help", () => {
    const { mapping, sheet } = loadFixture();
    const named = Object.fromEntries(Object.entries(mapping).map(([f, i]) => [f, sheet.headers[i as number]]));
    expect(named).toMatchObject({
      workerName: "Employee Name",
      workerId: "SSN",
      status: "Worker Type",
      apprenticeLevel: "Apprentice Level",
      classification: "Craft",
      date: "Date Worked",
      hours: "Reg Hrs",
      baseRate: "Pay Rate",
      fringeCredited: "Fringe Credit",
      fringeCash: "Cash in Lieu",
      fica: "FICA",
      federal: "Fed Tax",
      state: "State Tax",
      other: "Other Deductions",
      grossAllWork: "Total Gross",
    });
    expect(missingRequired(mapping)).toEqual([]);
  });

  it("does not let a generic synonym steal a specific column", () => {
    const mapping = proposeMapping(["Name", "Emp ID", "Class", "Date", "Hours", "OT Hours", "Rate", "OT Rate"]);
    expect(mapping.overtimeRate).toBe(7);
    expect(mapping.baseRate).toBe(6);
    expect(mapping.overtimeHours).toBe(5);
    expect(mapping.hours).toBe(4);
  });

  it("reports missing required columns", () => {
    expect(missingRequired(proposeMapping(["Employee", "Date", "Hours"]))).toEqual(["workerId", "classification", "baseRate"]);
  });
});

describe("payroll", () => {
  it("keeps only the last four SSN digits and flags full SSNs", () => {
    const { lines, issues } = loadFixture();
    expect(new Set(lines.map((l) => l.workerId))).toEqual(new Set(["7731", "2286", "0415"]));
    expect(issues.filter((i) => i.code === "full-ssn-in-source")).toHaveLength(1);
  });

  it("moves hours past 40 into overtime and pays time and a half", () => {
    const { lines } = loadFixture();
    const { payroll } = buildPayroll(header, lines);
    const ramirez = payroll.rows.find((r) => r.workerName.startsWith("Ramirez"));
    expect(ramirez).toBeDefined();
    if (!ramirez) return;
    expect(ramirez.totalStraight).toBe(4000);
    expect(ramirez.totalOvertime).toBe(500);
    expect(ramirez.days.find((d) => d.date === "2026-10-23")).toEqual({ date: "2026-10-23", straight: 400, overtime: 500 });
    expect(ramirez.overtimeRate).toBe(7215);
    // 40 x 48.10 + 5 x 72.15 + 45 x 1.55 cash in lieu
    expect(ramirez.grossThisProject).toBe(192400 + 36075 + 6975);
    expect(ramirez.fringeCreditedTotal).toBe(88875);
    expect(ramirez.deductionsTotal).toBe(17003 + 24100 + 9620 + 2500);
    expect(ramirez.netPay).toBe(ramirez.grossAllWork - ramirez.deductionsTotal);
  });

  it("splits a worker across classifications under one entry number", () => {
    const { lines } = loadFixture();
    const { payroll } = buildPayroll(header, lines);
    const tom = payroll.rows.filter((r) => r.workerName.startsWith("Lindqvist"));
    expect(tom.map((r) => r.classification)).toEqual(["Laborer, Group 2", "Operator, Group 4"]);
    expect(new Set(tom.map((r) => r.entryNumber)).size).toBe(1);
    expect(tom[1].totalStraight).toBe(1600);
    expect(tom[1].totalOvertime).toBe(400);
    expect(tom.filter((r) => r.carriesWorkerTotals)).toHaveLength(1);
    expect(tom[0].grossAllWork).toBe(tom[0].grossThisProject + tom[1].grossThisProject);
  });

  it("drops rows outside the workweek with an error", () => {
    const { lines } = loadFixture();
    const stray = { ...lines[0], sourceRow: 99, date: "2026-10-26" };
    const { payroll, issues } = buildPayroll(header, [...lines, stray]);
    expect(issues.some((i) => i.code === "date-outside-week" && i.sourceRow === 99)).toBe(true);
    expect(payroll.rows.flatMap((r) => r.days).every((d) => d.date <= "2026-10-24")).toBe(true);
  });

  it("flags a payroll that pays straight time past 40 hours", () => {
    const { lines } = loadFixture();
    const explicit = lines.map((l) => ({ ...l, overtimeHours: 0 }));
    const { issues } = buildPayroll(header, explicit);
    expect(issues.some((i) => i.code === "overtime-under-reported")).toBe(true);
  });
});

describe("wage determination checks", () => {
  const wd = readFileSync(new URL("../fixtures/sample-wage-determination.txt", import.meta.url), "utf8");

  it("reads rates pasted from SAM.gov", () => {
    expect(parseRates(wd)).toEqual([
      { classification: "ELECTRICIAN", base: 4810, fringe: 2130 },
      { classification: "LABORER, GROUP 2", base: 3185, fringe: 1550 },
      { classification: "OPERATOR, GROUP 4", base: 4420, fringe: 1910 },
    ]);
  });

  it("passes the sample payroll", () => {
    const { lines } = loadFixture();
    const { payroll } = buildPayroll(header, lines);
    const errors = validatePayroll(payroll, parseRates(wd)).filter((i) => i.level === "error");
    expect(errors).toEqual([]);
  });

  it("catches underpaid base and fringe", () => {
    const { lines } = loadFixture();
    const cheap = lines.map((l) => (l.workerName.startsWith("Ramirez") ? { ...l, baseRate: 4500, fringeCash: 0 } : l));
    const { payroll } = buildPayroll(header, cheap);
    const codes = validatePayroll(payroll, parseRates(wd)).map((i) => i.code);
    expect(codes).toContain("below-prevailing-base");
    expect(codes).toContain("below-prevailing-fringe");
  });

  it("requires the header fields that go on the form", () => {
    const codes = validateHeader({ ...header, projectNumber: "", wageDeterminationNumber: "" }).map((i) => i.code);
    expect(codes).toEqual(["header-missing", "header-wd-missing"]);
  });
});

describe("output", () => {
  it("renders a PDF and a CSV", async () => {
    const { lines } = loadFixture();
    const { payroll } = buildPayroll(header, lines);
    const pdf = await renderPayrollPdf(payroll);
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(1);
    const csv = renderPayrollCsv(payroll);
    expect(csv.split("\n")).toHaveLength(payroll.rows.length + 1);
    expect(csv).not.toMatch(/512-48-7731/);
  });

  it("lays the columns out inside a landscape Letter page with room for net pay", () => {
    const cols = columnLayout(workweek("2026-10-24"));
    expect(cols.reduce((sum, c) => sum + c.width, 0)).toBe(792 - 48);
    // "99,999.99" in 7pt Helvetica is about 31pt wide.
    expect(cols.at(-1)?.width).toBeGreaterThanOrEqual(40);
  });

  it("appends the official Statement of Compliance page when supplied", async () => {
    const official = await PDFDocument.create();
    official.addPage();
    official.addPage();
    const { lines } = loadFixture();
    const { payroll } = buildPayroll(header, lines);
    const doc = await PDFDocument.load(await renderPayrollPdf(payroll, await official.save()));
    expect(doc.getPageCount()).toBe(2);
  });
});
