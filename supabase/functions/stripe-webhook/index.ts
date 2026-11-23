// Turns Pro on and off from Stripe events.
//
// Deploy:
//   supabase functions deploy stripe-webhook --no-verify-jwt
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_...
// Then in Stripe, add a webhook endpoint to
//   https://<project-ref>.supabase.co/functions/v1/stripe-webhook
// for: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted
//
// The Pro payment link is opened with ?client_reference_id=<Supabase user id>,
// which is how a checkout is matched to an account.

import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "");
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

const ACTIVE = new Set(["active", "trialing", "past_due"]);

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("missing signature", { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      await req.text(),
      signature,
      webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch (err) {
    return new Response(`bad signature: ${err instanceof Error ? err.message : String(err)}`, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.client_reference_id;
    if (!userId) return new Response("no client_reference_id; activate by hand", { status: 200 });
    const { error } = await admin
      .from("profiles")
      .update({
        pro_active: true,
        stripe_customer_id: typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null),
        stripe_subscription_id: typeof session.subscription === "string" ? session.subscription : (session.subscription?.id ?? null),
      })
      .eq("user_id", userId);
    if (error) return new Response(error.message, { status: 500 });
  }

  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    const active = event.type === "customer.subscription.updated" && ACTIVE.has(sub.status);
    const { error } = await admin
      .from("profiles")
      .update({ pro_active: active, stripe_subscription_id: sub.id })
      .eq("stripe_customer_id", customer);
    if (error) return new Response(error.message, { status: 500 });
  }

  return new Response("ok", { status: 200 });
});
