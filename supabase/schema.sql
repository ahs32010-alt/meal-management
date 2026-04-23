-- ============================================================
-- نظام إدارة الوجبات — قاعدة البيانات
-- شغّل هذا الملف في Supabase SQL Editor
-- ============================================================

-- 1. جدول المستفيدين
create table if not exists beneficiaries (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  code text not null unique,
  category text not null,
  created_at timestamp with time zone default timezone('utc', now()) not null
);

-- 2. جدول الأصناف
create table if not exists meals (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  type text not null check (type in ('breakfast', 'lunch', 'dinner')),
  is_alternative boolean not null default false,
  created_at timestamp with time zone default timezone('utc', now()) not null
);

-- 3. جدول البدائل (ربط صنف رئيسي بأصناف بديلة)
create table if not exists meal_alternatives (
  id uuid default gen_random_uuid() primary key,
  meal_id uuid not null references meals(id) on delete cascade,
  alternative_id uuid not null references meals(id) on delete cascade,
  unique(meal_id, alternative_id),
  check (meal_id != alternative_id)
);

-- 4. جدول الممنوعات (أصناف ممنوعة لمستفيد معين)
create table if not exists exclusions (
  id uuid default gen_random_uuid() primary key,
  beneficiary_id uuid not null references beneficiaries(id) on delete cascade,
  meal_id uuid not null references meals(id) on delete cascade,
  unique(beneficiary_id, meal_id)
);

-- 5. جدول أوامر التشغيل اليومية
create table if not exists daily_orders (
  id uuid default gen_random_uuid() primary key,
  date date not null,
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner')),
  created_at timestamp with time zone default timezone('utc', now()) not null,
  unique(date, meal_type)
);

-- 6. جدول عناصر الأمر
create table if not exists order_items (
  id uuid default gen_random_uuid() primary key,
  order_id uuid not null references daily_orders(id) on delete cascade,
  meal_id uuid not null references meals(id) on delete cascade,
  unique(order_id, meal_id)
);

-- ============================================================
-- Row Level Security (RLS)
-- تفعيل الأمان على مستوى الصفوف
-- ============================================================

alter table beneficiaries enable row level security;
alter table meals enable row level security;
alter table meal_alternatives enable row level security;
alter table exclusions enable row level security;
alter table daily_orders enable row level security;
alter table order_items enable row level security;

-- السماح للمستخدمين المسجلين بالوصول الكامل
create policy "Authenticated users full access - beneficiaries"
  on beneficiaries for all using (auth.role() = 'authenticated');

create policy "Authenticated users full access - meals"
  on meals for all using (auth.role() = 'authenticated');

create policy "Authenticated users full access - meal_alternatives"
  on meal_alternatives for all using (auth.role() = 'authenticated');

create policy "Authenticated users full access - exclusions"
  on exclusions for all using (auth.role() = 'authenticated');

create policy "Authenticated users full access - daily_orders"
  on daily_orders for all using (auth.role() = 'authenticated');

create policy "Authenticated users full access - order_items"
  on order_items for all using (auth.role() = 'authenticated');

-- ============================================================
-- Indexes للأداء
-- ============================================================

create index if not exists idx_exclusions_beneficiary on exclusions(beneficiary_id);
create index if not exists idx_exclusions_meal on exclusions(meal_id);
create index if not exists idx_meal_alternatives_meal on meal_alternatives(meal_id);
create index if not exists idx_order_items_order on order_items(order_id);
create index if not exists idx_daily_orders_date on daily_orders(date);
create index if not exists idx_meals_type on meals(type);
