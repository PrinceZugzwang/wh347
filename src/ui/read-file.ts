import Papa from "papaparse";
import type { Cell } from "../core";

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
