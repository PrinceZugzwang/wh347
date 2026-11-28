// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { buildPayroll, type Cell, type ProjectHeader, proposeMapping, readTimecards, toSheet } from "../src/core";
import { checkEcpr } from "../src/core/ecprCheck";
import { renderCaEcpr, workersOf } from "../src/core/render/state";

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

function goodXml(): string {
  const csv = readFileSync(join(import.meta.dirname, "../fixtures/sample-timecards.csv"), "utf8");
  const sheet = toSheet(Papa.parse<Cell[]>(csv, { skipEmptyLines: true }).data);
  const payroll = buildPayroll(header, readTimecards(sheet, proposeMapping(sheet.headers)).lines).payroll;
  const workers: Record<string, { street: string; city: string; state: string; zip: string; ssn: string; checkNum: string }> = {};
  workersOf(payroll).forEach((w, i) => {
    workers[w.key] = {
      street: "12 Oak St",
      city: "Richmond",
      state: "CA",
      zip: "94801",
      ssn: `55500${1000 + i}`,
      checkNum: String(5000 + i),
    };
  });
  const { xml } = renderCaEcpr(payroll, { contractorPWCR: "1000012345", projectId: "456789", workers });
  return xml!;
}

describe("eCPR checker", () => {
  it("passes a file our own exporter makes", () => {
    const r = checkEcpr(goodXml());
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.employees).toBeGreaterThan(0);
  });

  it("rejects text that isn't XML", () => {
    expect(checkEcpr("<CPR:eCPR><oops></CPR:eCPR>").problems[0].topic).toBe("not-xml");
  });

  it("catches the common rejections", () => {
    const bad = goodXml()
      .replace("<CPR:contractorPWCR>1000012345", "<CPR:contractorPWCR>NA")
      .replace("<CPR:employeeLevel>journeyman", "<CPR:employeeLevel>Journeyman")
      .replace(/<CPR:totalDeductions>[\d.]+/, "<CPR:totalDeductions>1.23")
      .replace("<CPR:version>2.0</CPR:version>", "<CPR:version>2.0</CPR:version><CPR:contractorFEIN>12</CPR:contractorFEIN>");
    const topics = checkEcpr(bad).problems.map((p) => p.topic);
    expect(topics).toEqual(expect.arrayContaining(["pwcr", "apprentice", "deductions", "v1-fields"]));
  });

  it("catches totals that don't match the days", () => {
    const bad = goodXml().replace(/<CPR:totHrsStraightTime>[\d.]+/, "<CPR:totHrsStraightTime>99.00");
    expect(checkEcpr(bad).problems.some((p) => p.topic === "totals")).toBe(true);
  });

  it("checks the day dates against the week ending", () => {
    const bad = goodXml().replace("<CPR:date>2026-10-18</CPR:date>", "<CPR:date>2026-10-19</CPR:date>");
    expect(checkEcpr(bad).problems.some((p) => p.topic === "dates")).toBe(true);
  });
});
