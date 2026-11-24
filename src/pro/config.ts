/** Pro is switched on by the build environment; without these the site is the free form only. */
export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
export const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";
export const PRO_LINK = (import.meta.env.VITE_STRIPE_PRO_LINK as string | undefined) ?? "";
export const proConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
/** Stripe's customer portal: people sign in with their email to change their card, get receipts or cancel. */
export const MANAGE_URL = "https://billing.stripe.com/p/login/28E14n3IZ0jg1Ys4QEc7u00";
export const RECORDS_URL = `${import.meta.env.BASE_URL}records.html`;
