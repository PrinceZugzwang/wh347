import { useEffect, useMemo, useState } from "preact/hooks";
import {
  buildPayroll,
  type Cell,
  type ColumnMapping,
  FIELD_LABELS,
  addDays,
  formatHours,
  formatMoney,
  type Issue,
  missingRequired,
  parseRates,
  type ProjectHeader,
  proposeMapping,
  readTimecards,
  type Sheet,
  toSheet,
  validateHeader,
  shortDate,
  validatePayroll,
} from "../core";
import { renderPayrollCsv } from "../core/render/csv";
import { download } from "./download";
import { HeaderForm } from "./HeaderForm";
import { IssueList } from "./IssueList";
import { MappingTable } from "./MappingTable";
import { PayrollPreview } from "./PayrollPreview";
import { readGrid } from "./read-file";
import { load, save } from "./storage";

const EMPTY_HEADER: ProjectHeader = {
  contractorName: "",
  contractorAddress: "",
  role: "subcontractor",
  projectName: "",
  projectLocation: "",
  projectNumber: "",
  payrollNumber: "1",
  weekEnding: "",
  wageDeterminationNumber: "",
  isFinal: false,
};

const SAMPLE_HEADER: ProjectHeader = {
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

const OFFICIAL_FORM_URL = "https://www.dol.gov/agencies/whd/forms/wh347";

async function fetchBundledForm(): Promise<Uint8Array | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}forms/wh347.pdf`);
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("pdf")) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export function App() {
  const [header, setHeader] = useState<ProjectHeader>(() => load("header", EMPTY_HEADER));
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState("");
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [ratesText, setRatesText] = useState(() => load("rates", { text: "" }).text);
  const [officialForm, setOfficialForm] = useState<Uint8Array | null>(null);
  const [officialFormSource, setOfficialFormSource] = useState<"bundled" | "uploaded" | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => save("header", header), [header]);
  useEffect(() => save("rates", { text: ratesText }), [ratesText]);
  useEffect(() => {
    fetchBundledForm().then((bytes) => {
      if (bytes) {
        setOfficialForm(bytes);
        setOfficialFormSource("bundled");
      }
    });
  }, []);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setFileError("");
    try {
      const grid: Cell[][] = await readGrid(file);
      const next = toSheet(grid);
      const saved = load<{ headers: string[]; mapping: ColumnMapping }>("mapping", { headers: [], mapping: {} });
      const sameLayout = saved.headers.join("\u0000") === next.headers.join("\u0000");
      setSheet(next);
      setFileName(file.name);
      setMapping(sameLayout ? saved.mapping : proposeMapping(next.headers));
    } catch (err) {
      setSheet(null);
      setFileError(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadSample() {
    const base = import.meta.env.BASE_URL;
    const [csv, wd] = await Promise.all([
      fetch(`${base}sample-timecards.csv`).then((r) => r.blob()),
      fetch(`${base}sample-wage-determination.txt`).then((r) => r.text()),
    ]);
    setHeader(SAMPLE_HEADER);
    setRatesText(wd);
    await onFile(new File([csv], "sample-timecards.csv", { type: "text/csv" }));
    window.scrollTo({ top: 0 });
  }

  async function onOfficialForm(file: File | undefined) {
    if (!file) return;
    setOfficialForm(new Uint8Array(await file.arrayBuffer()));
    setOfficialFormSource("uploaded");
  }

  // Accept a file dropped anywhere on the page. Without this, a drop that
  // misses the upload box makes the browser open the file and leave the site.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const file = e.dataTransfer?.files[0];
      if (!file) return;
      if (/\.pdf$/i.test(file.name)) void onOfficialForm(file);
      else void onFile(file);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  // Fetch the lazily loaded parts early, so the page keeps working with the
  // connection off. That is also how a user can check nothing is uploaded.
  useEffect(() => {
    const id = setTimeout(() => {
      void import("../core/render/pdf");
      void import("read-excel-file/browser");
    }, 1200);
    return () => clearTimeout(id);
  }, []);

  function onMapping(next: ColumnMapping) {
    setMapping(next);
    if (sheet) save("mapping", { headers: sheet.headers, mapping: next });
  }

  const missing = useMemo(() => missingRequired(mapping), [mapping]);

  // Most exports don't carry the week-ending date, so suggest the Saturday that closes the last day worked.
  useEffect(() => {
    if (!sheet || missing.length > 0 || header.weekEnding) return;
    const last = readTimecards(sheet, mapping)
      .lines.map((l) => l.date)
      .sort()
      .at(-1);
    if (!last) return;
    const weekday = new Date(`${last}T00:00:00Z`).getUTCDay();
    setHeader((h) => ({ ...h, weekEnding: addDays(last, (6 - weekday) % 7) }));
  }, [sheet, mapping, missing, header.weekEnding]);
  const rates = useMemo(() => parseRates(ratesText), [ratesText]);

  const result = useMemo(() => {
    if (!sheet || missing.length > 0 || !header.weekEnding) return null;
    const read = readTimecards(sheet, mapping);
    const built = buildPayroll(header, read.lines);
    const issues: Issue[] = [...validateHeader(header), ...read.issues, ...built.issues, ...validatePayroll(built.payroll, rates)];
    return { payroll: built.payroll, issues };
  }, [sheet, mapping, header, rates, missing]);

  const errors = result?.issues.filter((i) => i.level === "error").length ?? 0;
  const ready = result !== null && errors === 0 && result.payroll.rows.length > 0;
  const totals = result
    ? {
        workers: new Set(result.payroll.rows.map((r) => r.entryNumber)).size,
        hours: result.payroll.rows.reduce((sum, r) => sum + r.totalStraight + r.totalOvertime, 0),
        overtime: result.payroll.rows.reduce((sum, r) => sum + r.totalOvertime, 0),
        gross: result.payroll.rows.reduce((sum, r) => sum + r.grossThisProject, 0),
        net: result.payroll.rows.reduce((sum, r) => sum + (r.carriesWorkerTotals ? r.netPay : 0), 0),
      }
    : null;
  const baseName = `certified-payroll-${header.payrollNumber || "x"}-we-${header.weekEnding || "date"}`;

  async function onDownloadPdf() {
    if (!result) return;
    setBusy(true);
    try {
      // pdf-lib is most of the bundle, so it loads only when someone downloads.
      const { renderPayrollPdf } = await import("../core/render/pdf");
      const bytes = await renderPayrollPdf(result.payroll, officialForm ?? undefined);
      download(bytes, `${baseName}.pdf`, "application/pdf");
    } finally {
      setBusy(false);
    }
  }

  const status = !sheet
    ? ""
    : missing.length > 0
      ? `Match ${missing.length === 1 ? "the last required column" : `${missing.length} required columns`} to continue.`
      : !result
        ? "Add the week ending date."
        : errors > 0
          ? `${errors} ${errors === 1 ? "problem" : "problems"} to fix before you can download.`
          : `Ready to sign. Week ending ${shortDate(header.weekEnding)}, ${totals?.workers ?? 0} ${totals?.workers === 1 ? "worker" : "workers"}.`;

  return (
    <>
      <header class="top">
        <a class="name" href={import.meta.env.BASE_URL}>
          EasyWH347
        </a>
        <span class="what">Certified payroll for Davis-Bacon jobs</span>
        <a class="how-link" href="#how">
          How it works
        </a>
      </header>

      {!sheet ? (
        <main class="start">
          <h1>
            Upload this week's payroll export. <br />
            Get back a WH&#8209;347, ready to sign.
          </h1>

          <label class="dropzone">
            <input type="file" accept=".csv,.xlsx,.txt" onChange={(e) => onFile(e.currentTarget.files?.[0])} />
            <span class="dz-main">Choose your payroll file</span>
            <span class="dz-sub">or drag it here. CSV or Excel, from Gusto, ADP, Paychex, QuickBooks or your own spreadsheet.</span>
          </label>
          {fileError && <p class="error-text">{fileError}</p>}
          <p class="sample-line">
            No file handy?{" "}
            <button type="button" class="link" onClick={loadSample}>
              Open a sample payroll
            </button>{" "}
            for an electrical subcontractor with three workers.
          </p>

          <dl class="facts">
            <div>
              <dt>Free, no account</dt>
              <dd>Upload, check and download. Nothing to sign up for.</dd>
            </div>
            <div>
              <dt>Current form</dt>
              <dd>WH-347 as revised in 2025 (OMB 1235-0008, valid to January 2028). The previous version expired September 30, 2026.</dd>
            </div>
            <div>
              <dt>Your file stays on your computer</dt>
              <dd>It is read in this browser tab and never uploaded. Once this page has loaded it works with the internet switched off.</dd>
            </div>
          </dl>

          <figure class="proof">
            <img
              src={`${import.meta.env.BASE_URL}sample-report.png`}
              width={1720}
              height={470}
              alt="Page 1 of a certified payroll produced from the sample file"
            />
            <figcaption>
              What you download: page 1 from the sample file, overtime already split out. Page 2 is the Department of Labor's own signing
              page.
            </figcaption>
          </figure>
        </main>
      ) : (
        <main class="bench">
          <div class="filebar">
            <span>
              <strong>{fileName}</strong> <span class="muted">{sheet.rows.length} rows</span>
            </span>
            <label class="link">
              <input type="file" accept=".csv,.xlsx,.txt" onChange={(e) => onFile(e.currentTarget.files?.[0])} />
              Use a different file
            </label>
          </div>

          {fileError && <p class="error-text">{fileError}</p>}

          {missing.length > 0 && (
            <section class="columns-needed">
              <h2>Which columns hold this information?</h2>
              <p>We couldn't find: {missing.map((f) => FIELD_LABELS[f]).join(", ")}. Pick them below. We'll remember for next week.</p>
              <MappingTable headers={sheet.headers} mapping={mapping} onChange={onMapping} />
            </section>
          )}

          <div class="layout">
            <aside class="side">
              <h2>Report header</h2>
              <p class="side-note">Printed at the top of each page. Saved in this browser for next week.</p>
              <HeaderForm header={header} onChange={setHeader} />

              <details class="extra" open={ratesText.trim() !== ""}>
                <summary>Check pay against the wage determination</summary>
                <p>Paste the rates from your wage determination on SAM.gov. Each worker's base rate and fringe are checked against it.</p>
                <textarea
                  rows={6}
                  spellcheck={false}
                  value={ratesText}
                  placeholder={"ELECTRICIAN......................$ 48.10   21.30\nLABORER, GROUP 2.................$ 31.85   15.50"}
                  onInput={(e) => setRatesText(e.currentTarget.value)}
                />
                {ratesText.trim() !== "" && (
                  <p class="small muted">
                    Read {rates.length} {rates.length === 1 ? "classification" : "classifications"}:{" "}
                    {rates.map((r) => r.classification).join("; ")}
                  </p>
                )}
              </details>

              {missing.length === 0 && (
                <details class="extra">
                  <summary>Column matching</summary>
                  <MappingTable headers={sheet.headers} mapping={mapping} onChange={onMapping} />
                </details>
              )}
            </aside>

            <section class="sheet-area">
              {!result && <p class="muted">The payroll appears here once the week ending date is set.</p>}
              {result && totals && (
                <>
                  <p class="summary">
                    <span>
                      <b>{totals.workers}</b> {totals.workers === 1 ? "worker" : "workers"}
                    </span>
                    <span>
                      <b>{formatHours(totals.hours)}</b> hours
                      {totals.overtime > 0 && (
                        <>
                          , <b class="ot">{formatHours(totals.overtime)}</b> overtime
                        </>
                      )}
                    </span>
                    <span>
                      <b>${formatMoney(totals.gross)}</b> gross on this project
                    </span>
                    <span>
                      <b>${formatMoney(totals.net)}</b> net pay
                    </span>
                  </p>
                  <IssueList issues={result.issues} />
                  {result.payroll.rows.length > 0 && <PayrollPreview payroll={result.payroll} />}
                </>
              )}
              {officialFormSource !== "bundled" && (
                <p class="small muted soc-note">
                  The signing page has to be the Department of Labor's own.{" "}
                  {officialFormSource === "uploaded" ? (
                    "Official WH-347 added."
                  ) : (
                    <>
                      Download WH-347 from <a href={OFFICIAL_FORM_URL}>dol.gov</a> and{" "}
                      <label class="link">
                        <input type="file" accept="application/pdf" onChange={(e) => onOfficialForm(e.currentTarget.files?.[0])} />
                        add it here
                      </label>
                      .
                    </>
                  )}
                </p>
              )}
            </section>
          </div>
        </main>
      )}

      {sheet && (
        <div class="dock">
          <div class="dock-inner">
            <p class={`dock-status${ready ? " ready" : ""}`}>{status}</p>
            <button
              type="button"
              class="link"
              disabled={!ready}
              onClick={() => result && download(renderPayrollCsv(result.payroll), `${baseName}.csv`, "text/csv")}
            >
              CSV
            </button>
            <button type="button" class="primary" disabled={!ready || busy} onClick={onDownloadPdf}>
              {busy ? "Preparing PDF" : "Download PDF"}
            </button>
          </div>
        </div>
      )}

      <section id="how" class="notes">
        <h2>How it works</h2>
        <dl>
          <dt>Your file stays here</dt>
          <dd>
            The payroll file is read in this browser tab and never uploaded. Only the last four digits of each Social Security number are
            printed. The report header and your column matching are remembered in this browser, so next week's payroll takes a minute.
          </dd>
          <dt>Overtime</dt>
          <dd>
            Hours past 40 in the workweek become overtime at one and a half times the basic rate, counted in date order. If your export
            already splits out overtime, that split is used, and you're told if it leaves more than 40 straight-time hours.
          </dd>
          <dt>Two trades in one week</dt>
          <dd>
            The worker gets one row per classification under the same entry number. Weekly totals, deductions and net pay appear once.
          </dd>
          <dt>Fringe benefits</dt>
          <dd>
            Plan contributions go in column 6B. Fringe paid in cash goes in 6C and counts toward gross pay. Fringe on overtime hours is paid
            at the straight-time amount.
          </dd>
          <dt>Weekly deductions</dt>
          <dd>
            Most exports repeat the week's deductions on every daily row. Repeats are counted once. Values that differ between rows are
            added up, and you're asked to check them.
          </dd>
          <dt>The signing page</dt>
          <dd>
            The Statement of Compliance must use the Department of Labor's exact wording, so page 2 of your PDF is the official WH-347 page,
            not a copy.
          </dd>
          <dt>The rules it follows</dt>
          <dd>
            Weekly certified payrolls under the Davis-Bacon and Related Acts, 29 CFR 5.5(a)(3), and overtime under the Contract Work Hours
            and Safety Standards Act. Reports are due to the prime contractor or agency within seven days of the end of each pay week.
          </dd>
          <dt>What it doesn't do</dt>
          <dd>
            It doesn't file anything for you or replace the certifying official's review. California DIR (eCPR) and LCPtracker uploads are
            next.
          </dd>
        </dl>
      </section>

      {dragging && (
        <div class="drop-overlay" aria-hidden="true">
          <p>{sheet ? `Drop to replace ${fileName}` : "Drop your payroll file to load it"}</p>
        </div>
      )}

      <footer class="foot">
        <div class="foot-links">
          <a href={`${import.meta.env.BASE_URL}privacy.html`}>Privacy</a>
          <a href={`${import.meta.env.BASE_URL}terms.html`}>Terms</a>
          <a href="mailto:support@easywh347.com">support@easywh347.com</a>
          <a href="https://github.com/PrinceZugzwang/wh347">Source code</a>
        </div>
        <p>
          EasyWH347 is an independent tool and is not affiliated with the U.S. Department of Labor. It prepares a report for you to review;
          the contractor signing the payroll is responsible for its accuracy. Last updated October 2026.
        </p>
      </footer>
    </>
  );
}
