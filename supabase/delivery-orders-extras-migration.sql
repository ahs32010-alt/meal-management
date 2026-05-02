-- ============================================================================
-- Delivery Orders — Extras Migration
-- شغّل هذا الملف بعد delivery-orders-migration.sql
--
-- يضيف:
--   1) جدول الأشخاص المنشئين (delivery_creators) مع dropdown قابل لإعادة الاستخدام
--   2) عمود creator_id في delivery_orders (اختياري)
--   3) توسيع check constraint لـmeal_type ليقبل 'all' (الثلاث وجبات)
--      على مستوى delivery_orders و delivery_order_items فقط — لا يلمس daily_orders
-- ============================================================================

-- 1) جدول الأشخاص (المنشئين)
create table if not exists public.delivery_creators (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (name, phone)
);

create index if not exists idx_delivery_creators_name on public.delivery_creators(name);

alter table public.delivery_creators enable row level security;
drop policy if exists "Authenticated users full access - delivery_creators" on public.delivery_creators;
create policy "Authenticated users full access - delivery_creators"
  on public.delivery_creators for all using (auth.role() = 'authenticated');

-- 2) ربط أمر التسليم بالشخص المنشئ
alter table public.delivery_orders
  add column if not exists creator_id uuid references public.delivery_creators(id) on delete set null;

create index if not exists idx_delivery_orders_creator on public.delivery_orders(creator_id);

-- 3) توسيع check constraint لقبول 'all' (الثلاث وجبات)
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'delivery_orders_meal_type_check'
      and conrelid = 'public.delivery_orders'::regclass
  ) then
    alter table public.delivery_orders drop constraint delivery_orders_meal_type_check;
  end if;
end$$;

alter table public.delivery_orders
  add constraint delivery_orders_meal_type_check
  check (meal_type in ('breakfast', 'lunch', 'dinner', 'all'));

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'delivery_order_items_meal_type_check'
      and conrelid = 'public.delivery_order_items'::regclass
  ) then
    alter table public.delivery_order_items drop constraint delivery_order_items_meal_type_check;
  end if;
end$$;

alter table public.delivery_order_items
  add constraint delivery_order_items_meal_type_check
  check (meal_type in ('breakfast', 'lunch', 'dinner', 'all'));
