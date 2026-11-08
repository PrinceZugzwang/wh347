import type { Issue, TimecardLine, WorkerStatus } from "./types";
import { parseHours, parseMoney } from "./units";

/**
 * One worker as typed into the on-page form. Everything is kept as the text
 * the user typed, so a half-finished entry survives a reload unchanged; it is
 * parsed into integer cents and hundredths only when the payroll is built.
 */
export interface CrewEntry {
  key: string;
  name: string;
  /** Last four digits of the SSN, or another worker ID. */
  workerId: string;
  classification: string;
  status: WorkerStatus;
  apprenticeLevel: string;
  /** Seven entries, Sunday to Saturday of the week being reported. */
  hours: string[];
  baseRate: string;
  fringePlan: string;
  fringeCash: string;
  fica: string;
  federal: string;
  state: string;
  other: string;
  /** Only needed when the worker also earned money off this project this week. */
  grossAllWork: string;
}

let counter = 0;

export function emptyEntry(): CrewEntry {
  counter += 1;
  return {
    key: `${Date.now().toString(36)}-${counter}`,
    name: "",
    workerId: "",
    classification: "",
    status: "J",
    apprenticeLevel: "",
    hours: ["", "", "", "", "", "", ""],
    baseRate: "",
    fringePlan: "",
    fringeCash: "",
    fica: "",
    federal: "",
    state: "",
    other: "",
    grossAllWork: "",
  };
}

/** Keeps only the last four digits of anything that looks like an SSN, so a full number is never stored or printed. */
export function lastFour(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : raw.trim();
}

function isBlank(entry: CrewEntry): boolean {
  const typed: (keyof CrewEntry)[] = [
    "name",
    "workerId",
    "classification",
    "apprenticeLevel",
    "baseRate",
    "fringePlan",
    "fringeCash",
    "fica",
    "federal",
    "state",
    "other",
    "grossAllWork",
  ];
  return entry.hours.every((h) => h.trim() === "") && typed.every((k) => String(entry[k]).trim() === "");
}

/** A copy of the crew with this week's hours cleared, for starting the next weekly payroll. */
export function clearHours(crew: CrewEntry[]): CrewEntry[] {
  return crew.map((e) => ({ ...e, hours: e.hours.map(() => "") }));
}

/**
 * Turns the typed crew into the same timecard lines a payroll export
 * produces, so typed and imported payrolls go through one set of rules for
 * overtime, fringe, deductions and checks.
 */
export function crewToLines(crew: CrewEntry[], weekDates: string[]): { lines: TimecardLine[]; issues: Issue[] } {
  const lines: TimecardLine[] = [];
  const issues: Issue[] = [];

  crew.forEach((entry, index) => {
    if (isBlank(entry)) return;
    const who = entry.name.trim() || `Worker ${index + 1}`;
    const problems: string[] = [];

    if (!entry.name.trim()) problems.push("add a name");
    if (!entry.workerId.trim()) problems.push("add the last four digits of the SSN or another ID");
    if (!entry.classification.trim()) problems.push("add the classification, as written on the wage determination");

    const baseRate = parseMoney(entry.baseRate);
    if (baseRate === null || baseRate <= 0) problems.push("add the hourly rate");

    const money = (label: string, raw: string): number | null => {
      if (raw.trim() === "") return null;
      const value = parseMoney(raw);
      if (value === null || value < 0) problems.push(`${label} "${raw}" isn't an amount`);
      return value === null ? null : Math.abs(value);
    };
    const fringePlan = money("fringe paid to a plan", entry.fringePlan) ?? 0;
    const fringeCash = money("fringe paid in cash", entry.fringeCash) ?? 0;
    const deductions = {
      fica: money("FICA", entry.fica) ?? 0,
      federal: money("federal withholding", entry.federal) ?? 0,
      state: money("state withholding", entry.state) ?? 0,
      other: money("other deductions", entry.other) ?? 0,
    };
    const grossAllWork = money("gross for all work", entry.grossAllWork);

    const daily = weekDates.map((date, d) => {
      const raw = (entry.hours[d] ?? "").trim();
      if (raw === "") return { date, hours: 0 };
      const hours = parseHours(raw);
      if (hours === null || hours < 0) {
        problems.push(`hours "${raw}" on ${date} aren't a number`);
        return { date, hours: 0 };
      }
      return { date, hours };
    });
    const worked = daily.filter((d) => d.hours > 0);
    const hoursTyped = entry.hours.some((h) => h.trim() !== "");
    if (worked.length === 0 && !hoursTyped) {
      // A regular who didn't work on this project this week: keep them on the crew, leave them off this payroll.
      issues.push({
        level: "warning",
        code: "entry-no-hours",
        workerName: who,
        message: `${who}: no hours entered this week, so they are left off this payroll.`,
      });
      return;
    }
    if (worked.length === 0) problems.push("enter the hours worked on at least one day");

    if (problems.length > 0) {
      issues.push({ level: "error", code: "entry-incomplete", workerName: who, message: `${who}: ${problems.join("; ")}.` });
      return;
    }

    for (const day of worked) {
      lines.push({
        sourceRow: index + 1,
        workerName: entry.name.trim(),
        workerId: lastFour(entry.workerId),
        status: entry.status,
        apprenticeLevel: entry.status === "RA" ? entry.apprenticeLevel.trim() : "",
        classification: entry.classification.trim(),
        date: day.date,
        hours: day.hours,
        overtimeHours: null,
        baseRate: baseRate as number,
        overtimeRate: null,
        fringeCredited: fringePlan,
        fringeCash,
        // Repeated on every day of the week; buildPayroll counts identical repeats once.
        deductions,
        grossAllWork,
      });
    }
  });

  return { lines, issues };
}
