import "./page";
import "./start.css";
import "./tools.css";

const params = new URLSearchParams(location.search);
const gc = (params.get("gc") ?? "").trim().slice(0, 80);
const source = gc ? `gc-${gc.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : (params.get("utm_source") ?? "behind");

if (gc) {
  const note = document.getElementById("from-gc")!;
  note.textContent = `${gc} sent you this page.`;
  note.hidden = false;
  // The page is for the sub at this point; the GC section would only confuse them.
  document.getElementById("for-gcs")!.hidden = true;
}

const cta = document.getElementById("cta") as HTMLAnchorElement;
cta.href = `start.html?utm_source=${encodeURIComponent(source)}`;
cta.addEventListener("click", () => window.plausible?.("Behind: send payroll", { props: { source } }));

const link = document.getElementById("gc-link") as HTMLInputElement;
document.getElementById("copy")!.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(link.value);
  } catch {
    link.select();
  }
  (document.getElementById("copy") as HTMLButtonElement).textContent = "Copied";
  window.plausible?.("GC copied link");
});
