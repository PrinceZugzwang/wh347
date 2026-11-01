import { useEffect, useMemo, useState } from "preact/hooks";
import {
  buildPayroll,
  type Cell,
  type ColumnMapping,
  FIELD_LABELS,
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
  validatePayroll,
} from "../core";
import { renderPayrollCsv } from "../core/render/csv";
import { download } from "./download";
import { HeaderForm } from "./HeaderForm";
import { IssueList } from "./IssueList";
import { MappingTable } from "./MappingTable";
import { PayrollPreview } from "./PayrollPreview";
import { readGrid } from "./read-file";
import { Mark } from "./Mark";
import { Specimen } from "./Specimen";
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
    document.getElementById("review")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function onOfficialForm(file: File | undefined) {
    if (!file) return;
    setOfficialForm(new Uint8Array(await file.arrayBuffer()));
    setOfficialFormSource("uploaded");
  }

  function onMapping(next: ColumnMapping) {
    setMapping(next);
    if (sheet) save("mapping", { headers: sheet.headers, mapping: next });
  }

  const missing = useMemo(() => missingRequired(mapping), [mapping]);
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
  const projectDone = Boolean(header.contractorName && header.projectName && header.projectNumber && header.weekEnding);
  const steps = [
    { id: "project", label: "Project details", done: projectDone },
    { id: "timecards", label: "Timecards", done: sheet !== null && missing.length === 0 },
    { id: "rates", label: "Wage rates", done: rates.length > 0, optional: true },
    { id: "review", label: "Review", done: result !== null && errors === 0 },
    { id: "download", label: "Download", done: false },
  ];
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

  return (
    <>
      <header class="topbar">
        <div class="wrap topbar-inner">
          <a class="brand" href={import.meta.env.BASE_URL}>
            <Mark />
            EasyWH347
          </a>
          <nav>
            <a href="#how">How it works</a>
            <a href="#privacy">Privacy</a>
            <a class="nav-cta" href="#start">
              Start a payroll
            </a>
          </nav>
        </div>
      </header>

      <section class="hero">
        <div class="wrap hero-inner">
          <div class="hero-text">
            <h1>Certified payroll from the export you already have.</h1>
            <p class="hero-sub">
              Upload last week's timecards from Gusto, ADP, Paychex, QuickBooks or a spreadsheet. Get a Davis-Bacon payroll in the WH-347
              layout, with overtime split out and every rate checked, ready to sign.
            </p>
            <div class="hero-actions">
              <a class="button" href="#start">
                Start a payroll
              </a>
              <button type="button" class="button secondary" onClick={loadSample}>
                Try it with sample data
              </button>
            </div>
            <dl class="assurances">
              <div>
                <dt>Official form</dt>
                <dd>DOL WH-347, OMB 1235-0008</dd>
              </div>
              <div>
                <dt>Private</dt>
                <dd>Processed in your browser</dd>
              </div>
              <div>
                <dt>Checked</dt>
                <dd>Overtime, rates, SSNs</dd>
              </div>
            </dl>
          </div>
          <Specimen />
        </div>
      </section>

      <main id="start" class="wrap workspace">
        <nav class="stepper" aria-label="Steps">
          <ol>
            {steps.map((step, i) => (
              <li key={step.id} class={step.done ? "done" : ""}>
                <a href={`#${step.id}`}>
                  <span class="dot">{step.done ? "\u2713" : i + 1}</span>
                  <span>
                    {step.label}
                    {step.optional && <em> optional</em>}
                  </span>
                </a>
              </li>
            ))}
          </ol>
          <p>Project details and column matching are saved in this browser, so next week starts where you left off.</p>
        </nav>

        <div class="panels">
          <section class="panel" id="project">
            <header class="panel-head">
              <h2>Project details</h2>
              <p>Printed at the top of every page of the payroll.</p>
            </header>
            <div class="panel-body">
              <HeaderForm header={header} onChange={setHeader} />
            </div>
          </section>

          <section class="panel" id="timecards">
            <header class="panel-head">
              <h2>Timecards</h2>
              <p>
                The payroll or time export for this week, one row per worker per day, as CSV or .xlsx. Column names don't need to match
                anything.
              </p>
            </header>
            <div class="panel-body">
              <label class={`drop${sheet ? " loaded" : ""}`}>
                <input type="file" accept=".csv,.xlsx,.txt" onChange={(e) => onFile(e.currentTarget.files?.[0])} />
                {sheet ? (
                  <span>
                    <strong>{fileName}</strong>
                    <small>{sheet.rows.length} rows read. Choose a different file</small>
                  </span>
                ) : (
                  <span>
                    <strong>Choose a file</strong>
                    <small>or drop it here</small>
                  </span>
                )}
              </label>
              {fileError && <p class="error-text">{fileError}</p>}
              {sheet && (
                <details open={missing.length > 0} class="mapping-details">
                  <summary>
                    Column matching:{" "}
                    {missing.length > 0 ? (
                      <span class="error-text">still needed: {missing.map((f) => FIELD_LABELS[f]).join(", ")}</span>
                    ) : (
                      <span class="muted">all required columns found</span>
                    )}
                  </summary>
                  <MappingTable headers={sheet.headers} mapping={mapping} onChange={onMapping} />
                </details>
              )}
            </div>
          </section>

          <section class="panel" id="rates">
            <header class="panel-head">
              <h2>
                Wage rates <span class="tag">Optional</span>
              </h2>
              <p>Paste the classification lines from your wage determination on SAM.gov to check every worker's base rate and fringe.</p>
            </header>
            <div class="panel-body">
              <textarea
                rows={5}
                spellcheck={false}
                value={ratesText}
                placeholder={"ELECTRICIAN......................$ 48.10   21.30\nLABORER, GROUP 2.................$ 31.85   15.50"}
                onInput={(e) => setRatesText(e.currentTarget.value)}
              />
              {ratesText.trim() !== "" && (
                <p class="small muted">
                  {rates.length} {rates.length === 1 ? "classification" : "classifications"} read:{" "}
                  {rates.map((r) => r.classification).join("; ")}
                </p>
              )}
            </div>
          </section>

          <section class="panel" id="review">
            <header class="panel-head">
              <h2>Review</h2>
              <p>Every line as it will print, with anything that would get the payroll sent back.</p>
            </header>
            <div class="panel-body">
              {!result && <p class="muted">Add the week ending date and a timecard file to see the payroll.</p>}
              {result && totals && (
                <>
                  <dl class="totals">
                    <div>
                      <dt>Workers</dt>
                      <dd>{totals.workers}</dd>
                    </div>
                    <div>
                      <dt>Hours</dt>
                      <dd>{formatHours(totals.hours)}</dd>
                    </div>
                    <div>
                      <dt>Overtime hours</dt>
                      <dd class={totals.overtime > 0 ? "ot" : ""}>{formatHours(totals.overtime)}</dd>
                    </div>
                    <div>
                      <dt>Gross, this project</dt>
                      <dd>${formatMoney(totals.gross)}</dd>
                    </div>
                    <div>
                      <dt>Net pay</dt>
                      <dd>${formatMoney(totals.net)}</dd>
                    </div>
                  </dl>
                  <IssueList issues={result.issues} />
                  {result.payroll.rows.length > 0 && <PayrollPreview payroll={result.payroll} />}
                </>
              )}
            </div>
          </section>

          <section class="panel" id="download">
            <header class="panel-head">
              <h2>Download</h2>
              <p>
                The Statement of Compliance must use the Department of Labor's exact wording, so the official page 2 of WH-347 is attached
                for signing rather than retyped.
              </p>
            </header>
            <div class="panel-body">
              {officialFormSource !== "bundled" && (
                <p class="soc-note">
                  {officialFormSource === "uploaded" ? (
                    "Official WH-347 added."
                  ) : (
                    <>
                      Download the form from <a href={OFFICIAL_FORM_URL}>dol.gov</a> and add it here:{" "}
                    </>
                  )}
                  <label class="inline-file">
                    <input type="file" accept="application/pdf" onChange={(e) => onOfficialForm(e.currentTarget.files?.[0])} />
                    <span>Add WH-347 PDF</span>
                  </label>
                </p>
              )}
              <div class="actions">
                <button type="button" class="button" disabled={!ready || busy} onClick={onDownloadPdf}>
                  {busy ? "Preparing PDF" : "Download PDF"}
                </button>
                <button
                  type="button"
                  class="button secondary"
                  disabled={!ready}
                  onClick={() => result && download(renderPayrollCsv(result.payroll), `${baseName}.csv`, "text/csv")}
                >
                  Download CSV
                </button>
                {result && errors > 0 && <span class="error-text">Fix the problems under Review first.</span>}
              </div>
            </div>
          </section>
        </div>
      </main>

      <section id="how" class="info">
        <div class="wrap info-inner">
          <h2>How the numbers are worked out</h2>
          <dl>
            <dt>Overtime</dt>
            <dd>
              Hours past 40 in the workweek become overtime at one and a half times the basic rate, counted in date order. If your export
              already splits out overtime hours, that split is used instead, and you're told if it leaves more than 40 straight-time hours.
            </dd>
            <dt>Two classifications in one week</dt>
            <dd>
              The worker gets one row per classification under the same entry number. Weekly totals, deductions and net pay appear once.
            </dd>
            <dt>Fringe benefits</dt>
            <dd>
              Credits paid into plans go in column 6B. Fringe paid to the worker in cash goes in 6C and counts toward gross pay. Fringe is
              paid on overtime hours at the straight-time amount.
            </dd>
            <dt>Weekly deductions</dt>
            <dd>
              Most exports repeat the week's deductions on every daily row. Repeated values are counted once. Values that differ between
              rows are added up, and you're asked to check them.
            </dd>
            <dt>What this doesn't do</dt>
            <dd>
              It doesn't file anything for you, and it doesn't replace the certifying official's review. California DIR (eCPR) and
              LCPtracker uploads are on the way.
            </dd>
          </dl>
        </div>
      </section>

      <section id="privacy" class="info">
        <div class="wrap info-inner">
          <h2>Privacy</h2>
          <dl>
            <dt>Your payroll file</dt>
            <dd>Read and processed in this browser tab. It is never uploaded, and nothing in it is sent anywhere.</dd>
            <dt>What's remembered</dt>
            <dd>Project details and your column matching, kept in this browser only, so next week's payroll takes a minute.</dd>
            <dt>Social Security numbers</dt>
            <dd>Only the last four digits appear in the report, as the form requires.</dd>
          </dl>
        </div>
      </section>

      <footer class="footer">
        <div class="wrap footer-inner">
          <p>
            Not affiliated with the U.S. Department of Labor. EasyWH347 prepares a report for you to review; the contractor remains
            responsible for its accuracy.
          </p>
          <p>
            <a href="https://github.com/PrinceZugzwang/wh347">Open source</a>
          </p>
        </div>
      </footer>
    </>
  );
}
