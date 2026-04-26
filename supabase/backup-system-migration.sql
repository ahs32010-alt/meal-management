-- ============================================================================
-- Backup System Migration
-- يضيف جدول `backups` لتخزين نسخ احتياطية كاملة (JSONB) من بيانات النظام.
-- كل نسخة تحوي:
--   • snapshot: لقطة كاملة لكل الجداول المعنية وقت أخذ النسخة
--   • summary: عدّادات لكل جدول للعرض السريع بدون فك الـsnapshot
--   • metadata: نوع الترقير، المستخدم اللي شغّل النسخ، ملاحظات
--
-- ⚠️ ما يُحفظ في النسخة:
--   - بيانات المصادقة (auth.users)، المستخدمون والصلاحيات (app_users)،
--     سجل النشاط (activity_log)، جدول النسخ نفسه (backups)
-- ============================================================================

create table if not exists public.backups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  trigger_type text not null check (trigger_type in ('auto_daily', 'manual', 'pre_restore')),
  created_by_user_id uuid,
  created_by_user_email text,
  created_by_user_name text,
  snapshot jsonb not null,
  summary jsonb,
  notes text
);

create index if not exists idx_backups_created_at on public.backups (created_at desc);

alter table public.backups enable row level security;

drop policy if exists "Authenticated users full access - backups" on public.backups;
create policy "Authenticated users full access - backups"
  on public.backups for all
  using (auth.role() = 'authenticated');
