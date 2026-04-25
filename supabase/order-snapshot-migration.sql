-- ============================================================================
-- Order Snapshot Migration
-- يضيف صورة (snapshot) لكل أمر تشغيل تحفظ الإحصاءات وقت الإنشاء
-- بحيث لا تتغير الأرقام لو تغيّر المستفيدون أو الاستثناءات لاحقاً
-- ============================================================================

alter table public.daily_orders
  add column if not exists snapshot jsonb,
  add column if not exists snapshot_at timestamptz;

create index if not exists daily_orders_snapshot_at_idx on public.daily_orders (snapshot_at);
