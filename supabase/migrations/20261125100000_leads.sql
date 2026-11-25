-- Requests from the site (done-for-you sign-ups). Anyone can add one; nobody
-- can read them through the public key. Read them in the dashboard.
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('done_for_you', 'pro_question')),
  email text not null check (char_length(email) between 3 and 200 and email like '%@%'),
  phone text check (phone is null or char_length(phone) <= 40),
  files_in text check (files_in is null or char_length(files_in) <= 20),
  source text check (source is null or char_length(source) <= 200)
);

alter table public.leads enable row level security;

drop policy if exists "anyone can add a lead" on public.leads;
create policy "anyone can add a lead" on public.leads
  for insert to anon, authenticated
  with check (true);
