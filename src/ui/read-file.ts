import Papa from "papaparse";
import { type Cell, readWorkbook } from "../core";

export async function readGrid(file: File): Promise<Cell[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx")) {
    const { readSheet } = await import("read-excel-file/browser");
    return (await readSheet(file)) as Cell[][];
  }
  if (name.endsWith(".xls")) {
    throw new Error("Old .xls files can't be read. Save the export as .xlsx or .csv and try again.");
  }
  const textContent = await file.text();
  const parsed = Papa.parse<Cell[]>(textContent, { skipEmptyLines: true });
  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    throw new Error(`Couldn't read ${file.name}: ${parsed.errors[0].message}`);
  }
  return parsed.data;
}

/**
 * If the file is an EasyWH347 payroll workbook (the Excel template or a week
 * downloaded from the form), returns the header and crew in it; otherwise null.
 */
export async function readPayrollWorkbook(file: File) {
  if (!file.name.toLowerCase().endsWith(".xlsx")) return null;
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  for (const sheet of await readXlsxFile(file)) {
    const found = readWorkbook(sheet.data as Cell[][]);
    if (found) return found;
  }
  return null;
}
