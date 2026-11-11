import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  buildPayroll,
  type Cell,
  type ColumnMapping,
  type CrewEntry,
  FIELD_LABELS,
  addDays,
  clearHours,
  crewToLines,
  emptyEntry,
  lastFour,
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
  workweek,
} from "../core";
import { renderPayrollCsv } from "../core/render/csv";
import { adConversion, noteDownload, track } from "./analytics";
import { CrewForm } from "./CrewForm";
import { download } from "./download";
import { HeaderForm } from "./HeaderForm";
import { IssueList } from "./IssueList";
import { MappingTable } from "./MappingTable";
import { PayrollPreview } from "./PayrollPreview";
import { Mark } from "./Mark";
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

/** The Saturday that ends the most recent full or current workweek, in the user's own time zone. */
function lastSaturday(): string {
  const now = new Date();
  const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return addDays(local, -((now.getDay() + 1) % 7));
}

function hasTyping(crew: CrewEntry[]): boolean {
  return crew.some((e) => e.name.trim() !== "" || e.hours.some((h) => h.trim() !== ""));
}

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
  const [isSample, setIsSample] = useState(false);
  const [typing, setTyping] = useState(false);
  const [crew, setCrew] = useState<CrewEntry[]>(() => {
    const saved = load<{ entries: CrewEntry[] }>("crew", { entries: [] }).entries;
    return saved.length > 0 ? saved : [emptyEntry()];
  });

  useEffect(() => save("header", header), [header]);
  // Only the last four digits of an ID are ever written to storage.
  useEffect(() => save("crew", { entries: crew.map((e) => ({ ...e, workerId: lastFour(e.workerId) })) }), [crew]);
  useEffect(() => save("rates", { text: ratesText }), [ratesText]);
  useEffect(() => {
    fetchBundledForm().then((bytes) => {
      if (bytes) {
        setOfficialForm(bytes);
        setOfficialFormSource("bundled");
      }
    });
  }, []);

  async function onFile(file: File | undefined, isSample = false) {
    if (!file) return;
    setFileError("");
    try {
      const grid: Cell[][] = await readGrid(file);
      const next = toSheet(grid);
      const saved = load<{ headers: string[]; mapping: ColumnMapping }>("mapping", { headers: [], mapping: {} });
      const sameLayout = saved.headers.join("\u0000") === next.headers.join("\u0000");
      setSheet(next);
      setFileName(file.name);
      const nextMapping = sameLayout ? saved.mapping : proposeMapping(next.headers);
      setMapping(nextMapping);
      setIsSample(isSample);
      track("File loaded", {
        sample: isSample,
        from_form: typing,
        type: file.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv",
        rows: next.rows.length,
        columns_matched: missingRequired(nextMapping).length === 0,
      });
    } catch (err) {
      track("File rejected");
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
    await onFile(new File([csv], "sample-timecards.csv", { type: "text/csv" }), true);
    window.scrollTo({ top: 0 });
  }

  function startTyping() {
    const returning = hasTyping(crew);
    setSheet(null);
    setFileError("");
    setIsSample(false);
    setTyping(true);
    if (!header.weekEnding) setHeader((h) => ({ ...h, weekEnding: lastSaturday() }));
    track("Form started", { returning });
    window.scrollTo({ top: 0 });
  }

  /** Same crew and rates, hours cleared, the following week and the next payroll number. */
  function startNextWeek() {
    setCrew(clearHours(crew));
    setHeader((h) => ({
      ...h,
      weekEnding: h.weekEnding ? addDays(h.weekEnding, 7) : lastSaturday(),
      payrollNumber: /^\d+$/.test(h.payrollNumber.trim()) ? String(Number(h.payrollNumber) + 1) : h.payrollNumber,
      isFinal: false,
    }));
    track("Next week started", { workers: crew.filter((e) => e.name.trim()).length });
    window.scrollTo({ top: 0 });
  }

  function clearForm() {
    if (!window.confirm("Clear every worker from the form? The report header is kept.")) return;
    setCrew([emptyEntry()]);
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

  const weekDates = useMemo(() => (header.weekEnding ? workweek(header.weekEnding) : []), [header.weekEnding]);
  const source = sheet ? "file" : typing ? "typed" : null;

  const result = useMemo(() => {
    if (!header.weekEnding) return null;
    if (source === "typed") {
      const typed = crewToLines(crew, weekDates);
      const built = buildPayroll(header, typed.lines);
      const issues: Issue[] = [...validateHeader(header), ...typed.issues, ...built.issues, ...validatePayroll(built.payroll, rates)];
      return { payroll: built.payroll, issues };
    }
    if (!sheet || missing.length > 0) return null;
    const read = readTimecards(sheet, mapping);
    const built = buildPayroll(header, read.lines);
    const issues: Issue[] = [...validateHeader(header), ...read.issues, ...built.issues, ...validatePayroll(built.payroll, rates)];
    return { payroll: built.payroll, issues };
  }, [source, crew, weekDates, sheet, mapping, header, rates, missing]);

  const errors = result?.issues.filter((i) => i.level === "error").length ?? 0;

  // How far people get in the typed form, counted once per step per visit,
  // so drop-off shows up as the gap between steps.
  const reached = useRef(new Set<string>());
  useEffect(() => {
    if (source !== "typed" || !result) return;
    const rows = result.payroll.rows.length;
    const steps: [string, boolean][] = [
      ["header filled", validateHeader(header).every((i) => i.level !== "error")],
      ["first worker", rows > 0],
      ["ready to download", rows > 0 && errors === 0],
    ];
    for (const [step, done] of steps) {
      if (done && !reached.current.has(step)) {
        reached.current.add(step);
        track("Form progress", { step });
      }
    }
  }, [source, result, header, errors]);
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
      track("PDF downloaded", { sample: isSample, source: source ?? "file", workers: totals?.workers ?? 0 });
      if (!isSample) {
        adConversion();
        noteDownload();
      }
    } finally {
      setBusy(false);
    }
  }

  const status = !source
    ? ""
    : source === "file" && missing.length > 0
      ? `Match ${missing.length === 1 ? "the last required column" : `${missing.length} required columns`} to continue.`
      : !result
        ? "Add the week ending date."
        : result.payroll.rows.length === 0 && !result.issues.some((i) => i.code === "entry-incomplete")
          ? hasTyping(crew) && source === "typed"
            ? "Enter this week's hours."
            : "Enter a worker and their hours to start."
          : errors > 0
            ? `${errors} ${errors === 1 ? "problem" : "problems"} to fix before you can download.`
            : `Ready to sign. Week ending ${shortDate(header.weekEnding)}, ${totals?.workers ?? 0} ${totals?.workers === 1 ? "worker" : "workers"}.`;

  return (
    <>
      <header class="top">
        <div class="top-inner">
          <a class="brand" href={import.meta.env.BASE_URL}>
            <Mark />
            <span>
              EasyWH347
              <small>Certified payroll for Davis-Bacon work</small>
            </span>
          </a>
          <nav>
            <a href="#how">How it works</a>
            <a href="#pricing">Pricing</a>
            <a href="#questions">Questions</a>
            <a href="mailto:support@easywh347.com">Contact</a>
          </nav>
        </div>
      </header>

      {!source ? (
        <main class="start" id="top">
          <h1>
            Fill in your WH&#8209;347 online. <br />
            Download it ready to sign.
          </h1>
          <p class="lede">
            The current January 2025 form. Overtime, fringe, gross and net pay are worked out as you type and checked against your wage
            rates. Free, with no account to create.
          </p>

          <div class="start-actions">
            <button type="button" class="primary big" onClick={startTyping}>
              {hasTyping(crew) ? "Continue your payroll" : "Fill in the form"}
            </button>
            <p class="import-line">
              or{" "}
              <label class="link">
                <input type="file" accept=".csv,.xlsx,.txt" onChange={(e) => onFile(e.currentTarget.files?.[0])} />
                import a payroll export
              </label>{" "}
              from Gusto, ADP, Paychex, QuickBooks or a spreadsheet
            </p>
          </div>
          {fileError && <p class="error-text">{fileError}</p>}

          <p class="blank-form">
            Just need the blank PDF?{" "}
            <a href={`${import.meta.env.BASE_URL}forms/wh347.pdf`} download="WH-347.pdf" onClick={() => track("Blank form downloaded")}>
              Download the official DOL form
            </a>
            . Want to see a finished one first?{" "}
            <button type="button" class="link" onClick={loadSample}>
              Open a sample payroll
            </button>
            .
          </p>

          <dl class="facts">
            <div>
              <dt>The arithmetic is done</dt>
              <dd>Hours past 40 become overtime at time and a half. Fringe, gross and net pay add up as you type.</dd>
            </div>
            <div>
              <dt>Current form</dt>
              <dd>Matches the WH-347 revised in January 2025 (OMB 1235-0008, valid through January 2028), with DOL's own signing page.</dd>
            </div>
            <div>
              <dt>Next week starts filled in</dt>
              <dd>Your crew, rates and project are kept in this browser, never uploaded. Next week you only enter the hours.</dd>
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
      ) : source === "typed" ? (
        <main class="bench">
          <div class="filebar">
            <span>
              <strong>Filling in the form</strong> <span class="muted">Saved in this browser as you type</span>
            </span>
            <label class="link">
              <input type="file" accept=".csv,.xlsx,.txt" onChange={(e) => onFile(e.currentTarget.files?.[0])} />
              Import a payroll file instead
            </label>
            <button type="button" class="link" onClick={startNextWeek}>
              Start next week's payroll
            </button>
            <button type="button" class="link quiet" onClick={clearForm}>
              Clear the form
            </button>
          </div>
          {fileError && <p class="error-text">{fileError}</p>}

          <div class="layout">
            <aside class="side">
              <h2>Report header</h2>
              <p class="side-note">Printed at the top of each page.</p>
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
            </aside>

            <section class="sheet-area">
              <h2 class="area-title">Workers this week</h2>
              {weekDates.length === 0 ? (
                <p class="muted">Set the week ending date in the report header to enter hours.</p>
              ) : (
                <CrewForm crew={crew} header={header} weekDates={weekDates} onChange={setCrew} />
              )}
              {result && totals && hasTyping(crew) && (
                <div class="typed-result">
                  <h2 class="area-title">On the form</h2>
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
                </div>
              )}
            </section>
          </div>
        </main>
      ) : sheet ? (
        <main class="bench">
          <div class="filebar">
            <span>
              <strong>{fileName}</strong> <span class="muted">{sheet.rows.length} rows</span>
            </span>
            <label class="link">
              <input type="file" accept=".csv,.xlsx,.txt" onChange={(e) => onFile(e.currentTarget.files?.[0])} />
              Use a different file
            </label>
            <button type="button" class="link" onClick={startTyping}>
              Fill in the form by hand instead
            </button>
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
      ) : null}

      {source && (
        <div class="dock">
          <div class="dock-inner">
            <p class={`dock-status${ready ? " ready" : ""}`}>{status}</p>
            <button
              type="button"
              class="link"
              disabled={!ready}
              onClick={() => {
                if (!result) return;
                download(renderPayrollCsv(result.payroll), `${baseName}.csv`, "text/csv");
                track("CSV downloaded", { sample: isSample, source: source ?? "file" });
              }}
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
          <dt>Nothing is uploaded</dt>
          <dd>
            What you type, and any payroll file you import, stays in this browser tab. Only the last four digits of each Social Security
            number are kept or printed. Your crew, report header and column matching are remembered in this browser, so next week you only
            enter the hours. Clear the form to remove them.
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

      <section id="pricing" class="band">
        <div class="band-inner">
          <h2>Pricing</h2>
          <p class="band-lede">The report itself is free. Pay only if you want the weekly filing taken off your hands.</p>
          <div class="plans">
            <div class="plan">
              <h3>Free</h3>
              <p class="price">$0</p>
              <ul>
                <li>Fill in the form or import a payroll file, as often as you like</li>
                <li>PDF with DOL's signing page, plus CSV</li>
                <li>Overtime, wage rate and SSN checks</li>
                <li>Your crew remembered in this browser for next week</li>
              </ul>
              <button type="button" class="plan-action link" onClick={startTyping}>
                Fill in the form
              </button>
            </div>
            <div class="plan">
              <h3>Pro</h3>
              <p class="price">
                $39 <span>per month, per company</span>
              </p>
              <p class="plan-pitch">Your 3 years of payroll records, ready if the agency asks.</p>
              <ul>
                <li>
                  Every week you file, saved by project, for the 3 years after the work ends that Davis-Bacon rules require you to keep them
                </li>
                <li>Pull any week back up for an agency, a prime or an auditor in a minute</li>
                <li>Upload files for LCPtracker and state portals, including California DIR</li>
                <li>Email support from a person</li>
              </ul>
              <a
                class="plan-action"
                href="mailto:support@easywh347.com?subject=EasyWH347%20Pro%20early%20access"
                onClick={() => track("Pro interest")}
              >
                Join the early list
              </a>
              <p class="plan-note">In development. Join the list and we'll email you when it opens.</p>
            </div>
            <div class="plan">
              <h3>Done for you</h3>
              <p class="price">
                $199 <span>per month, per project</span>
              </p>
              <ul>
                <li>Send us your payroll export each week</li>
                <li>We prepare the certified payroll and enter it into the agency's portal</li>
                <li>You review and sign</li>
              </ul>
              <a
                class="plan-action"
                href="mailto:support@easywh347.com?subject=Done-for-you%20certified%20payroll"
                onClick={() => track("Done for you interest")}
              >
                Talk to us
              </a>
            </div>
          </div>
        </div>
      </section>

      <section id="questions" class="notes">
        <h2>Questions</h2>
        <dl>
          <dt>How is this different from DOL's fillable WH-347?</dt>
          <dd>
            Both are free and both follow the same form. Here, hours past 40 are moved to overtime and fringe, gross and net pay are added
            up as you type; pay can be checked against your wage determination; your crew is still filled in next week; and if you run
            payroll in Gusto, ADP, QuickBooks or a spreadsheet, you can import the export instead of typing.
          </dd>
          <dt>Which payroll systems work?</dt>
          <dd>
            Any that can export a CSV or Excel file with one row per worker per day: Gusto, ADP, Paychex, QuickBooks, Sage, or a timesheet
            you keep yourself. Columns are matched automatically and you can adjust them once.
          </dd>
          <dt>How long do I have to keep certified payrolls?</dt>
          <dd>
            Three years after all the work on the prime contract is finished, together with the time records, pay records and workers'
            contact details behind them. The contracting agency or the Department of Labor can ask for them at any point in that period,
            with or without an investigation. The free version keeps only the current week in your browser, so keep each PDF and CSV you
            download; Pro will keep every week for you.
          </dd>
          <dt>Is the older WH-347 still accepted?</dt>
          <dd>
            WH-347 is an optional DOL form; what's required is the weekly payroll information and a signed Statement of Compliance. Some
            agencies and primes now ask for the January 2025 layout, which is what this produces. If in doubt, ask whoever receives your
            payrolls.
          </dd>
          <dt>Do you file it for me?</dt>
          <dd>
            Not on the free plan: you download the PDF, sign it and send it as usual. The Done for you plan covers the weekly filing,
            including LCPtracker and agency portals.
          </dd>
          <dt>Who sees my workers' information?</dt>
          <dd>
            No one. The file is processed in your browser and isn't uploaded. See the{" "}
            <a href={`${import.meta.env.BASE_URL}privacy.html`}>privacy page</a> for exactly what is and isn't stored.
          </dd>
        </dl>
      </section>

      {dragging && (
        <div class="drop-overlay" aria-hidden="true">
          <p>{sheet ? `Drop to replace ${fileName}` : "Drop your payroll export to import it"}</p>
        </div>
      )}

      <footer class="foot">
        <div class="foot-links">
          <a href={`${import.meta.env.BASE_URL}privacy.html`}>Privacy</a>
          <a href={`${import.meta.env.BASE_URL}terms.html`}>Terms</a>
          <a href="mailto:support@easywh347.com">support@easywh347.com</a>
        </div>
        <p>
          EasyWH347 is an independent tool and is not affiliated with the U.S. Department of Labor. It prepares a report for you to review;
          the contractor signing the payroll is responsible for its accuracy. Last updated October 2026.
        </p>
      </footer>
    </>
  );
}
