import "@fontsource/public-sans/400.css";
import "@fontsource/public-sans/600.css";
import "@fontsource/public-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "../styles.css";
import "./records.css";
import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { addDays, clearHours, formatMoney, shortDate } from "../core";
import { renderPayrollCsv } from "../core/render/csv";
import * as api from "../pro/api";
import { PRO_LINK, proConfigured } from "../pro/config";
import { paymentUrl } from "../pro/model";
import { initAdTag, metaEvent, track } from "../ui/analytics";
import { download } from "../ui/download";
import { Mark } from "../ui/Mark";
import { save } from "../ui/storage";

const BASE = import.meta.env.BASE_URL;

type State =
  | { kind: "loading" }
  | { kind: "off" }
  | { kind: "signed-out" }
  | { kind: "in"; email: string; userId: string; pro: boolean; projects: api.ProjectRecord[]; weeks: api.WeekListItem[] }
  | { kind: "error"; text: string };

async function officialForm(): Promise<Uint8Array | undefined> {
  try {
    const res = await fetch(`${BASE}forms/wh347.pdf`);
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("pdf")) return undefined;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return undefined;
  }
}

function fileBase(week: { week_ending: string; payroll_number: string }, project: api.ProjectRecord | undefined) {
  const p = (project?.number || project?.name || "project").replace(/[^\w-]+/g, "-").slice(0, 40);
  return `certified-payroll-${p}-${week.payroll_number || "x"}-we-${week.week_ending}`;
}

/** Puts a saved week back into the form (which reads this browser's storage) and opens it. */
function openInForm(week: api.WeekRecord, nextWeek: boolean) {
  if (!week.crew) return;
  const header = nextWeek
    ? {
        ...week.header,
        weekEnding: addDays(week.header.weekEnding, 7),
        payrollNumber: /^\d+$/.test(week.header.payrollNumber.trim())
          ? String(Number(week.header.payrollNumber) + 1)
          : week.header.payrollNumber,
        isFinal: false,
      }
    : week.header;
  save("header", header);
  save("crew", { entries: nextWeek ? clearHours(week.crew) : week.crew });
  save("rates", { text: week.rates_text });
  track(nextWeek ? "Pro next week" : "Pro opened week");
  window.location.href = `${BASE}?continue=1`;
}

function Records() {
  const [state, setState] = useState<State>({ kind: proConfigured ? "loading" : "off" });
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState("");
  const paid = useMemo(() => new URLSearchParams(window.location.search).has("paid"), []);

  async function refresh() {
    try {
      const session = await api.currentSession();
      if (!session) {
        setState({ kind: "signed-out" });
        return;
      }
      const [profile, projects, weeks] = await Promise.all([api.getProfile(), api.listProjects(), api.listWeeks()]);
      setState({
        kind: "in",
        email: session.user.email ?? "",
        userId: session.user.id,
        pro: Boolean(profile?.pro_active),
        projects,
        weeks,
      });
      if (window.location.search.includes("code=")) window.history.replaceState(null, "", window.location.pathname);
    } catch (err) {
      setState({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    }
  }

  useEffect(() => {
    if (proConfigured) void refresh();
  }, []);

  // After paying, Stripe sends people back here; Pro switches on when the payment is confirmed, usually within seconds.
  useEffect(() => {
    if (paid && state.kind === "in" && state.pro) metaEvent("Subscribe", { value: 79, currency: "USD" });
  }, [paid, state.kind === "in" && state.pro]);

  useEffect(() => {
    if (!paid || state.kind !== "in" || state.pro) return;
    const id = window.setTimeout(() => void refresh(), 3000);
    return () => window.clearTimeout(id);
  }, [paid, state]);

  async function onSendLink(e: Event) {
    e.preventDefault();
    const address = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(address)) {
      setFormError("Enter your email address.");
      return;
    }
    setFormError("");
    setBusy("link");
    try {
      await api.sendSignInLink(address, `${window.location.origin}${BASE}records.html`);
      track("Pro sign-in link sent", { from: "records" });
      setSent(address);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  async function onPdf(ids: string[], name: string) {
    setBusy(ids.join(","));
    try {
      const [weeks, form, { renderPayrollPdf }, { PDFDocument }] = await Promise.all([
        api.getWeeks(ids),
        officialForm(),
        import("../core/render/pdf"),
        import("pdf-lib"),
      ]);
      if (weeks.length === 1) {
        download(await renderPayrollPdf(weeks[0].payroll, form), `${name}.pdf`, "application/pdf");
      } else {
        const packet = await PDFDocument.create();
        for (const week of weeks) {
          const doc = await PDFDocument.load(await renderPayrollPdf(week.payroll, form));
          const pages = await packet.copyPages(doc, doc.getPageIndices());
          pages.forEach((p) => packet.addPage(p));
        }
        download(await packet.save(), `${name}.pdf`, "application/pdf");
      }
      track("Pro PDF downloaded", { weeks: ids.length });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  async function onCsv(id: string, name: string) {
    setBusy(id);
    try {
      const [week] = await api.getWeeks([id]);
      download(renderPayrollCsv(week.payroll), `${name}.csv`, "text/csv");
      track("Pro CSV downloaded");
    } finally {
      setBusy("");
    }
  }

  async function onOpen(id: string, nextWeek: boolean) {
    setBusy(id);
    const [week] = await api.getWeeks([id]);
    openInForm(week, nextWeek);
  }

  async function onDelete(week: api.WeekListItem) {
    if (
      !window.confirm(`Delete the week ending ${shortDate(week.week_ending)}? You're required to keep certified payrolls for three years.`)
    )
      return;
    setBusy(week.id);
    try {
      await api.deleteWeek(week.id);
      await refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <header class="top">
        <div class="top-inner">
          <a class="brand" href={BASE}>
            <Mark />
            <span>
              EasyWH347
              <small>Certified payroll for Davis-Bacon work</small>
            </span>
          </a>
          <nav>
            <a href={BASE}>Fill in a payroll</a>
            <a href="mailto:support@easywh347.com">Contact</a>
            {state.kind === "in" && (
              <button
                type="button"
                class="link"
                onClick={async () => {
                  await api.signOut();
                  setState({ kind: "signed-out" });
                }}
              >
                Sign out
              </button>
            )}
          </nav>
        </div>
      </header>

      <main class="records">
        <h1>Your records</h1>

        {state.kind === "off" && <p class="lede">Pro isn't switched on for this site yet.</p>}
        {state.kind === "loading" && <p class="muted">Loading…</p>}
        {state.kind === "error" && <p class="error-text">{state.text}</p>}

        {state.kind === "signed-out" &&
          (sent ? (
            <div class="records-box">
              <h2>Check your email</h2>
              <p>
                We sent a sign-in link to <b>{sent}</b>. Open it on this computer. No password needed.
              </p>
            </div>
          ) : (
            <form class="records-box" onSubmit={onSendLink}>
              <h2>Sign in</h2>
              <p>
                Every week you've saved, by project. We'll email you a link to sign in; there's no password. New here? The same link creates
                your account.
              </p>
              <label class="pro-field">
                Email
                <input type="email" autoComplete="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} required />
              </label>
              {formError && <p class="error-text">{formError}</p>}
              <button type="submit" class="primary" disabled={busy === "link"}>
                {busy === "link" ? "Sending" : "Email me a sign-in link"}
              </button>
            </form>
          ))}

        {state.kind === "in" && (
          <>
            <p class="account-line">
              {state.email} · {state.pro ? <b>Pro</b> : "Free account"}
            </p>

            {!state.pro && (
              <div class="records-box">
                {paid ? (
                  <>
                    <h2>Confirming your payment</h2>
                    <p>
                      This usually takes a few seconds. If Pro isn't on within a minute, email support@easywh347.com and we'll switch it on.
                    </p>
                  </>
                ) : (
                  <>
                    <h2>Keep every week on file with Pro</h2>
                    <p class="pro-price">
                      $79 <span>a month per company. Cancel any time.</span>
                    </p>
                    <ul>
                      <li>Press "Save to my records" under any payroll you fill in, and it's filed under its project</li>
                      <li>Any week back as a PDF or CSV, or a whole project in one PDF for an agency, a prime or an auditor</li>
                      <li>Next week starts from the last one: same crew and rates, new hours</li>
                      <li>Upload files for your agency's portal, built for your account when you need them</li>
                    </ul>
                    {PRO_LINK ? (
                      <a
                        class="button-primary"
                        href={paymentUrl(PRO_LINK, state.userId, state.email)}
                        onClick={() => track("Pro checkout", { from: "records" })}
                      >
                        Start Pro
                      </a>
                    ) : (
                      <a class="button-primary" href="mailto:support@easywh347.com?subject=EasyWH347%20Pro">
                        Email us to start Pro
                      </a>
                    )}
                  </>
                )}
              </div>
            )}

            {state.projects.length === 0
              ? state.pro && (
                  <p class="lede">
                    Nothing saved yet. <a href={BASE}>Fill in this week's payroll</a> and press "Save to my records" at the bottom.
                  </p>
                )
              : state.projects.map((project) => {
                  const weeks = state.weeks.filter((w) => w.project_id === project.id);
                  const latestTyped = weeks.find((w) => w.first_worker !== null && w.first_worker !== undefined);
                  const name = project.name || project.number || "Untitled project";
                  const packetName = `certified-payrolls-${(project.number || project.name).replace(/[^\w-]+/g, "-").slice(0, 40)}`;
                  return (
                    <section class="project" key={project.id}>
                      <div class="project-head">
                        <div>
                          <h2>{name}</h2>
                          <p class="muted">
                            {[project.number && project.name ? project.number : "", project.location, project.contractor_name]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        <div class="project-actions">
                          {latestTyped && (
                            <button type="button" class="primary" disabled={busy !== ""} onClick={() => onOpen(latestTyped.id, true)}>
                              Start next week
                            </button>
                          )}
                          {weeks.length > 1 && (
                            <button
                              type="button"
                              class="link"
                              disabled={busy !== ""}
                              onClick={() =>
                                onPdf(
                                  [...weeks].reverse().map((w) => w.id),
                                  packetName,
                                )
                              }
                            >
                              All {weeks.length} weeks as one PDF
                            </button>
                          )}
                        </div>
                      </div>
                      <table class="weeks">
                        <thead>
                          <tr>
                            <th>Week ending</th>
                            <th>Payroll no.</th>
                            <th class="num">Workers</th>
                            <th class="num">Gross on project</th>
                            <th class="sr">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {weeks.map((w) => {
                            const name = fileBase(w, project);
                            return (
                              <tr key={w.id}>
                                <td>{shortDate(w.week_ending)}</td>
                                <td>
                                  {w.payroll_number}
                                  {w.is_final && " (final)"}
                                </td>
                                <td class="num">{w.workers}</td>
                                <td class="num">${formatMoney(Number(w.gross_cents))}</td>
                                <td class="row-actions">
                                  <button type="button" class="link" disabled={busy !== ""} onClick={() => onPdf([w.id], name)}>
                                    PDF
                                  </button>
                                  <button type="button" class="link" disabled={busy !== ""} onClick={() => onCsv(w.id, name)}>
                                    CSV
                                  </button>
                                  {w.first_worker !== null && w.first_worker !== undefined && (
                                    <button type="button" class="link" disabled={busy !== ""} onClick={() => onOpen(w.id, false)}>
                                      Open in form
                                    </button>
                                  )}
                                  {state.pro && (
                                    <button type="button" class="link quiet" disabled={busy !== ""} onClick={() => onDelete(w)}>
                                      Delete
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </section>
                  );
                })}
          </>
        )}
      </main>
    </>
  );
}

const root = document.getElementById("records");
initAdTag();
if (root) render(<Records />, root);
