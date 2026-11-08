import { describe, expect, it } from "vitest";
import { buildPayroll, type CrewEntry, clearHours, crewToLines, emptyEntry, type ProjectHeader, workweek } from "../src/core";

const header: ProjectHeader = {
  contractorName: "Bayline Electric Inc.",
  contractorAddress: "1180 Harbor Way, Richmond, CA 94804",
  role: "subcontractor",
  projectName: "Pinole Valley HS Modernization",
  projectLocation: "Pinole, CA",
  projectNumber: "WCCUSD-2026-114",
  payrollNumber: "8",
  weekEnding: "2026-10-31",
  wageDeterminationNumber: "CA20260001",
  isFinal: false,
};
const week = workweek(header.weekEnding);

function worker(over: Partial<CrewEntry>): CrewEntry {
  return { ...emptyEntry(), name: "Ortiz, Maria", workerId: "4821", classification: "Electrician", baseRate: "48.10", ...over };
}

describe("typed payroll", () => {
  it("builds the same payroll rows as an export, overtime included", () => {
    const crew = [worker({ hours: ["", "10", "10", "10", "10", "4", ""], fringePlan: "21.30", fica: "180.00", federal: "250.00" })];
    const { lines, issues } = crewToLines(crew, week);
    expect(issues).toEqual([]);
    expect(lines).toHaveLength(5);
    const { payroll } = buildPayroll(header, lines);
    const row = payroll.rows[0];
    expect(row.totalStraight).toBe(40_00);
    expect(row.totalOvertime).toBe(4_00);
    expect(row.overtimeRate).toBe(7215);
    // 40 x 48.10 + 4 x 72.15; plan fringe is credited, not paid in cash
    expect(row.grossThisProject).toBe(192_400 + 28_860);
    // deductions typed once are counted once, not once per day worked
    expect(row.deductionsTotal).toBe(43_000);
    expect(row.netPay).toBe(192_400 + 28_860 - 43_000);
  });

  it("skips untouched rows and explains what an incomplete one is missing", () => {
    const crew = [emptyEntry(), worker({ name: "", baseRate: "", hours: ["", "8", "", "", "", "", ""] })];
    const { lines, issues } = crewToLines(crew, week);
    expect(lines).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("add a name");
    expect(issues[0].message).toContain("add the hourly rate");
  });

  it("never carries a full SSN into the payroll", () => {
    const { lines } = crewToLines([worker({ workerId: "123-45-6789", hours: ["", "8", "", "", "", "", ""] })], week);
    expect(lines[0].workerId).toBe("6789");
  });

  it("leaves a regular with no hours this week off the payroll without blocking it", () => {
    const crew = [worker({ hours: ["", "8", "", "", "", "", ""] }), worker({ name: "Chen, David", workerId: "5530" })];
    const { lines, issues } = crewToLines(crew, week);
    expect(lines).toHaveLength(1);
    expect(issues.map((i) => i.level)).toEqual(["warning"]);
  });

  it("rejects hours it can't read instead of guessing", () => {
    const { lines, issues } = crewToLines([worker({ hours: ["", "eight", "", "", "", "", ""] })], week);
    expect(lines).toEqual([]);
    expect(issues[0].message).toContain('hours "eight"');
  });

  it("clears only the hours when starting next week", () => {
    const crew = [worker({ hours: ["", "8", "8", "", "", "", ""], fringePlan: "21.30" })];
    const next = clearHours(crew)[0];
    expect(next.hours.every((h) => h === "")).toBe(true);
    expect(next.name).toBe("Ortiz, Maria");
    expect(next.fringePlan).toBe("21.30");
  });
});
