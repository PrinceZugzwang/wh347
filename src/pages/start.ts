import "./page";
import "./start.css";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../pro/config";

const TRIAL_LINK = "https://buy.stripe.com/6oUeVd6Vb9TQbz21Esc7u03";
const MAX_BYTES = 20 * 1024 * 1024;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const track = (event: string, props?: Record<string, string | number>) =>
  window.plausible?.(event, props ? { props: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, String(v)])) } : undefined);

const params = new URLSearchParams(location.search);
const fromTrial = params.has("trial");
if (fromTrial) {
  $("welcome").hidden = false;
  $("intro").hidden = true;
  $("pay").hidden = true;
  track("Trial started");
}

const emailInput = $<HTMLInputElement>("email");
const prefill = params.get("email");
if (prefill) emailInput.value = prefill;

const fileInput = $<HTMLInputElement>("file");
fileInput.addEventListener("change", () => {
  const files = [...(fileInput.files ?? [])];
  $("file-label").textContent = files.length ? files.map((f) => f.name).join(", ") : "Choose files";
});

/** Keeps the trial link's email in step with what was typed, so Stripe starts filled in. */
function syncTrialLink() {
  const url = new URL(TRIAL_LINK);
  const email = emailInput.value.trim();
  if (email) url.searchParams.set("prefilled_email", email);
  $<HTMLAnchorElement>("trial").href = url.toString();
}
emailInput.addEventListener("input", syncTrialLink);
syncTrialLink();
$("trial").addEventListener("click", () => track("Trial checkout opened"));

const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, "_").slice(-80) || "file";
}

async function uploadFile(folder: string, file: File): Promise<string> {
  const path = `${folder}/${safeName(file.name)}`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/payroll-uploads/${path}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" },
    body: file,
  });
  if (!res.ok) throw new Error(`upload ${res.status}`);
  return path;
}

$<HTMLFormElement>("upload").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = $("upload-status");
  const button = $<HTMLButtonElement>("send");
  const files = [...(fileInput.files ?? [])];
  if (files.some((f) => f.size > MAX_BYTES)) {
    status.textContent = "One file is over 20 MB. Email it to support@easywh347.com instead.";
    return;
  }
  button.disabled = true;
  status.textContent = files.length ? "Sending…" : "Saving…";
  try {
    const folder = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}`;
    const paths: string[] = [];
    for (const file of files) paths.push(await uploadFile(folder, file));
    const res = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        kind: "done_for_you",
        email: emailInput.value.trim(),
        phone: $<HTMLInputElement>("phone").value.trim() || null,
        files_in: $<HTMLSelectElement>("files-in").value || null,
        company: $<HTMLInputElement>("company").value.trim() || null,
        file_paths: paths,
        source: fromTrial ? "start/after-trial" : `start/${params.get("utm_source") ?? "direct"}`,
      }),
    });
    if (!res.ok) throw new Error(`lead ${res.status}`);
    track("Payroll uploaded", { files: files.length, files_in: $<HTMLSelectElement>("files-in").value || "unknown" });
    status.textContent = fromTrial
      ? "Got it. We'll email your certified payroll to review within one business day."
      : "Got it. Now start the free two weeks below so we can file it for you.";
    $("upload").classList.add("done");
    if (!fromTrial) $("pay").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch {
    status.textContent = "That didn't go through. Email the file to support@easywh347.com and we'll take it from there.";
    button.disabled = false;
  }
});
