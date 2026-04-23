-- ============================================================
-- Migration v2
-- شغّل هذا في Supabase SQL Editor
-- ============================================================

-- 1. أعمدة جديدة على beneficiaries (إن لم تكن موجودة)
alter table beneficiaries add column if not exists villa text;
alter table beneficiaries add column if not exists diet_type text;
alter table beneficiaries add column if not exists fixed_items text;
alter table beneficiaries add column if not exists notes text;
alter table beneficiaries add column if not exists english_name text;

-- 2. أعمدة جديدة على meals
alter table meals add column if not exists is_snack boolean not null default false;
alter table meals add column if not exists english_name text;

-- 3. عمود البديل المحدد على exclusions
alter table exclusions add column if not exists alternative_meal_id uuid references meals(id) on delete set null;

-- 4. جدول الأصناف الثابتة الأسبوعية
create table if not exists beneficiary_fixed_meals (
  id uuid primary key default gen_random_uuid(),
  beneficiary_id uuid references beneficiaries(id) on delete cascade not null,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  meal_type text not null,
  meal_id uuid references meals(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique(beneficiary_id, day_of_week, meal_type, meal_id)
);

alter table beneficiary_fixed_meals enable row level security;

drop policy if exists "Authenticated users full access - beneficiary_fixed_meals" on beneficiary_fixed_meals;
create policy "Authenticated users full access - beneficiary_fixed_meals"
  on beneficiary_fixed_meals for all
  using (auth.role() = 'authenticated');

-- 5. Indexes
create index if not exists idx_meals_snack on meals(is_snack);
create index if not exists idx_fixed_meals_ben on beneficiary_fixed_meals(beneficiary_id);
create index if not exists idx_exclusions_alt on exclusions(alternative_meal_id);

-- 6. حذف جدول meal_alternatives القديم
drop table if exists meal_alternatives;

-- 7. أعمدة الاسم المخصص والكمية الإضافية على order_items
alter table order_items add column if not exists display_name text;
alter table order_items add column if not exists extra_quantity integer not null default 0;

-- 9. جدول فصل الستيكرات
create table if not exists sticker_splits (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references daily_orders(id) on delete cascade not null,
  beneficiary_id uuid references beneficiaries(id) on delete cascade not null,
  split_meal_ids text[] not null default '{}',
  created_at timestamptz default now(),
  unique(order_id, beneficiary_id)
);
alter table sticker_splits enable row level security;
drop policy if exists "auth_all_sticker_splits" on sticker_splits;
create policy "auth_all_sticker_splits"
  on sticker_splits for all
  using (auth.role() = 'authenticated');

-- 8. جدول الترجمة الحرفية المخصصة
create table if not exists custom_transliterations (
  id uuid primary key default gen_random_uuid(),
  word text not null unique,
  transliteration text not null,
  created_at timestamptz default now()
);
alter table custom_transliterations enable row level security;
drop policy if exists "auth_all_custom_transliterations" on custom_transliterations;
create policy "auth_all_custom_transliterations"
  on custom_transliterations for all
  using (auth.role() = 'authenticated');
