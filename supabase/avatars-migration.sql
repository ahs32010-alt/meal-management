-- ============================================================================
-- Avatars Migration
-- Adds avatar_url column to app_users + creates public avatars storage bucket
-- ============================================================================

alter table public.app_users
  add column if not exists avatar_url text;

-- Create the public avatars bucket (public read so <img src=...> works directly)
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Storage policies — uploads happen server-side via service_role, so no policies
-- are needed for write. Public read is implicit because the bucket is public.
-- (If you ever need authenticated client-side uploads, add INSERT/UPDATE/DELETE
--  policies on storage.objects scoped by name LIKE 'avatars/' || auth.uid() || '%')
