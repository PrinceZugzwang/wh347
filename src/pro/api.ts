import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { CrewEntry, Payroll, ProjectHeader } from "../core";
import { proConfigured, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import { projectKey, safeCrew, safePayroll, summarize } from "./model";

/**
 * Pro records in Supabase. The client library is only loaded when someone
 * uses Pro, so the free form stays as light as before.
 */

let client: Promise<SupabaseClient> | null = null;

export function supabase(): Promise<SupabaseClient> {
  if (!proConfigured) return Promise.reject(new Error("Pro isn't set up on this site yet."));
  client ??= import("@supabase/supabase-js").then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
    }),
  );
  return client;
}

/** Cheap check for a saved login without loading the client library. */
export function hasStoredSession(): boolean {
  try {
    return Object.keys(localStorage).some((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
  } catch {
    return false;
  }
}

export async function currentSession(): Promise<Session | null> {
  const sb = await supabase();
  const { data } = await sb.auth.getSession();
  return data.session;
}

export async function sendSignInLink(email: string, returnTo: string): Promise<void> {
  const sb = await supabase();
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: returnTo, shouldCreateUser: true } });
  if (error) throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  const sb = await supabase();
  await sb.auth.signOut();
}

export interface Profile {
  user_id: string;
  email: string | null;
  pro_active: boolean;
}

export async function getProfile(): Promise<Profile | null> {
  const sb = await supabase();
  const { data, error } = await sb.from("profiles").select("user_id, email, pro_active").maybeSingle();
  if (error) throw new Error(error.message);
  return data as Profile | null;
}

export interface ProjectRecord {
  id: string;
  project_key: string;
  name: string;
  number: string;
  location: string;
  contractor_name: string;
  header: ProjectHeader;
  rates_text: string;
  updated_at: string;
}

export interface WeekListItem {
  id: string;
  project_id: string;
  week_ending: string;
  payroll_number: string;
  is_final: boolean;
  workers: number;
  gross_cents: number;
  updated_at: string;
  /** First worker of the typed form, or null when the week came from an imported file and can't be reopened in the form. */
  first_worker?: unknown;
}

export interface WeekRecord extends WeekListItem {
  header: ProjectHeader;
  crew: CrewEntry[] | null;
  rates_text: string;
  payroll: Payroll;
}

export interface SaveInput {
  header: ProjectHeader;
  crew: CrewEntry[] | null;
  ratesText: string;
  payroll: Payroll;
}

/** Files the week under its project, replacing an earlier save of the same week. Returns whether it replaced one. */
export async function saveWeek(input: SaveInput): Promise<{ replaced: boolean; projectName: string }> {
  const sb = await supabase();
  const { header } = input;
  const key = projectKey(header);

  const { data: project, error: projectError } = await sb
    .from("projects")
    .upsert(
      {
        project_key: key,
        name: header.projectName.trim(),
        number: header.projectNumber.trim(),
        location: header.projectLocation.trim(),
        contractor_name: header.contractorName.trim(),
        header: { ...header, isFinal: false },
        rates_text: input.ratesText,
      },
      { onConflict: "user_id,project_key" },
    )
    .select("id, name, number")
    .single();
  if (projectError) throw new Error(friendly(projectError.message));

  const { data: existing } = await sb
    .from("weeks")
    .select("id")
    .eq("project_id", project.id)
    .eq("week_ending", header.weekEnding)
    .maybeSingle();

  const summary = summarize(input.payroll);
  const { error } = await sb.from("weeks").upsert(
    {
      project_id: project.id,
      week_ending: header.weekEnding,
      payroll_number: header.payrollNumber.trim(),
      is_final: header.isFinal,
      header,
      crew: safeCrew(input.crew),
      rates_text: input.ratesText,
      payroll: safePayroll(input.payroll),
      workers: summary.workers,
      gross_cents: summary.grossCents,
    },
    { onConflict: "project_id,week_ending" },
  );
  if (error) throw new Error(friendly(error.message));
  return { replaced: Boolean(existing), projectName: project.name || project.number };
}

export async function listProjects(): Promise<ProjectRecord[]> {
  const sb = await supabase();
  const { data, error } = await sb.from("projects").select("*").order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data as ProjectRecord[];
}

export async function listWeeks(): Promise<WeekListItem[]> {
  const sb = await supabase();
  const { data, error } = await sb
    .from("weeks")
    .select("id, project_id, week_ending, payroll_number, is_final, workers, gross_cents, updated_at, first_worker:crew->0")
    .order("week_ending", { ascending: false });
  if (error) throw new Error(error.message);
  return data as WeekListItem[];
}

export async function getWeeks(ids: string[]): Promise<WeekRecord[]> {
  const sb = await supabase();
  const { data, error } = await sb.from("weeks").select("*").in("id", ids).order("week_ending", { ascending: true });
  if (error) throw new Error(error.message);
  return data as WeekRecord[];
}

export async function deleteWeek(id: string): Promise<void> {
  const sb = await supabase();
  const { error } = await sb.from("weeks").delete().eq("id", id);
  if (error) throw new Error(friendly(error.message));
}

function friendly(message: string): string {
  if (/row-level security/i.test(message)) return "Saving needs Pro on this account.";
  return message;
}
