import "./page";
import "./start.css";
import "./tools.css";

interface Check {
  t: number;
  s: "up" | "slow" | "down";
  ms: number;
}
interface Portal {
  id: string;
  name: string;
  area: string;
  url: string;
  history: Check[];
}

const SOURCE = "https://raw.githubusercontent.com/PrinceZugzwang/wh347/status/status.json";
const DAY = 24 * 60 * 60 * 1000;
const LABEL = { up: "Up", slow: "Slow", down: "Down" } as const;

function ago(t: number): string {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} hour${h === 1 ? "" : "s"} ago`;
}

/** 24 hourly cells, oldest first; each shows the worst result seen in that hour. */
function hours(history: Check[]): ("up" | "slow" | "down" | "none")[] {
  const now = Date.now();
  const rank = { up: 0, slow: 1, down: 2 };
  return Array.from({ length: 24 }, (_, i) => {
    const from = now - (24 - i) * (DAY / 24);
    const inHour = history.filter((h) => h.t >= from && h.t < from + DAY / 24);
    if (!inHour.length) return "none";
    return inHour.reduce((w, h) => (rank[h.s] > rank[w] ? h.s : w), "up" as Check["s"]);
  });
}

function row(p: Portal): HTMLTableRowElement {
  const tr = document.createElement("tr");
  const last = p.history.at(-1);
  const name = document.createElement("th");
  name.scope = "row";
  const a = document.createElement("a");
  a.href = p.url;
  a.rel = "nofollow";
  a.textContent = p.name;
  const area = document.createElement("span");
  area.className = "area";
  area.textContent = p.area;
  name.append(a, area);

  const now = document.createElement("td");
  now.className = `state ${last?.s ?? "none"}`;
  now.textContent = last ? `${LABEL[last.s]}${last.s === "down" ? "" : ` · ${(last.ms / 1000).toFixed(1)}s`}` : "No data";

  const hist = document.createElement("td");
  hist.className = "hist";
  const strip = document.createElement("span");
  strip.className = "strip";
  for (const s of hours(p.history)) {
    const cell = document.createElement("i");
    cell.className = s;
    strip.append(cell);
  }
  strip.setAttribute("aria-label", "Hourly results for the last 24 hours, oldest first");
  hist.append(strip);

  const up = document.createElement("td");
  up.className = "num";
  const counted = p.history.length;
  up.textContent = counted ? `${((p.history.filter((h) => h.s !== "down").length / counted) * 100).toFixed(1)}%` : "–";

  tr.append(name, now, hist, up);
  return tr;
}

async function load() {
  const checked = document.getElementById("checked")!;
  try {
    const res = await fetch(`${SOURCE}?t=${Math.floor(Date.now() / 60000)}`, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { checkedAt: number; portals: Portal[] };
    const body = document.querySelector("#board tbody")!;
    body.replaceChildren(...data.portals.map(row));
    const down = data.portals.filter((p) => p.history.at(-1)?.s === "down").map((p) => p.name);
    checked.textContent = `Last checked ${ago(data.checkedAt)}. ${down.length ? `Down now: ${down.join(", ")}.` : "Every portal answered."}`;
  } catch {
    checked.textContent = "Couldn't load the latest checks. Try again in a minute.";
  }
}

void load();
setInterval(load, 5 * 60 * 1000);
