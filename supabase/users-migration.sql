-- ============================================================================
-- Users Management Migration
-- Adds app_users table with per-page granular permissions
-- ============================================================================

create table if not exists public.app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  is_admin boolean not null default false,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_users_email_idx on public.app_users(email);

alter table public.app_users enable row level security;

-- Any authenticated user can read the users table (needed to read own row for permission checks)
drop policy if exists "Authenticated read app_users" on public.app_users;
create policy "Authenticated read app_users"
  on public.app_users for select
  using (auth.role() = 'authenticated');

-- Writes are blocked for regular clients — all writes must go through API routes using service_role key
drop policy if exists "Block direct writes" on public.app_users;
create policy "Block direct writes"
  on public.app_users for all
  using (false)
  with check (false);

-- Update timestamp trigger
create or replace function public.app_users_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists app_users_touch_updated_at on public.app_users;
create trigger app_users_touch_updated_at
  before update on public.app_users
  for each row execute function public.app_users_touch_updated_at();

-- Bootstrap: any existing auth user becomes admin so you don't get locked out
insert into public.app_users (id, email, full_name, is_admin, permissions)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data->>'full_name', u.email),
  true,
  '{}'::jsonb
from auth.users u
on conflict (id) do update set is_admin = true;
