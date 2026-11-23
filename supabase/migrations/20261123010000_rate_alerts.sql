-- Sign-ups from the rate pages: "Email me when these rates change".
-- Anyone can add a sign-up; nobody can read them from the browser.
create table if not exists public.rate_alerts (
  id uuid primary key default gen_random_uuid(),
  email text not null check (char_length(email) between 3 and 254 and position('@' in email) > 1),
  trade text check (char_length(trade) <= 60),
  crew_size text check (char_length(crew_size) <= 20),
  wd text check (char_length(wd) <= 20),
  state text check (char_length(state) <= 2),
  county text check (char_length(county) <= 80),
  page text check (char_length(page) <= 200),
  created_at timestamptz not null default now()
);

alter table public.rate_alerts enable row level security;

drop policy if exists "anyone can sign up for rate alerts" on public.rate_alerts;
create policy "anyone can sign up for rate alerts" on public.rate_alerts
  for insert to anon, authenticated with check (true);

grant insert on public.rate_alerts to anon, authenticated;
