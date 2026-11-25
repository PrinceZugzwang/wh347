// Turns Pro on and off from Stripe events, with no one in the loop.
//
// Deploy (dashboard: Edge Functions > Deploy a new function > Via editor,
// name "stripe-webhook", paste this file, and turn OFF "Verify JWT"):
//   supabase functions deploy stripe-webhook --no-verify-jwt
//   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
// In Stripe: Developers > Webhooks > Add endpoint
//   https://<project-ref>.supabase.co/functions/v1/stripe-webhook
// events: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted
//
// Only the webhook signing secret is needed: every fact used here is in the
// signed event itself, so no Stripe API key is stored.
//
// Matching a payment to an account, in order:
//   1. client_reference_id (the site adds the signed-in user's id to the link)
//   2. the email entered at checkout, against the account's sign-in email
//   3. neither: kept in pending_pro and applied when that email first signs in

import { createClient } from "npm:@supabase/supabase-js@2";

const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

const ACTIVE = new Set(["active", "trialing", "past_due"]);
const TOLERANCE_SECONDS = 300;

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Stripe's signature scheme: HMAC-SHA256 of "<t>.<body>" with the endpoint secret. */
async function verify(body: string, header: string): Promise<boolean> {
  const parts = Object.groupBy(
    header.split(",").map((p) => p.split("=", 2) as [string, string]),
    ([k]) => k,
  );
  const t = parts.t?.[0]?.[1];
  const sigs = (parts.v1 ?? []).map(([, v]) => v);
  if (!t || sigs.length === 0 || !webhookSecret) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > TOLERANCE_SECONDS) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)));
  return sigs.some((s) => safeEqual(s, expected));
}

const idOf = (v: unknown): string | null =>
  typeof v === "string" ? v : v && typeof v === "object" && "id" in v ? String((v as { id: unknown }).id) : null;

async function activate(session: Record<string, any>): Promise<string> {
  const customer = idOf(session.customer);
  const subscription = idOf(session.subscription);
  const fields = { pro_active: true, stripe_customer_id: customer, stripe_subscription_id: subscription };

  const userId: string | null = session.client_reference_id ?? null;
  if (userId) {
    const { data, error } = await admin.from("profiles").update(fields).eq("user_id", userId).select("user_id");
    if (error) throw error;
    if (data?.length) return `pro on for user ${userId}`;
  }

  const email = String(session.customer_details?.email ?? session.customer_email ?? "").trim().toLowerCase();
  if (!email) return "no account and no email on the checkout";
  const { data, error } = await admin.from("profiles").update(fields).eq("email", email).select("user_id");
  if (error) throw error;
  if (data?.length) return `pro on for ${email}`;

  const { error: pendingError } = await admin
    .from("pending_pro")
    .upsert({ email, stripe_customer_id: customer, stripe_subscription_id: subscription });
  if (pendingError) throw pendingError;
  return `pro waiting for ${email} to sign in`;
}

async function sync(sub: Record<string, any>, deleted: boolean): Promise<string> {
  const customer = idOf(sub.customer);
  if (!customer) return "no customer";
  const active = !deleted && ACTIVE.has(sub.status);
  const { error } = await admin
    .from("profiles")
    .update({ pro_active: active, stripe_subscription_id: sub.id })
    .eq("stripe_customer_id", customer);
  if (error) throw error;
  if (!active) await admin.from("pending_pro").delete().eq("stripe_customer_id", customer);
  return `pro ${active ? "on" : "off"} for customer ${customer}`;
}

Deno.serve(async (req) => {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature") ?? "";
  if (!(await verify(body, signature))) return new Response("bad signature", { status: 400 });

  const event = JSON.parse(body);
  try {
    let result = `ignored ${event.type}`;
    if (event.type === "checkout.session.completed") result = await activate(event.data.object);
    if (event.type === "customer.subscription.updated") result = await sync(event.data.object, false);
    if (event.type === "customer.subscription.deleted") result = await sync(event.data.object, true);
    console.log(event.id, result);
    return new Response(result, { status: 200 });
  } catch (err) {
    console.error(event.id, err);
    return new Response(err instanceof Error ? err.message : String(err), { status: 500 });
  }
});
