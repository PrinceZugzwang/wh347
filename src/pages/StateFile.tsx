import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Payroll } from "../core";
import { type CaWorkerDetails, renderCaEcpr, renderNyXml, workersOf } from "../core/render/state";
import { track } from "../ui/analytics";
import { download } from "../ui/download";
import { load, save } from "../ui/storage";

export type PortalState = "CA" | "NY";

interface Props {
  payroll: Payroll;
  /** Project key, so registration and project numbers are remembered per project. */
  projectKey: string;
  fileBase: string;
  onClose: () => void;
}

interface ProjectIds {
  caPWCR: string;
  caProjectId: string;
  caAwardingBody: string;
  nyPRC: string;
}

type WorkerDetails = Partial<CaWorkerDetails>;

const BLANK_IDS: ProjectIds = { caPWCR: "", caProjectId: "", caAwardingBody: "", nyPRC: "" };

/** CA or NY from the wage determination number or project location, CA when unclear. */
export function guessState(payroll: Payroll): PortalState {
  const h = payroll.header;
  if (/^NY/i.test(h.wageDeterminationNumber) || /,\s*NY\b|New York/i.test(h.projectLocation)) return "NY";
  return "CA";
}

/**
 * Builds a California eCPR or New York bulk-upload XML for one saved week.
 * Details the WH-347 doesn't carry are asked for here and remembered in this
 * browser only (never in the account), the same way the free form keeps the crew.
 */
export function StateFile({ payroll, projectKey, fileBase, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const workers = useMemo(() => workersOf(payroll), [payroll]);
  const [portal, setPortal] = useState<PortalState>(() => guessState(payroll));
  const [ids, setIds] = useState<ProjectIds>(() => load(`portal-ids:${projectKey}`, BLANK_IDS));
  const [people, setPeople] = useState<Record<string, WorkerDetails>>(() => load("portal-workers", {}));
  const [missing, setMissing] = useState<string[]>([]);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  function setId(key: keyof ProjectIds, value: string) {
    setIds((prev) => ({ ...prev, [key]: value }));
  }

  function setPerson(key: string, field: keyof CaWorkerDetails, value: string) {
    setPeople((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  }

  function complete(d: WorkerDetails | undefined): CaWorkerDetails {
    return { street: "", city: "", state: "", zip: "", ssn: "", ...d };
  }

  function onBuild(e: Event) {
    e.preventDefault();
    save(`portal-ids:${projectKey}`, ids);
    save("portal-workers", people);
    const byKey = Object.fromEntries(workers.map((w) => [w.key, complete(people[w.key])]));
    const out =
      portal === "CA"
        ? renderCaEcpr(payroll, {
            contractorPWCR: ids.caPWCR,
            projectId: ids.caProjectId,
            awardingBody: ids.caAwardingBody,
            workers: byKey,
          })
        : renderNyXml(payroll, { prcNumber: ids.nyPRC, workers: byKey });
    if (!out.xml) {
      setMissing(out.missing);
      track("State file blocked", { state: portal, missing: out.missing.length });
      return;
    }
    setMissing([]);
    download(out.xml, `${fileBase}-${portal === "CA" ? "ca-ecpr" : "ny-dol"}.xml`, "application/xml");
    track("State file downloaded", { state: portal, workers: workers.length });
  }

  return (
    <dialog ref={dialog} class="pro-dialog state-dialog" onClose={onClose}>
      <form onSubmit={onBuild}>
        <h2>State portal file</h2>
        <p>
          An upload file for the state's own certified payroll system, built from this week. Details the WH-347 doesn't have are asked for
          once and kept in this browser, not in your account.
        </p>

        <div class="state-pick" role="radiogroup" aria-label="State">
          <label>
            <input type="radio" name="portal" checked={portal === "CA"} onChange={() => setPortal("CA")} /> California DIR (eCPR)
          </label>
          <label>
            <input type="radio" name="portal" checked={portal === "NY"} onChange={() => setPortal("NY")} /> New York DOL
          </label>
        </div>

        {portal === "CA" ? (
          <fieldset>
            <legend>Project</legend>
            <label class="pro-field">
              DIR contractor registration number
              <input
                inputMode="numeric"
                value={ids.caPWCR}
                onInput={(e) => setId("caPWCR", e.currentTarget.value)}
                placeholder="10 digits"
              />
            </label>
            <label class="pro-field">
              DIR project ID
              <input inputMode="numeric" value={ids.caProjectId} onInput={(e) => setId("caProjectId", e.currentTarget.value)} />
            </label>
            <label class="pro-field">
              Awarding body <span class="opt">optional</span>
              <input value={ids.caAwardingBody} onInput={(e) => setId("caAwardingBody", e.currentTarget.value)} />
            </label>
          </fieldset>
        ) : (
          <fieldset>
            <legend>Project</legend>
            <label class="pro-field">
              Prevailing Rate Case (PRC) number
              <input value={ids.nyPRC} onInput={(e) => setId("nyPRC", e.currentTarget.value)} placeholder="10 characters" />
            </label>
          </fieldset>
        )}

        {workers.map((w) => {
          const d = people[w.key] ?? {};
          return (
            <fieldset key={w.key}>
              <legend>{w.name}</legend>
              <div class="state-grid">
                <label class="pro-field wide">
                  Home street address
                  <input value={d.street ?? ""} onInput={(e) => setPerson(w.key, "street", e.currentTarget.value)} />
                </label>
                <label class="pro-field">
                  City
                  <input value={d.city ?? ""} onInput={(e) => setPerson(w.key, "city", e.currentTarget.value)} />
                </label>
                <label class="pro-field short">
                  State
                  <input
                    maxLength={2}
                    value={d.state ?? ""}
                    onInput={(e) => setPerson(w.key, "state", e.currentTarget.value)}
                    placeholder="CA"
                  />
                </label>
                <label class="pro-field short">
                  ZIP
                  <input value={d.zip ?? ""} onInput={(e) => setPerson(w.key, "zip", e.currentTarget.value)} />
                </label>
                {portal === "CA" && (
                  <>
                    <label class="pro-field">
                      Full SSN or ITIN
                      <input
                        inputMode="numeric"
                        autoComplete="off"
                        value={d.ssn ?? ""}
                        onInput={(e) => setPerson(w.key, "ssn", e.currentTarget.value)}
                        placeholder="9 digits"
                      />
                    </label>
                    <label class="pro-field pair">
                      Check no.
                      <input value={d.checkNum ?? ""} onInput={(e) => setPerson(w.key, "checkNum", e.currentTarget.value)} />
                    </label>
                  </>
                )}
              </div>
            </fieldset>
          );
        })}

        {portal === "CA" && (
          <p class="state-note">
            California asks for the full SSN. It stays in this browser and in the file you download, and is never sent to us. The WH-347 has
            one fringe amount per hour, so the file reports it under "Other".
          </p>
        )}

        {missing.length > 0 && (
          <div class="state-missing" role="alert">
            <b>Still needed before the file can be made:</b>
            <ul>
              {missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}

        <div class="pro-actions">
          <button type="submit" class="primary">
            Download {portal === "CA" ? "eCPR" : "NY DOL"} XML
          </button>
          <button type="button" class="link" onClick={() => dialog.current?.close()}>
            Close
          </button>
        </div>
      </form>
    </dialog>
  );
}
