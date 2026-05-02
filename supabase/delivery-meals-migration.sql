-- ============================================================================
-- Delivery Meals Migration — أصناف أوامر التسليم
-- شغّل هذا الملف بعد delivery-orders-extras-migration.sql
--
-- يضيف جدولاً منفصلاً للأصناف الخاصة بأوامر التسليم — مستقل عن جدول `meals`
-- (الذي يخص الوجبات للمستفيدين/المرافقين). الفصل مقصود لأن أصناف التسليم
-- تختلف بطبيعتها (تجميعات للمراكز/المواقع) عن أصناف القوائم.
-- ============================================================================

create table if not exists public.delivery_meals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner')),
  is_snack boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  unique (name, meal_type, is_snack)
);

create index if not exists idx_delivery_meals_meal_type on public.delivery_meals(meal_type);
create index if not exists idx_delivery_meals_is_snack on public.delivery_meals(is_snack);

alter table public.delivery_meals enable row level security;

drop policy if exists "Authenticated users full access - delivery_meals" on public.delivery_meals;
create policy "Authenticated users full access - delivery_meals"
  on public.delivery_meals for all using (auth.role() = 'authenticated');
