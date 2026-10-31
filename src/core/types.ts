export type ContractorRole = "prime" | "subcontractor";

export type WorkerStatus = "J" | "RA";

export interface ProjectHeader {
  contractorName: string;
  contractorAddress: string;
  role: ContractorRole;
  projectName: string;
  projectLocation: string;
  projectNumber: string;
  payrollNumber: string;
  weekEnding: string;
  wageDeterminationNumber: string;
  isFinal: boolean;
}

/** One line of a timecard export: a worker, a day, a classification. */
export interface TimecardLine {
  sourceRow: number;
  workerName: string;
  workerId: string;
  status: WorkerStatus;
  apprenticeLevel: string;
  classification: string;
  date: string;
  /** Hundredths of an hour. */
  hours: number;
  /** Hundredths of an hour, when the export already splits overtime out. */
  overtimeHours: number | null;
  /** Cents per hour. */
  baseRate: number;
  /** Cents per hour, when the export carries an explicit overtime rate. */
  overtimeRate: number | null;
  fringeCredited: number;
  fringeCash: number;
  deductions: Partial<Record<DeductionKind, number>>;
  grossAllWork: number | null;
}

export const DEDUCTION_KINDS = ["fica", "federal", "state", "other"] as const;
export type DeductionKind = (typeof DEDUCTION_KINDS)[number];

export interface DayHours {
  date: string;
  straight: number;
  overtime: number;
}

/** One row on the payroll: a worker in one classification for the week. */
export interface PayrollRow {
  entryNumber: number;
  workerName: string;
  workerId: string;
  status: WorkerStatus;
  apprenticeLevel: string;
  classification: string;
  days: DayHours[];
  totalStraight: number;
  totalOvertime: number;
  baseRate: number;
  overtimeRate: number;
  fringeCreditedPerHour: number;
  fringeCashPerHour: number;
  fringeCreditedTotal: number;
  fringeCashTotal: number;
  grossThisProject: number;
  grossAllWork: number;
  deductions: Record<DeductionKind, number>;
  deductionsTotal: number;
  netPay: number;
  /** True on the first row of a worker who appears in more than one classification. */
  carriesWorkerTotals: boolean;
}

export interface Payroll {
  header: ProjectHeader;
  weekDates: string[];
  rows: PayrollRow[];
}

export type IssueLevel = "error" | "warning";

export interface Issue {
  level: IssueLevel;
  code: string;
  message: string;
  sourceRow?: number;
  workerName?: string;
}

export interface WageRate {
  classification: string;
  /** Cents per hour. */
  base: number;
  /** Cents per hour. */
  fringe: number;
}
