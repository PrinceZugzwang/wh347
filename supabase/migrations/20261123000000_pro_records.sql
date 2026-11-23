-- EasyWH347 Pro: saved weekly payrolls, kept by project.
--
-- Who can do what:
--   * Anyone signed in can read their own profile, projects and weeks.
--   * Only Pro accounts can add, change or delete projects and weeks.
--   * Nobody can make themselves Pro from the browser: profiles.pro_active is
--     set by the Stripe webhook (service role) or by hand in the dashboard.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  pro_active boolean not null default false,
  stripe_customer_id text unique,
  stripe_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Project number if there is one, otherwise the project name, lower-cased.
  project_key text not null,
  name text not null default '',
  number text not null default '',
  location text not null default '',
  contractor_name text not null default '',
  -- The most recently saved report header and wage rates, to start the next week from.
  header jsonb not null,
  rates_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, project_key)
);

create table if not exists public.weeks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  week_ending date not null,
  payroll_number text not null default '',
  is_final boolean not null default false,
  header jsonb not null,
  -- The typed form (worker IDs are only ever the last four digits). Null when the week came from an imported file.
  crew jsonb,
  rates_text text not null default '',
  -- The finished payroll, so the PDF and CSV can be produced again exactly as filed.
  payroll jsonb not null,
  workers integer not null default 0,
  gross_cents bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, week_ending)
);

create index if not exists weeks_user_project_idx on public.weeks (user_id, project_id, week_ending desc);

-- Every new sign-in gets a profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, email) values (new.id, new.email)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Profiles for anyone who signed up before this migration.
insert into public.profiles (user_id, email)
select id, email from auth.users
on conflict (user_id) do nothing;

create or replace function public.is_pro()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select pro_active from public.profiles where user_id = auth.uid()), false);
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects for each row execute function public.touch_updated_at();
drop trigger if exists weeks_touch on public.weeks;
create trigger weeks_touch before update on public.weeks for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.weeks enable row level security;

-- Profiles: read your own. No insert or update from the browser.
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select to authenticated using (user_id = auth.uid());

-- Projects
drop policy if exists "read own projects" on public.projects;
create policy "read own projects" on public.projects
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "pro adds projects" on public.projects;
create policy "pro adds projects" on public.projects
  for insert to authenticated with check (user_id = auth.uid() and public.is_pro());
drop policy if exists "pro changes projects" on public.projects;
create policy "pro changes projects" on public.projects
  for update to authenticated using (user_id = auth.uid() and public.is_pro()) with check (user_id = auth.uid());
drop policy if exists "pro deletes projects" on public.projects;
create policy "pro deletes projects" on public.projects
  for delete to authenticated using (user_id = auth.uid() and public.is_pro());

-- Weeks
drop policy if exists "read own weeks" on public.weeks;
create policy "read own weeks" on public.weeks
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "pro adds weeks" on public.weeks;
create policy "pro adds weeks" on public.weeks
  for insert to authenticated with check (
    user_id = auth.uid()
    and public.is_pro()
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );
drop policy if exists "pro changes weeks" on public.weeks;
create policy "pro changes weeks" on public.weeks
  for update to authenticated using (user_id = auth.uid() and public.is_pro()) with check (user_id = auth.uid());
drop policy if exists "pro deletes weeks" on public.weeks;
create policy "pro deletes weeks" on public.weeks
  for delete to authenticated using (user_id = auth.uid() and public.is_pro());
