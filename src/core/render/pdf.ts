import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib";
import { dayLetter, longDate, shortDate } from "../dates";
import type { Payroll, PayrollRow } from "../types";
import { formatHours, formatMoney } from "../units";

const PAGE_W = 792;
const PAGE_H = 612;
const MARGIN = 24;
const INK = rgb(0.08, 0.08, 0.1);
const RULE = rgb(0.45, 0.45, 0.48);
const FAINT = rgb(0.9, 0.9, 0.92);
const ROW_H = 22;

interface Column {
  key: string;
  label: string;
  width: number;
  align?: "left" | "right" | "center";
}

const CONTENT_W = PAGE_W - 2 * MARGIN;

/** Column widths in points. The last column (net pay) takes whatever is left of the content width. */
export function columnLayout(weekDates: string[]): Column[] {
  const days = weekDates.map((d, i) => ({ key: `d${i}`, label: `${dayLetter(d)}\n${shortDate(d)}`, width: 21, align: "center" as const }));
  const cols: Column[] = [
    { key: "entry", label: "#", width: 14, align: "right" },
    { key: "name", label: "(1) Worker\nname / ID", width: 86 },
    { key: "status", label: "(2)\nJ / RA", width: 30, align: "center" },
    { key: "class", label: "(3) Labor\nclassification", width: 70 },
    { key: "so", label: "", width: 11, align: "center" },
    ...days,
    { key: "total", label: "(5)\nTotal", width: 24, align: "right" },
    { key: "rate", label: "(6A)\nRate", width: 32, align: "right" },
    { key: "fringe", label: "(6B) Fringe\ncredited", width: 40, align: "right" },
    { key: "cash", label: "(6C)\nCash", width: 34, align: "right" },
    { key: "grossProject", label: "(7A) Gross\nthis project", width: 44, align: "right" },
    { key: "grossAll", label: "(7B) Gross\nall work", width: 44, align: "right" },
    { key: "fica", label: "(8)\nFICA", width: 32, align: "right" },
    { key: "federal", label: "\nFederal", width: 32, align: "right" },
    { key: "state", label: "\nState", width: 30, align: "right" },
    { key: "other", label: "\nOther", width: 30, align: "right" },
    { key: "net", label: "(9) Net\npay", width: 0, align: "right" },
  ];
  const fixed = cols.reduce((sum, c) => sum + c.width, 0);
  cols[cols.length - 1].width = CONTENT_W - fixed;
  return cols;
}

function fit(font: PDFFont, value: string, size: number, width: number): string {
  if (font.widthOfTextAtSize(value, size) <= width) return value;
  let cut = value;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}…`, size) > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}

function put(
  page: PDFPage,
  font: PDFFont,
  value: string,
  x: number,
  y: number,
  width: number,
  size: number,
  align: Column["align"] = "left",
) {
  const textValue = fit(font, value, size, width - 4);
  const w = font.widthOfTextAtSize(textValue, size);
  const left = align === "right" ? x + width - 2 - w : align === "center" ? x + (width - w) / 2 : x + 2;
  page.drawText(textValue, { x: left, y, size, font, color: INK });
}

function cells(row: PayrollRow, line: "S" | "O"): Record<string, string> {
  const straight = line === "S";
  const out: Record<string, string> = { so: line };
  row.days.forEach((d, i) => {
    out[`d${i}`] = formatHours(straight ? d.straight : d.overtime);
  });
  out.total = formatHours(straight ? row.totalStraight : row.totalOvertime);
  out.rate = straight ? formatMoney(row.baseRate) : row.totalOvertime > 0 ? formatMoney(row.overtimeRate) : "";
  if (straight) {
    out.entry = String(row.entryNumber);
    out.name = row.workerName;
    out.status = row.status;
    out.class = row.classification;
    out.fringe = row.fringeCreditedTotal ? formatMoney(row.fringeCreditedTotal) : "";
    out.cash = row.fringeCashTotal ? formatMoney(row.fringeCashTotal) : "";
    out.grossProject = formatMoney(row.grossThisProject);
    if (row.carriesWorkerTotals) {
      out.grossAll = formatMoney(row.grossAllWork);
      out.fica = formatMoney(row.deductions.fica);
      out.federal = formatMoney(row.deductions.federal);
      out.state = formatMoney(row.deductions.state);
      out.other = formatMoney(row.deductions.other);
      out.net = formatMoney(row.netPay);
    }
  } else {
    out.name = `xxx-xx-${row.workerId}`;
    if (row.status === "RA" && row.apprenticeLevel) out.class = row.apprenticeLevel;
    out.fringe = row.fringeCreditedPerHour ? `@${formatMoney(row.fringeCreditedPerHour)}` : "";
    out.cash = row.fringeCashPerHour ? `@${formatMoney(row.fringeCashPerHour)}` : "";
  }
  return out;
}

function drawHeader(page: PDFPage, payroll: Payroll, bold: PDFFont, regular: PDFFont, pageNo: number, pageCount: number) {
  const h = payroll.header;
  let y = PAGE_H - MARGIN - 10;
  page.drawText("Certified Payroll, Davis-Bacon and Related Acts", { x: MARGIN, y, size: 11, font: bold, color: INK });
  const pageLabel = `Payroll no. ${h.payrollNumber}${h.isFinal ? " (final)" : ""}   ·   Page ${pageNo} of ${pageCount}`;
  page.drawText(pageLabel, { x: PAGE_W - MARGIN - regular.widthOfTextAtSize(pageLabel, 8), y: y + 2, size: 8, font: regular, color: INK });

  y -= 18;
  const pairs: [string, string][] = [
    [h.role === "prime" ? "Prime contractor" : "Subcontractor", h.contractorName],
    ["Address", h.contractorAddress],
    ["Project", h.projectName],
    ["Location", h.projectLocation],
    ["Project / contract no.", h.projectNumber],
    ["Wage determination no.", h.wageDeterminationNumber || "Not given"],
    ["Week ending", longDate(h.weekEnding)],
  ];
  const colW = (PAGE_W - 2 * MARGIN) / 4;
  pairs.forEach(([label, value], i) => {
    const x = MARGIN + (i % 4) * colW;
    const yy = y - Math.floor(i / 4) * 20;
    page.drawText(label.toUpperCase(), { x, y: yy, size: 5.5, font: regular, color: RULE });
    page.drawText(fit(regular, value, 8.5, colW - 8), { x, y: yy - 9, size: 8.5, font: bold, color: INK });
  });
  return y - 44;
}

function drawTableHead(page: PDFPage, cols: Column[], font: PDFFont, top: number) {
  let x = MARGIN;
  page.drawLine({ start: { x: MARGIN, y: top }, end: { x: PAGE_W - MARGIN, y: top }, thickness: 1, color: INK });
  for (const col of cols) {
    const lines = col.label.split("\n");
    lines.forEach((l, i) => put(page, font, l, x, top - 9 - i * 7, col.width, 6, col.align === "right" ? "right" : col.align));
    x += col.width;
  }
  const bottom = top - 24;
  page.drawLine({ start: { x: MARGIN, y: bottom }, end: { x: PAGE_W - MARGIN, y: bottom }, thickness: 0.75, color: INK });
  return bottom;
}

function drawFooter(page: PDFPage, font: PDFFont, last: boolean) {
  const lines = [
    "Hours: S = straight time, O = overtime. Overtime is paid at not less than 1.5 x the basic rate for hours over 40 in the workweek.",
    "(6B) is the total credited to bona fide fringe plans for the week, with the hourly credit below it. (6C) is fringe paid to the worker in cash.",
    "(7B), (8) and (9) cover all work in the week and appear once per worker. Only the last four digits of a worker's SSN are shown.",
  ];
  if (last)
    lines.push(
      "This payroll must be accompanied by the Statement of Compliance (page 2 of Form WH-347), signed by the certifying official.",
    );
  lines.forEach((l, i) => page.drawText(l, { x: MARGIN, y: MARGIN + (lines.length - 1 - i) * 8, size: 6, font, color: RULE }));
}

export async function renderPayrollPdf(payroll: Payroll, statementOfCompliance?: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Certified payroll ${payroll.header.payrollNumber}, week ending ${payroll.header.weekEnding}`);
  doc.setSubject(payroll.header.projectName);
  doc.setCreator("wh347");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const cols = columnLayout(payroll.weekDates);

  const firstTop = PAGE_H - MARGIN - 10 - 18 - 44;
  const usable = firstTop - 24 - (MARGIN + 40);
  const perPage = Math.max(1, Math.floor(usable / ROW_H));
  const pageCount = Math.max(1, Math.ceil(payroll.rows.length / perPage));

  for (let p = 0; p < pageCount; p++) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    const top = drawHeader(page, payroll, bold, regular, p + 1, pageCount);
    let y = drawTableHead(page, cols, bold, top);
    const slice = payroll.rows.slice(p * perPage, (p + 1) * perPage);
    slice.forEach((row, i) => {
      if (i % 2 === 1) page.drawRectangle({ x: MARGIN, y: y - ROW_H, width: PAGE_W - 2 * MARGIN, height: ROW_H, color: FAINT });
      for (const [lineIndex, line] of (["S", "O"] as const).entries()) {
        const values = cells(row, line);
        let x = MARGIN;
        const baseline = y - 8 - lineIndex * 10;
        for (const col of cols) {
          const v = values[col.key];
          if (v) put(page, line === "S" && col.key === "name" ? bold : regular, v, x, baseline, col.width, 7, col.align);
          x += col.width;
        }
      }
      y -= ROW_H;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.25, color: RULE });
    });
    drawFooter(page, regular, p === pageCount - 1);
  }

  if (statementOfCompliance) {
    const official = await PDFDocument.load(statementOfCompliance);
    const lastPage = official.getPageCount() - 1;
    const [copied] = await doc.copyPages(official, [lastPage]);
    doc.addPage(copied);
  }

  return doc.save();
}
