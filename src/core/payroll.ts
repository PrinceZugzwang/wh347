import { workweek } from "./dates";
import {
  DEDUCTION_KINDS,
  type DeductionKind,
  type Issue,
  type Payroll,
  type PayrollRow,
  type ProjectHeader,
  type TimecardLine,
} from "./types";
import { extend, timeAndHalf } from "./units";

/** Contract Work Hours and Safety Standards Act: overtime after 40 hours in the workweek. */
export const WEEKLY_OVERTIME_THRESHOLD = 40_00;

interface SplitLine extends TimecardLine {
  straight: number;
  overtime: number;
}

function workerKey(line: TimecardLine): string {
  return `${line.workerId}\u0000${line.workerName.toLowerCase()}`;
}

function rowKey(line: TimecardLine): string {
  return [
    line.classification.toLowerCase(),
    line.status,
    line.apprenticeLevel,
    line.baseRate,
    line.overtimeRate ?? "",
    line.fringeCredited,
    line.fringeCash,
  ].join("\u0000");
}

/**
 * Splits each line into straight time and overtime for one worker's week.
 * If the export already separates overtime, that split is kept; otherwise
 * hours past 40 in date order become overtime.
 */
function splitOvertime(lines: TimecardLine[], issues: Issue[]): SplitLine[] {
  const ordered = [...lines].sort((a, b) => a.date.localeCompare(b.date) || a.sourceRow - b.sourceRow);
  const explicit = ordered.some((l) => l.overtimeHours !== null);

  if (explicit) {
    const result = ordered.map((l) => ({ ...l, straight: l.hours, overtime: l.overtimeHours ?? 0 }));
    const straight = result.reduce((s, l) => s + l.straight, 0);
    if (straight > WEEKLY_OVERTIME_THRESHOLD) {
      issues.push({
        level: "error",
        code: "overtime-under-reported",
        workerName: lines[0].workerName,
        message: `${lines[0].workerName}: ${straight / 100} straight-time hours this week. Hours over 40 must be paid as overtime.`,
      });
    }
    return result;
  }

  let running = 0;
  return ordered.map((l) => {
    const room = Math.max(0, WEEKLY_OVERTIME_THRESHOLD - running);
    const straight = Math.min(l.hours, room);
    running += l.hours;
    return { ...l, straight, overtime: l.hours - straight };
  });
}

/**
 * A weekly deduction or gross figure is usually repeated on every daily line
 * of an export. Identical repeats count once; differing values are summed and
 * flagged so the user can check them.
 */
function weekFigure(values: number[], label: string, worker: string, issues: Issue[]): number | null {
  if (values.length === 0) return null;
  if (values.every((v) => v === values[0])) return values[0];
  issues.push({
    level: "warning",
    code: "weekly-figure-summed",
    workerName: worker,
    message: `${worker}: ${label} differs across rows, so the values were added together. Check the total.`,
  });
  return values.reduce((s, v) => s + v, 0);
}

export function buildPayroll(header: ProjectHeader, lines: TimecardLine[]): { payroll: Payroll; issues: Issue[] } {
  const issues: Issue[] = [];
  const weekDates = workweek(header.weekEnding);
  const inWeek = new Set(weekDates);

  const kept = lines.filter((l) => {
    if (inWeek.has(l.date)) return true;
    issues.push({
      level: "error",
      code: "date-outside-week",
      sourceRow: l.sourceRow,
      workerName: l.workerName,
      message: `Row ${l.sourceRow}: ${l.date} is outside the week ending ${header.weekEnding}. The row was left off.`,
    });
    return false;
  });

  const byWorker = new Map<string, TimecardLine[]>();
  for (const line of kept) {
    const key = workerKey(line);
    byWorker.set(key, [...(byWorker.get(key) ?? []), line]);
  }

  const rows: PayrollRow[] = [];
  let entryNumber = 0;

  for (const workerLines of byWorker.values()) {
    entryNumber += 1;
    const name = workerLines[0].workerName;
    const split = splitOvertime(workerLines, issues);

    const groups = new Map<string, SplitLine[]>();
    for (const line of split) groups.set(rowKey(line), [...(groups.get(rowKey(line)) ?? []), line]);

    const workerRows: PayrollRow[] = [];
    for (const group of groups.values()) {
      const first = group[0];
      const days = weekDates.map((date) => {
        const onDay = group.filter((l) => l.date === date);
        return {
          date,
          straight: onDay.reduce((s, l) => s + l.straight, 0),
          overtime: onDay.reduce((s, l) => s + l.overtime, 0),
        };
      });
      const totalStraight = days.reduce((s, d) => s + d.straight, 0);
      const totalOvertime = days.reduce((s, d) => s + d.overtime, 0);
      const totalHours = totalStraight + totalOvertime;
      const overtimeRate = first.overtimeRate ?? timeAndHalf(first.baseRate);
      const fringeCashTotal = extend(first.fringeCash, totalHours);

      workerRows.push({
        entryNumber,
        workerName: name,
        workerId: first.workerId,
        status: first.status,
        apprenticeLevel: first.apprenticeLevel,
        classification: first.classification,
        days,
        totalStraight,
        totalOvertime,
        baseRate: first.baseRate,
        overtimeRate,
        fringeCreditedPerHour: first.fringeCredited,
        fringeCashPerHour: first.fringeCash,
        fringeCreditedTotal: extend(first.fringeCredited, totalHours),
        fringeCashTotal,
        grossThisProject: extend(first.baseRate, totalStraight) + extend(overtimeRate, totalOvertime) + fringeCashTotal,
        grossAllWork: 0,
        deductions: { fica: 0, federal: 0, state: 0, other: 0 },
        deductionsTotal: 0,
        netPay: 0,
        carriesWorkerTotals: false,
      });
    }

    const projectGross = workerRows.reduce((s, r) => s + r.grossThisProject, 0);
    const reportedGross = weekFigure(
      workerLines.flatMap((l) => (l.grossAllWork === null ? [] : [l.grossAllWork])),
      "gross pay for all work",
      name,
      issues,
    );
    const grossAllWork = reportedGross ?? projectGross;
    if (reportedGross !== null && reportedGross < projectGross) {
      issues.push({
        level: "error",
        code: "gross-below-project",
        workerName: name,
        message: `${name}: gross for all work ($${(reportedGross / 100).toFixed(2)}) is less than gross on this project ($${(projectGross / 100).toFixed(2)}).`,
      });
    }

    const deductions = {} as Record<DeductionKind, number>;
    for (const kind of DEDUCTION_KINDS) {
      const values = workerLines.flatMap((l) => (l.deductions[kind] === undefined ? [] : [l.deductions[kind] as number]));
      deductions[kind] = weekFigure(values, `${kind} deduction`, name, issues) ?? 0;
    }
    const deductionsTotal = DEDUCTION_KINDS.reduce((s, k) => s + deductions[k], 0);

    const head = workerRows[0];
    head.carriesWorkerTotals = true;
    head.grossAllWork = grossAllWork;
    head.deductions = deductions;
    head.deductionsTotal = deductionsTotal;
    head.netPay = grossAllWork - deductionsTotal;
    rows.push(...workerRows);
  }

  return { payroll: { header, weekDates, rows }, issues };
}
