import "./page";
import "./start.css";
import "./tools.css";
import { checkEcpr } from "../core/ecprCheck";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLInputElement>("file");
const result = $("result");

function render(name: string, xml: string) {
  const r = checkEcpr(xml);
  window.plausible?.("eCPR checked", { props: { ok: String(r.ok), problems: String(r.problems.length) } });
  result.replaceChildren();
  const head = document.createElement("p");
  head.className = r.ok ? "verdict pass" : "verdict fail";
  head.textContent = r.ok
    ? `${name}: no problems found. ${r.employees} employee${r.employees === 1 ? "" : "s"}, week ending ${r.weekEnding}.`
    : `${name}: ${r.problems.length} problem${r.problems.length === 1 ? "" : "s"} DIR is likely to reject.`;
  result.append(head);
  if (!r.ok) {
    const list = document.createElement("ol");
    list.className = "problems";
    for (const p of r.problems.slice(0, 200)) {
      const li = document.createElement("li");
      const where = document.createElement("b");
      where.textContent = p.where;
      const link = document.createElement("a");
      link.href = `#${p.topic}`;
      link.textContent = "How to fix";
      li.append(where, document.createTextNode(` ${p.message} `), link);
      list.append(li);
    }
    result.append(list);
  }
  const note = document.createElement("p");
  note.className = "fine";
  note.textContent =
    "DIR's own check is final. Totals, gross and net pay are stored as entered, so check those figures against your payroll yourself.";
  result.append(note);
}

input.addEventListener("change", async () => {
  const file = input.files?.[0];
  if (!file) return;
  $("file-label").textContent = file.name;
  render(file.name, await file.text());
});
