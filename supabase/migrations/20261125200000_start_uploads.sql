-- Done-for-you sign-ups from start.html: company and uploaded payroll files.
alter table public.leads add column if not exists company text check (company is null or char_length(company) <= 200);
alter table public.leads add column if not exists file_paths text[];

-- Private bucket: anyone can add a file, nobody can list or read through the public key.
insert into storage.buckets (id, name, public, file_size_limit)
values ('payroll-uploads', 'payroll-uploads', false, 20971520)
on conflict (id) do nothing;

drop policy if exists "anyone can upload payroll" on storage.objects;
create policy "anyone can upload payroll" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'payroll-uploads');
