import { useState } from "preact/hooks";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../pro/config";
import { track } from "./analytics";

const STATES = [
  ["CA", "California (DIR eCPR)"],
  ["NY", "New York (NY DOL)"],
  ["LCP", "LCPtracker, any state"],
  ["FED", "Paper or PDF to the prime"],
  ["OTHER", "Somewhere else"],
] as const;

/** UTM campaign and source for the visit, so a request can be traced to the ad that brought it. */
function visitSource(): string {
  try {
    const p = new URLSearchParams(location.search);
    const parts = [p.get("utm_source"), p.get("utm_campaign")].filter(Boolean);
    if (parts.length) return parts.join("/");
    return document.referrer ? new URL(document.referrer).hostname : "direct";
  } catch {
    return "unknown";
  }
}

/**
 * One-tap request for the done-for-you service: email, how to file, and an
 * optional phone. Saved straight to the leads table, so nothing depends on the
 * visitor's phone opening a mail app.
 */
export function LeadForm() {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [state, setState] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function onSubmit(e: Event) {
    e.preventDefault();
    if (status === "sending") return;
    setStatus("sending");
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          kind: "done_for_you",
          email: email.trim(),
          phone: phone.trim() || null,
          files_in: state || null,
          source: visitSource(),
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setStatus("sent");
      track("Done for you request", { files_in: state || "unknown", phone: phone ? "yes" : "no" });
    } catch {
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <p class="lead-done" role="status">
        Got it. We'll email you within one business day to set up your first week.
      </p>
    );
  }

  return (
    <form class="lead-form" onSubmit={onSubmit}>
      <label>
        Work email
        <input
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          value={email}
          onInput={(e) => setEmail(e.currentTarget.value)}
          onFocus={() => track("Done for you interest")}
        />
      </label>
      <label>
        Where you file
        <select value={state} onChange={(e) => setState(e.currentTarget.value)}>
          <option value="">Choose one</option>
          {STATES.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>
          Phone <span class="opt">optional</span>
        </span>
        <input type="tel" autoComplete="tel" inputMode="tel" value={phone} onInput={(e) => setPhone(e.currentTarget.value)} />
      </label>
      <button type="submit" class="primary" disabled={status === "sending"}>
        {status === "sending" ? "Sending…" : "Get started"}
      </button>
      {status === "error" && (
        <p class="error-text">
          That didn't go through. Email <a href="mailto:support@easywh347.com">support@easywh347.com</a> instead.
        </p>
      )}
    </form>
  );
}
