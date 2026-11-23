import { describe, expect, it } from "vitest";
import { emptyEntry, type Payroll, type ProjectHeader } from "../src/core";
import { cannotSave, paymentUrl, projectKey, safeCrew, safePayroll, summarize } from "../src/pro/model";

const header: ProjectHeader = {
  contractorName: "Towle Test Welding",
  contractorAddress: "",
  role: "subcontractor",
  projectName: "Hwy 10 Bridge",
  projectLocation: "Benton County, MN",
  projectNumber: "SP 0502-115",
  payrollNumber: "3",
  weekEnding: "2026-11-21",
  wageDeterminationNumber: "MN20260001",
  isFinal: false,
};

function payroll(rows: Partial<Payroll["rows"][number]>[]): Payroll {
  return {
    header,
    weekDates: [],
    rows: rows.map((r, i) => ({
      entryNumber: i + 1,
      workerName: "A",
      workerId: "123-45-6789",
      status: "J",
      apprenticeLevel: "",
      classification: "Welder",
      days: [],
      totalStraight: 0,
      totalOvertime: 0,
      baseRate: 0,
      overtimeRate: 0,
      fringeCreditedPerHour: 0,
      fringeCashPerHour: 0,
      fringeCreditedTotal: 0,
      fringeCashTotal: 0,
      grossThisProject: 10000,
      grossAllWork: 10000,
      deductions: { fica: 0, federal: 0, state: 0, other: 0 },
      deductionsTotal: 0,
      netPay: 0,
      carriesWorkerTotals: true,
      ...r,
    })),
  };
}

describe("pro records", () => {
  it("groups weeks by project number, falling back to the name", () => {
    expect(projectKey(header)).toBe("sp 0502-115");
    expect(projectKey({ ...header, projectNumber: "  " })).toBe("hwy 10 bridge");
    expect(projectKey({ ...header, projectNumber: "", projectName: "" })).toBe("");
  });

  it("never sends more than the last four digits of an ID", () => {
    const crew = safeCrew([{ ...emptyEntry(), workerId: "123-45-6789" }]);
    expect(crew?.[0].workerId).toBe("6789");
    expect(safeCrew(null)).toBeNull();
    expect(safePayroll(payroll([{}])).rows[0].workerId).toBe("6789");
  });

  it("counts a worker in two classifications once", () => {
    const p = payroll([{ entryNumber: 1 }, { entryNumber: 1, grossThisProject: 5000 }, { entryNumber: 2 }]);
    expect(summarize(p)).toEqual({ workers: 2, grossCents: 25000 });
  });

  it("explains why a week can't be saved", () => {
    expect(cannotSave(header, null)).toMatch(/worker/);
    expect(cannotSave({ ...header, projectName: "", projectNumber: "" }, payroll([{}]))).toMatch(/project/);
    expect(cannotSave(header, payroll([{}]))).toBeNull();
  });

  it("attaches the account to the payment link", () => {
    const url = new URL(paymentUrl("https://buy.stripe.com/test_abc", "user-1", "barb@example.com"));
    expect(url.searchParams.get("client_reference_id")).toBe("user-1");
    expect(url.searchParams.get("prefilled_email")).toBe("barb@example.com");
  });
});
