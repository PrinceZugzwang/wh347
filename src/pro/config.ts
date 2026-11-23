/** Pro is switched on by the build environment; without these the site is the free form only. */
export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
export const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";
export const PRO_LINK = (import.meta.env.VITE_STRIPE_PRO_LINK as string | undefined) ?? "";
export const proConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const RECORDS_URL = `${import.meta.env.BASE_URL}records.html`;
