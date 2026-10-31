import { useEffect, useMemo, useState } from "preact/hooks";
import {
  buildPayroll,
  type Cell,
  type ColumnMapping,
  FIELD_LABELS,
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
      <header class="masthead">
        <a class="wordmark" href={import.meta.env.BASE_URL}>
          wh347
        </a>
        <nav>
          <a href="#how">How it works</a>
          <a href="#privacy">Privacy</a>
          <a href="https://github.com/PrinceZugzwang/wh347">Source</a>
        </nav>
      </header>

      <main>
        <section class="intro">
          <h1>Turn your payroll export into a certified payroll report.</h1>
          <p>
            Upload the timecard file from QuickBooks, Sage, ADP or a spreadsheet. You get a Davis-Bacon payroll laid out like Form WH-347,
            checked for the mistakes that get reports sent back. Your file stays in this browser.
          </p>
        </section>

        <section class="step">
          <h2>
            <span class="n">1</span> Project
          </h2>
          <HeaderForm header={header} onChange={setHeader} />
        </section>

        <section class="step">
          <h2>
            <span class="n">2</span> Timecards
          </h2>
          <p class="lede">One row per worker per day. CSV or .xlsx. The column names don't need to match anything in particular.</p>
          <label class="drop">
            <input type="file" accept=".csv,.xlsx,.txt" onChange={(e) => onFile(e.currentTarget.files?.[0])} />
            <span>{fileName ? `${fileName}, ${sheet?.rows.length ?? 0} rows. Choose another file` : "Choose a file"}</span>
          </label>
          <p class="small">
            No export handy? <a href={`${import.meta.env.BASE_URL}sample-timecards.csv`}>Try the sample file</a>.
          </p>
          {fileError && <p class="error-text">{fileError}</p>}
          {sheet && (
            <details open={missing.length > 0} class="mapping-details">
              <summary>
                Column matching{" "}
                {missing.length > 0 ? (
                  <span class="error-text">still needed: {missing.map((f) => FIELD_LABELS[f]).join(", ")}</span>
                ) : (
                  <span class="muted">matched automatically, open to adjust</span>
                )}
              </summary>
              <MappingTable headers={sheet.headers} mapping={mapping} onChange={onMapping} />
            </details>
          )}
        </section>

        <section class="step">
          <h2>
            <span class="n">3</span> Wage rates <span class="optional">optional</span>
          </h2>
          <p class="lede">
            Paste the classification lines from your wage determination on SAM.gov and every worker is checked against the base rate and
            fringe.
          </p>
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
        </section>

        <section class="step">
          <h2>
            <span class="n">4</span> Check
          </h2>
          {!result && <p class="muted">Fill in the week ending date and load a timecard file to see the payroll.</p>}
          {result && (
            <>
              <IssueList issues={result.issues} />
              {result.payroll.rows.length > 0 && <PayrollPreview payroll={result.payroll} />}
            </>
          )}
        </section>

        <section class="step">
          <h2>
            <span class="n">5</span> Download
          </h2>
          <div class="soc">
            <p>
              The Statement of Compliance has to use the Department of Labor's exact wording, so it isn't retyped here.{" "}
              {officialFormSource ? (
                <strong>Page 2 of the official WH-347 will be added to your PDF for signing.</strong>
              ) : (
                <>
                  Download the official form from <a href={OFFICIAL_FORM_URL}>dol.gov</a> and add it below, and its page 2 is attached to
                  your PDF for signing.
                </>
              )}
            </p>
            {officialFormSource !== "bundled" && (
              <label class="inline-file">
                <input type="file" accept="application/pdf" onChange={(e) => onOfficialForm(e.currentTarget.files?.[0])} />
                <span>{officialFormSource === "uploaded" ? "Official WH-347 added" : "Add the official WH-347 PDF"}</span>
              </label>
            )}
          </div>
          <div class="actions">
            <button type="button" disabled={!ready || busy} onClick={onDownloadPdf}>
              {busy ? "Building PDF" : "Download PDF"}
            </button>
            <button
              type="button"
              class="secondary"
              disabled={!ready}
              onClick={() => result && download(renderPayrollCsv(result.payroll), `${baseName}.csv`, "text/csv")}
            >
              Download CSV
            </button>
            {result && errors > 0 && <span class="error-text">Fix the problems in step 4 first.</span>}
          </div>
        </section>

        <section id="how" class="notes">
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
        </section>

        <section id="privacy" class="notes">
          <h2>Privacy</h2>
          <p>
            Your payroll file is read and processed in this browser tab. Nothing is sent to a server. The project details and your column
            matching are kept in this browser so next week's payroll takes a minute.
          </p>
        </section>
      </main>

      <footer>
        <p>
          Not affiliated with the U.S. Department of Labor. This tool prepares a report for you to review; the contractor remains
          responsible for its accuracy.
        </p>
      </footer>
    </>
  );
}
