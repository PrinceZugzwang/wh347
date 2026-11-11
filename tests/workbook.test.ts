import { describe, expect, it } from "vitest";
import {
  type Cell,
  type CrewEntry,
  emptyEntry,
  type ProjectHeader,
  readWorkbook,
  WORKER_COLUMNS,
  type WorkbookCell,
  workbookRows,
  workweek,
} from "../src/core";

const header: ProjectHeader = {
  contractorName: "Towle Test Welding",
  contractorAddress: "1 Main St, St. Cloud, MN",
  role: "subcontractor",
  projectName: "Bridge 27",
  projectLocation: "St. Cloud, MN",
  projectNumber: "SP 7302-55",
  payrollNumber: "4",
  weekEnding: "2026-11-07",
  wageDeterminationNumber: "MN20260013",
  isFinal: false,
};
const week = workweek(header.weekEnding);

/** What Excel hands back: typed values as they are, formulas not yet calculated. */
function asRead(rows: WorkbookCell[][]): Cell[][] {
  return rows.map((row) => row.map((c) => (c.kind === "formula" ? null : c.value)));
}

describe("payroll workbook", () => {
  it("round-trips a typed week through Excel", () => {
    const crew: CrewEntry[] = [
      {
        ...emptyEntry(),
        name: "Ortiz, Maria",
        workerId: "123-45-4821",
        classification: "Welder",
        hours: ["", "10", "10", "10", "10", "4", ""],
        baseRate: "41.50",
        fringePlan: "18.20",
        fica: "180.00",
      },
      {
        ...emptyEntry(),
        name: "Chen, David",
        workerId: "5530",
        classification: "Welder",
        status: "RA",
        apprenticeLevel: "2nd period",
        hours: ["", "8", "8", "", "", "", ""],
        baseRate: "24.90",
      },
    ];
    const back = readWorkbook(asRead(workbookRows(header, crew, week)));
    expect(back).not.toBeNull();
    expect(back!.header).toEqual(header);
    expect(back!.crew).toHaveLength(2);
    const [a, b] = back!.crew;
    expect(a).toMatchObject({
      name: "Ortiz, Maria",
      workerId: "4821",
      hours: ["", "10", "10", "10", "10", "4", ""],
      baseRate: "41.50",
      fica: "180.00",
    });
    expect(b).toMatchObject({ status: "RA", apprenticeLevel: "2nd period", hours: ["", "8", "8", "", "", "", ""] });
  });

  it("never writes a full SSN into the file", () => {
    const rows = workbookRows(
      header,
      [{ ...emptyEntry(), name: "A", workerId: "123-45-6789", hours: ["8", "", "", "", "", "", ""] }],
      week,
    );
    expect(JSON.stringify(rows)).not.toContain("123-45");
  });

  it("gives a blank template with formulas for every worker row", () => {
    const rows = workbookRows(null, [], null);
    const table = rows.findIndex((r) => r[0]?.kind === "columnHead");
    expect(rows[table].map((c) => ("value" in c ? c.value : ""))).toEqual([...WORKER_COLUMNS]);
    expect(rows.length - table - 1).toBe(25);
    const first = rows[table + 1];
    expect(first.filter((c) => c.kind === "formula")).toHaveLength(4);
    // Excel row numbers in the formulas point at their own row.
    const formula = first.find((c) => c.kind === "formula");
    expect(formula && "formula" in formula && formula.formula).toContain(`F${table + 2}:L${table + 2}`);
  });

  it("reads dates and words the way people type them in Excel", () => {
    const grid = asRead(workbookRows(null, [], null));
    const at = (label: string) => grid.findIndex((r) => r[0] === label);
    grid[at("Week ending (a Saturday)")][1] = new Date(Date.UTC(2026, 10, 14));
    grid[at("Prime contractor or subcontractor")][1] = "prime";
    grid[at("Final payroll (yes or no)")][1] = "Yes";
    const head = grid.findIndex((r) => r[0] === "Name");
    grid[head + 1] = ["Lee, Sam", 7731, "Laborer", "J", null, null, 8, 8, 8.5, null, null, null, 31.85, 15.5];
    const back = readWorkbook(grid)!;
    expect(back.header).toMatchObject({ weekEnding: "2026-11-14", role: "prime", isFinal: true });
    expect(back.crew[0]).toMatchObject({
      workerId: "7731",
      hours: ["", "8", "8", "8.5", "", "", ""],
      baseRate: "31.85",
      fringePlan: "15.50",
    });
  });

  it("leaves ordinary payroll exports alone", () => {
    expect(
      readWorkbook([
        ["Employee", "Date", "Hours"],
        ["Ortiz", "2026-11-02", 8],
      ]),
    ).toBeNull();
  });
});
