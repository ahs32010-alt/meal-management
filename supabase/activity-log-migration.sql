-- ============================================================================
-- Activity Log Migration
-- جدول لتسجيل كل إضافة/تعديل/حذف في صفحات المشروع مرتبط بالمستخدم
-- ============================================================================

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  user_email text,
  user_name text,
  action text not null check (action in ('create', 'update', 'delete')),
  entity_type text not null,
  entity_id text,
  entity_name text,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_log_created_at_idx on public.activity_log (created_at desc);
create index if not exists activity_log_user_id_idx on public.activity_log (user_id);
create index if not exists activity_log_entity_type_idx on public.activity_log (entity_type);
create index if not exists activity_log_action_idx on public.activity_log (action);

alter table public.activity_log enable row level security;

-- أي مستخدم مسجّل يستطيع قراءة السجل
drop policy if exists "Authenticated read activity_log" on public.activity_log;
create policy "Authenticated read activity_log"
  on public.activity_log for select
  using (auth.role() = 'authenticated');

-- المستخدم المسجّل يستطيع إضافة سجل بحسابه فقط (أو بدون user_id إذا لم يُحدد)
drop policy if exists "Authenticated insert own activity" on public.activity_log;
create policy "Authenticated insert own activity"
  on public.activity_log for insert
  with check (
    auth.role() = 'authenticated'
    and (user_id = auth.uid() or user_id is null)
  );

-- لا يمكن تعديل سجل (لضمان موثوقية التاريخ)
drop policy if exists "Block updates" on public.activity_log;
create policy "Block updates"
  on public.activity_log for update
  using (false)
  with check (false);

-- المدير فقط يستطيع حذف السجلات (لأي تنظيف)
drop policy if exists "Admin delete activity" on public.activity_log;
create policy "Admin delete activity"
  on public.activity_log for delete
  using (
    exists (
      select 1 from public.app_users
      where id = auth.uid() and is_admin = true
    )
  );
