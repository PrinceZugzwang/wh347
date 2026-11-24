import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { buildPayroll, type Cell, type ProjectHeader, proposeMapping, readTimecards, toSheet } from "../src/core";
import { type CaDetails, type NyDetails, renderCaEcpr, renderNyXml, splitName, workersOf } from "../src/core/render/state";

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

function samplePayroll() {
  const csv = readFileSync(new URL("../fixtures/sample-timecards.csv", import.meta.url), "utf8");
  const sheet = toSheet(Papa.parse<Cell[]>(csv, { skipEmptyLines: true }).data);
  const { lines } = readTimecards(sheet, proposeMapping(sheet.headers));
  return buildPayroll(header, lines).payroll;
}

const address = { street: "12 Oak St", city: "Richmond", state: "CA", zip: "94801" };

function caDetails(payroll: ReturnType<typeof samplePayroll>): CaDetails {
  const workers: CaDetails["workers"] = {};
  workersOf(payroll).forEach((w, i) => {
    workers[w.key] = { ...address, ssn: `55500${String(1000 + i)}`, checkNum: String(5000 + i) };
  });
  return { contractorPWCR: "1000012345", projectId: "456789", workers };
}

function nyDetails(payroll: ReturnType<typeof samplePayroll>): NyDetails {
  const workers: NyDetails["workers"] = {};
  for (const w of workersOf(payroll)) workers[w.key] = { ...address, state: "NY", zip: "12207-0002" };
  return { prcNumber: "2026001234", workers };
}

/** Tag names in document order, without the CPR: prefix. */
function tags(xml: string): string[] {
  return [...xml.matchAll(/<(?:CPR:)?([A-Za-z]+)[\s>]/g)].map((m) => m[1]);
}

describe("names", () => {
  it("splits both name orders", () => {
    expect(splitName("Ramirez, Daniel")).toEqual({ first: "Daniel", middle: "", last: "Ramirez" });
    expect(splitName("Okafor, Grace A")).toEqual({ first: "Grace", middle: "A", last: "Okafor" });
    expect(splitName("Tom Lindqvist")).toEqual({ first: "Tom", middle: "", last: "Lindqvist" });
  });
});

describe("California eCPR", () => {
  it("lists what's missing instead of producing a partial file", () => {
    const payroll = samplePayroll();
    const out = renderCaEcpr(payroll, { contractorPWCR: "123", projectId: "", workers: {} });
    expect(out.xml).toBeNull();
    expect(out.missing).toContain("DIR contractor registration number (10 digits)");
    expect(out.missing).toContain("DIR project ID (numbers only)");
    expect(out.missing.some((m) => m.includes("full 9-digit SSN"))).toBe(true);
  });

  it("follows the element order of DIR's V2 sample", () => {
    const payroll = samplePayroll();
    const { xml, missing } = renderCaEcpr(payroll, caDetails(payroll));
    expect(missing).toEqual([]);
    const t = tags(xml!);
    // Top of DIR's V2-eCPR-Sample-Schema.xml.
    expect(t.slice(0, 12)).toEqual([
      "eCPR",
      "version",
      "contractorInfo",
      "contractorName",
      "contractorPWCR",
      "projectInfo",
      "awardingBody",
      "projectID",
      "payrollInfo",
      "statementOfNP",
      "forWeekEnding",
      "employees",
    ]);
    // An employee, as in the sample.
    const employee = t.slice(t.indexOf("employee"), t.indexOf("classifications") + 1);
    expect(employee).toEqual([
      "employee",
      "firstName",
      "lastName",
      "middleName",
      "address",
      "street",
      "city",
      "state",
      "zip",
      "ssn",
      "itin",
      "notes",
      "classifications",
    ]);
    const classification = t.slice(t.indexOf("classification"), t.indexOf("day"));
    expect(classification).toEqual(["classification", "craft", "employeeLevel", "apprenticeLevel", "hrsWorkedEachDay"]);
    const tail = t.slice(t.indexOf("payments"), t.indexOf("checkNum") + 1);
    expect(tail).toEqual([
      "payments",
      "travelSubs",
      "deductions",
      "fedTax",
      "FICA",
      "stateTax",
      "SDI",
      "fundAdmin",
      "savings",
      "dues",
      "other",
      "totalDeductions",
      "earnings",
      "grossThisProject",
      "grossAllWork",
      "netWagePaidWeek",
      "checkNum",
    ]);
    expect(xml).toContain('xmlns:CPR="https://www.dir.ca.gov/Public-Works/CPR/eCPR-v2.xsd"');
  });

  it("keeps DIR's arithmetic rules: 7 days ending on the week, totals that add up", () => {
    const payroll = samplePayroll();
    const xml = renderCaEcpr(payroll, caDetails(payroll)).xml!;
    const firstClass = xml.slice(xml.indexOf("<CPR:classification "), xml.indexOf("</CPR:classification>"));
    const ids = [...firstClass.matchAll(/<CPR:day id="(\d)">/g)].map((m) => m[1]);
    expect(ids).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(firstClass).toContain("<CPR:date>2026-10-24</CPR:date>\n");
    const st = [...firstClass.matchAll(/<CPR:straightTime>([\d.]+)</g)].reduce((s, m) => s + Number(m[1]), 0);
    const total = Number(/<CPR:totHrsStraightTime>([\d.]+)</.exec(firstClass)![1]);
    expect(st).toBeCloseTo(total, 2);
    // Ramirez: 40 straight at 48.10 + 5 overtime at 72.15, fringe 19.75 + 1.55 cash.
    expect(firstClass).toContain("<CPR:hrlyPayRateStraightTime>48.10<");
    expect(firstClass).toContain("<CPR:totalHrlyPayRateStraightTime>69.40<");
    expect(firstClass).toContain("<CPR:paidToEmployee>true<");
    expect(firstClass).toContain("<CPR:paidToBenefitPlan>true<");
    const deductions = xml.slice(xml.indexOf("<CPR:deductions>"), xml.indexOf("</CPR:deductions>"));
    const parts = ["fedTax", "FICA", "stateTax", "SDI", "fundAdmin", "savings", "dues", "other"].map((k) =>
      Number(new RegExp(`<CPR:${k}>([\\d.]+)<`).exec(deductions)![1]),
    );
    const totalDeductions = Number(/<CPR:totalDeductions>([\d.]+)</.exec(deductions)![1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(totalDeductions, 2);
  });

  it("puts a worker with two classifications under one employee", () => {
    const payroll = samplePayroll();
    const xml = renderCaEcpr(payroll, caDetails(payroll)).xml!;
    expect((xml.match(/<CPR:employee>/g) ?? []).length).toBe(3);
    expect((xml.match(/<CPR:classification /g) ?? []).length).toBe(4);
  });
});

describe("New York bulk upload", () => {
  it("lists what's missing instead of producing a partial file", () => {
    const out = renderNyXml(samplePayroll(), { prcNumber: "", workers: {} });
    expect(out.xml).toBeNull();
    expect(out.missing[0]).toContain("PRC");
  });

  it("validates against NY DOL's own schema", () => {
    const payroll = samplePayroll();
    const { xml, missing } = renderNyXml(payroll, nyDetails(payroll));
    expect(missing).toEqual([]);
    const dir = mkdtempSync(join(tmpdir(), "nyxml-"));
    const file = join(dir, "payroll.xml");
    writeFileSync(file, xml!);
    const xsd = new URL("../fixtures/state/NYDOL_CertPayroll.xsd", import.meta.url).pathname;
    // Throws (failing the test) if xmllint rejects the file.
    const result = execFileSync("xmllint", ["--noout", "--schema", xsd, file], { encoding: "utf8", stdio: "pipe" });
    expect(result).toBe("");
    expect(xml).toContain("<weekEndingDate>2026-10-24T00:00:00.000Z</weekEndingDate>");
    expect(xml).toContain("<postalCodeExt>0002</postalCodeExt>");
  });
});
