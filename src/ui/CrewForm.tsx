import { useMemo } from "preact/hooks";
import {
  buildPayroll,
  type CrewEntry,
  crewToLines,
  dayLetter,
  emptyEntry,
  formatHours,
  formatMoney,
  lastFour,
  type ProjectHeader,
} from "../core";

interface Props {
  crew: CrewEntry[];
  header: ProjectHeader;
  weekDates: string[];
  onChange: (crew: CrewEntry[]) => void;
}

type TextKey = Exclude<keyof CrewEntry, "key" | "status" | "hours">;

/** What one worker's week comes to, shown under their entry as they type. */
function summarize(entry: CrewEntry, header: ProjectHeader, weekDates: string[]): string {
  const { lines } = crewToLines([entry], weekDates);
  if (lines.length === 0) return "";
  const { payroll } = buildPayroll(header, lines);
  const row = payroll.rows[0];
  const hours = row.totalStraight + row.totalOvertime;
  const parts = [`${formatHours(hours)} hours`];
  if (row.totalOvertime > 0) parts[0] += `, ${formatHours(row.totalOvertime)} overtime at $${formatMoney(row.overtimeRate)}`;
  parts.push(`$${formatMoney(row.grossThisProject)} gross on this project`);
  parts.push(`$${formatMoney(row.netPay)} net`);
  return parts.join(" · ");
}

/**
 * The crew, typed in the order of the printed form: who the worker is, the
 * hours for each day, then rate and fringe. Deductions sit behind a fold
 * because many small contractors enter them from their payroll stub last.
 */
export function CrewForm({ crew, header, weekDates, onChange }: Props) {
  const summaries = useMemo(() => crew.map((e) => (header.weekEnding ? summarize(e, header, weekDates) : "")), [crew, header, weekDates]);

  const update = (index: number, patch: Partial<CrewEntry>) => onChange(crew.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  const setText = (index: number, key: TextKey, value: string) => update(index, { [key]: value } as Partial<CrewEntry>);
  const setHours = (index: number, day: number, value: string) =>
    update(index, { hours: crew[index].hours.map((h, d) => (d === day ? value : h)) });
  const remove = (index: number) => onChange(crew.length === 1 ? [emptyEntry()] : crew.filter((_, i) => i !== index));

  const text = (index: number, key: TextKey, label: string, cls: string, extra: Record<string, string> = {}) => (
    <label class={`cell ${cls}`}>
      <span>{label}</span>
      <input type="text" value={crew[index][key]} onInput={(e) => setText(index, key, e.currentTarget.value)} {...extra} />
    </label>
  );
  const money = (index: number, key: TextKey, label: string, cls = "") =>
    text(index, key, label, `money ${cls}`, { inputMode: "decimal", placeholder: "0.00" });

  return (
    <div class="crew">
      {crew.map((entry, i) => (
        <section class="entry" key={entry.key} aria-label={`Worker ${i + 1}`}>
          <div class="entry-head">
            <h3>
              <span class="entry-no">{i + 1}</span>
              {entry.name.trim() || "New worker"}
            </h3>
            <button type="button" class="link quiet" onClick={() => remove(i)}>
              Remove
            </button>
          </div>

          <div class="cells who">
            {text(i, "name", "Name", "w-name", { autoComplete: "off", placeholder: "Last, First" })}
            <label class="cell w-id">
              <span>Last 4 of SSN or ID</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={entry.workerId}
                onInput={(e) => setText(i, "workerId", e.currentTarget.value)}
                onBlur={(e) => setText(i, "workerId", lastFour(e.currentTarget.value))}
              />
            </label>
            {text(i, "classification", "Classification (as on the wage determination)", "w-class", { placeholder: "Electrician" })}
            <label class="cell w-status">
              <span>Status</span>
              <select value={entry.status} onChange={(e) => update(i, { status: e.currentTarget.value as CrewEntry["status"] })}>
                <option value="J">Journeyworker (J)</option>
                <option value="RA">Apprentice (RA)</option>
              </select>
            </label>
            {entry.status === "RA" &&
              text(i, "apprenticeLevel", "Apprentice level or period", "w-level", { placeholder: "e.g. 3rd period" })}
          </div>

          <div class="cells week">
            {weekDates.map((date, d) => (
              <label class="cell day" key={date}>
                <span>
                  {dayLetter(date)} {Number(date.slice(8))}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={entry.hours[d] ?? ""}
                  aria-label={`Hours on ${date}`}
                  onInput={(e) => setHours(i, d, e.currentTarget.value)}
                />
              </label>
            ))}
            {money(i, "baseRate", "Rate / hr", "rate")}
            {money(i, "fringePlan", "Fringe to plan", "fringe")}
            {money(i, "fringeCash", "Fringe in cash", "fringe")}
          </div>

          <details class="more" open={[entry.fica, entry.federal, entry.state, entry.other, entry.grossAllWork].some((v) => v.trim())}>
            <summary>Deductions this week</summary>
            <div class="cells deductions">
              {money(i, "fica", "FICA")}
              {money(i, "federal", "Federal tax")}
              {money(i, "state", "State tax")}
              {money(i, "other", "Other")}
              {money(i, "grossAllWork", "Gross for all work, if more than this project", "wide")}
            </div>
          </details>

          {summaries[i] && <p class="entry-sum">{summaries[i]}</p>}
        </section>
      ))}

      <button type="button" class="add-worker" onClick={() => onChange([...crew, emptyEntry()])}>
        Add a worker
      </button>
    </div>
  );
}
