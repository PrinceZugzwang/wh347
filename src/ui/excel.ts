import { type CrewEntry, FIRST_FORMULA_COLUMN, type ProjectHeader, type WorkbookCell, workbookRows } from "../core";

const INK = "#1b1e22";
const RULE = "#c9ccd1";
const CALC = "#eef1f5";

/** Turns the workbook layout into an .xlsx file and hands it to the browser to save. */
export async function downloadWorkbook(fileName: string, header: ProjectHeader | null, crew: CrewEntry[], weekDates: string[] | null) {
  // The Excel writer is only needed on click, so it stays out of the first page load.
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const rows = workbookRows(header, crew, weekDates);
  const span = FIRST_FORMULA_COLUMN + 4;

  const toCell = (c: WorkbookCell) => {
    const ruled = { borderColor: RULE, borderStyle: "thin" as const };
    switch (c.kind) {
      case "title":
        return { value: c.value, fontWeight: "bold" as const, fontSize: 14, textColor: INK, columnSpan: span };
      case "note":
        return { value: c.value, wrap: true, textColor: "#4a5059", columnSpan: span, height: 32, alignVertical: "top" as const };
      case "label":
        return { value: c.value, fontWeight: "bold" as const, textColor: INK };
      case "columnHead":
        return {
          value: c.value,
          fontWeight: "bold" as const,
          wrap: true,
          backgroundColor: "#e3e7ee",
          alignVertical: "bottom" as const,
          ...ruled,
        };
      case "input":
        return c.value === null
          ? { value: undefined, ...ruled }
          : typeof c.value === "number"
            ? { value: c.value, type: Number, format: c.money ? "#,##0.00" : "0.##", ...ruled }
            : { value: c.value, type: String, ...ruled };
      case "formula":
        return { value: c.formula, type: "Formula" as const, format: c.money ? "#,##0.00" : "0.##", backgroundColor: CALC, ...ruled };
    }
  };

  const data = rows.map((row) => row.map(toCell));
  const widths = [24, 11, 22, 7, 13, 7, 7, 7, 7, 7, 7, 7, 9, 10, 10, 9, 9, 9, 10, 14, 8, 9, 12, 11];
  await writeXlsxFile(data, { sheet: "Payroll", columns: widths.map((width) => ({ width })) }).toFile(fileName);
}
