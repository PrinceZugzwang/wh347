import { useRef, useState } from "preact/hooks";
import type { CrewEntry, Payroll, ProjectHeader } from "../core";
import { PRO_LINK, RECORDS_URL } from "../pro/config";
import { cannotSave, paymentUrl } from "../pro/model";
import { track } from "./analytics";

/**
 * "Save to my records" in the bottom bar. Free users are asked to sign in and
 * then offered Pro; Pro users save the week under its project.
 */

interface Props {
  header: ProjectHeader;
  crew: CrewEntry[] | null;
  ratesText: string;
  payroll: Payroll | null;
  ready: boolean;
}

type Step =
  | { kind: "closed" }
  | { kind: "email"; error?: string }
  | { kind: "sent"; email: string }
  | { kind: "upgrade"; userId: string; email: string }
  | { kind: "saved"; text: string }
  | { kind: "error"; text: string };

export function ProSave({ header, crew, ratesText, payroll, ready }: Props) {
  const [step, setStep] = useState<Step>({ kind: "closed" });
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);

  function open(next: Step) {
    setStep(next);
    if (!dialog.current?.open) dialog.current?.showModal();
  }

  async function onSave() {
    const blocked = cannotSave(header, payroll);
    if (blocked || !payroll) {
      open({ kind: "error", text: blocked ?? "Nothing to save yet." });
      return;
    }
    setBusy(true);
    try {
      const api = await import("../pro/api");
      const session = await api.currentSession();
      if (!session) {
        track("Pro save", { state: "signed out" });
        open({ kind: "email" });
        return;
      }
      const profile = await api.getProfile();
      if (!profile?.pro_active) {
        track("Pro save", { state: "not pro" });
        open({ kind: "upgrade", userId: session.user.id, email: session.user.email ?? "" });
        return;
      }
      const { replaced, projectName } = await api.saveWeek({ header, crew, ratesText, payroll });
      track("Pro save", { state: replaced ? "replaced" : "saved", workers: payroll.rows.length });
      open({
        kind: "saved",
        text: `${replaced ? "Updated" : "Saved"}: week ending ${header.weekEnding}, under ${projectName || "this project"}.`,
      });
    } catch (err) {
      open({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function onSendLink(e: Event) {
    e.preventDefault();
    const address = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(address)) {
      setStep({ kind: "email", error: "Enter your email address." });
      return;
    }
    setBusy(true);
    try {
      const api = await import("../pro/api");
      // Come back to the form, which is still filled in from this browser.
      await api.sendSignInLink(address, `${window.location.origin}${import.meta.env.BASE_URL}?continue=1`);
      track("Pro sign-in link sent", { from: "save" });
      setStep({ kind: "sent", email: address });
    } catch (err) {
      setStep({ kind: "email", error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  const link = PRO_LINK;

  return (
    <>
      <button type="button" class="link" disabled={!ready || busy} onClick={onSave}>
        {busy && step.kind === "closed" ? "Saving" : "Save to my records"}
      </button>

      <dialog ref={dialog} class="pro-dialog" onClose={() => setStep({ kind: "closed" })}>
        {step.kind === "email" && (
          <form onSubmit={onSendLink}>
            <h2>Keep every week on file</h2>
            <p>
              Pro saves each week you file, by project, for the three years after the work ends. Sign in with your email first. We'll send
              you a link; there's no password.
            </p>
            <label class="pro-field">
              Email
              <input type="email" autoComplete="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} required />
            </label>
            {step.error && <p class="error-text">{step.error}</p>}
            <div class="pro-actions">
              <button type="submit" class="primary" disabled={busy}>
                {busy ? "Sending" : "Email me a sign-in link"}
              </button>
              <button type="button" class="link" onClick={() => dialog.current?.close()}>
                Not now
              </button>
            </div>
            <p class="small muted">This week stays filled in here while you check your email.</p>
          </form>
        )}

        {step.kind === "sent" && (
          <div>
            <h2>Check your email</h2>
            <p>
              We sent a sign-in link to <b>{step.email}</b>. Open it on this computer and you'll come back to this form, still filled in.
              Then press Save again.
            </p>
            <div class="pro-actions">
              <button type="button" class="primary" onClick={() => dialog.current?.close()}>
                OK
              </button>
            </div>
          </div>
        )}

        {step.kind === "upgrade" && (
          <div>
            <h2>Saving weeks is part of Pro</h2>
            <p class="pro-price">
              $39 <span>a month per company. Cancel any time.</span>
            </p>
            <ul>
              <li>Every week you file, saved by project, for the three years the rules require</li>
              <li>Any week back as a PDF or CSV in a minute, or a whole project in one file for an agency, a prime or an auditor</li>
              <li>Next week starts from the last one: same crew and rates, new hours</li>
              <li>Email support from a person</li>
            </ul>
            <div class="pro-actions">
              {link ? (
                <a
                  class="button-primary"
                  href={paymentUrl(link, step.userId, step.email)}
                  onClick={() => track("Pro checkout", { from: "save" })}
                >
                  Start Pro
                </a>
              ) : (
                <a class="button-primary" href="mailto:support@easywh347.com?subject=EasyWH347%20Pro">
                  Email us to start Pro
                </a>
              )}
              <button type="button" class="link" onClick={() => dialog.current?.close()}>
                Not now
              </button>
            </div>
            <p class="small muted">Signed in as {step.email}. Downloading the PDF stays free.</p>
          </div>
        )}

        {step.kind === "saved" && (
          <div>
            <h2>Saved</h2>
            <p>{step.text}</p>
            <div class="pro-actions">
              <button type="button" class="primary" onClick={() => dialog.current?.close()}>
                OK
              </button>
              <a href={RECORDS_URL}>See your records</a>
            </div>
          </div>
        )}

        {step.kind === "error" && (
          <div>
            <h2>Not saved</h2>
            <p>{step.text}</p>
            <div class="pro-actions">
              <button type="button" class="primary" onClick={() => dialog.current?.close()}>
                OK
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
