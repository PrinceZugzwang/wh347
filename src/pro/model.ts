import { type CrewEntry, lastFour, type Payroll, type ProjectHeader } from "../core";

/**
 * Pure helpers for Pro records, kept apart from the Supabase calls so they
 * can be tested without a network.
 */

/** Weeks are grouped by project number, or by project name when there is no number. */
export function projectKey(header: ProjectHeader): string {
  const basis = header.projectNumber.trim() || header.projectName.trim();
  return basis.toLowerCase().replace(/\s+/g, " ");
}

export interface WeekSummary {
  workers: number;
  grossCents: number;
}

export function summarize(payroll: Payroll): WeekSummary {
  return {
    workers: new Set(payroll.rows.map((r) => r.entryNumber)).size,
    grossCents: payroll.rows.reduce((sum, r) => sum + r.grossThisProject, 0),
  };
}

/** Only the last four digits of any ID ever leave the browser. */
export function safeCrew(crew: CrewEntry[] | null): CrewEntry[] | null {
  if (!crew) return null;
  return crew.map((e) => ({ ...e, workerId: lastFour(e.workerId) }));
}

export function safePayroll(payroll: Payroll): Payroll {
  return { ...payroll, rows: payroll.rows.map((r) => ({ ...r, workerId: lastFour(r.workerId) })) };
}

/** Why a week can't be saved yet, or null when it can. */
export function cannotSave(header: ProjectHeader, payroll: Payroll | null): string | null {
  if (!payroll || payroll.rows.length === 0) return "Add at least one worker first.";
  if (!header.weekEnding) return "Add the week ending date first.";
  if (!projectKey(header)) return "Add the project name or number first, so the week is filed under the right project.";
  return null;
}

/** Stripe payment link with the account attached, so the payment turns on Pro for this login. */
export function paymentUrl(link: string, userId: string, email: string): string {
  const url = new URL(link);
  url.searchParams.set("client_reference_id", userId);
  if (email) url.searchParams.set("prefilled_email", email);
  return url.toString();
}
