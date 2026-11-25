-- Self-serve Pro: a payment made before the buyer has an account (or with a
-- different email) is kept here and applied when that email signs in.

create table if not exists public.pending_pro (
  email text primary key,
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now()
);

alter table public.pending_pro enable row level security;
-- No policies: only the service role (the Stripe webhook) reads or writes it.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pending public.pending_pro;
begin
  select * into pending from public.pending_pro where email = lower(new.email);
  insert into public.profiles (user_id, email, pro_active, stripe_customer_id, stripe_subscription_id)
  values (new.id, new.email, pending.email is not null, pending.stripe_customer_id, pending.stripe_subscription_id)
  on conflict (user_id) do nothing;
  if pending.email is not null then
    delete from public.pending_pro where email = pending.email;
  end if;
  return new;
end;
$$;
