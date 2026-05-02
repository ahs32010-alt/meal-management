-- ============================================================================
-- Delivery Orders Migration — أوامر التسليم
-- شغّل هذا الملف في Supabase SQL Editor
--
-- يضيف:
--   1) جدول المدن (cities)
--   2) جدول مواقع التسليم (delivery_locations) — مرتبط بالمدينة
--   3) جدول أوامر التسليم (delivery_orders) — يحتوي على بيانات الأمر الرئيسية
--      مع رقم تسلسلي تلقائي بصيغة DEL-{YYYY}-{NNNN}
--   4) جدول بنود أمر التسليم (delivery_order_items) — الأصناف وأعدادها
--   5) Storage bucket عام للتواقيع (signatures) — توقيع المنشئ + توقيع المستلم
--   6) RLS policies + indexes
-- ============================================================================

-- 1) جدول المدن
create table if not exists public.cities (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default timezone('utc', now())
);

-- 2) جدول مواقع التسليم
create table if not exists public.delivery_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city_id uuid references public.cities(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (name, city_id)
);

create index if not exists idx_delivery_locations_city on public.delivery_locations(city_id);

-- 3) جدول أوامر التسليم
-- Sequence للترقيم التلقائي
create sequence if not exists public.delivery_orders_seq;

create table if not exists public.delivery_orders (
  id uuid primary key default gen_random_uuid(),
  -- رقم الأمر التلقائي بصيغة DEL-{YYYY}-{NNNN}
  order_number text not null unique
    default ('DEL-' || extract(year from now())::text || '-' ||
            lpad(nextval('public.delivery_orders_seq')::text, 4, '0')),
  -- الربط الاختياري بأمر التشغيل المصدر (لو تم الإنشاء عبر "جلب من أمر تشغيل")
  source_order_id uuid references public.daily_orders(id) on delete set null,
  -- بيانات الأمر
  date date not null,
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner')),
  delivery_location_id uuid references public.delivery_locations(id) on delete set null,
  -- بيانات منشئ الأمر (يدوية كما طلب المستخدم)
  created_by_name text,
  created_by_phone text,
  delivery_date date,
  delivery_time time,
  -- الملاحظات
  notes text,
  -- التواقيع — رابط لصورة في storage bucket signatures (اختياري)
  creator_signature_url text,
  receiver_signature_url text,
  -- timestamps
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_delivery_orders_date on public.delivery_orders(date);
create index if not exists idx_delivery_orders_meal_type on public.delivery_orders(meal_type);
create index if not exists idx_delivery_orders_location on public.delivery_orders(delivery_location_id);
create index if not exists idx_delivery_orders_source on public.delivery_orders(source_order_id);

-- 4) جدول بنود أمر التسليم
create table if not exists public.delivery_order_items (
  id uuid primary key default gen_random_uuid(),
  delivery_order_id uuid not null references public.delivery_orders(id) on delete cascade,
  -- اسم الصنف كما يُكتب في الأمر (نسخة منفصلة لئلا يتأثر التسليم بأي تعديل لاحق على الصنف)
  display_name text not null,
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner')),
  quantity integer not null default 0 check (quantity >= 0),
  -- توقيع الاستلام لكل صنف (اختياري — رابط صورة)
  receiver_signature_url text,
  position smallint not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_delivery_order_items_order on public.delivery_order_items(delivery_order_id);

-- 5) Trigger لتحديث updated_at تلقائياً
create or replace function public.delivery_orders_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_delivery_orders_updated_at on public.delivery_orders;
create trigger trg_delivery_orders_updated_at
  before update on public.delivery_orders
  for each row execute function public.delivery_orders_set_updated_at();

-- 6) RLS
alter table public.cities enable row level security;
alter table public.delivery_locations enable row level security;
alter table public.delivery_orders enable row level security;
alter table public.delivery_order_items enable row level security;

drop policy if exists "Authenticated users full access - cities" on public.cities;
create policy "Authenticated users full access - cities"
  on public.cities for all using (auth.role() = 'authenticated');

drop policy if exists "Authenticated users full access - delivery_locations" on public.delivery_locations;
create policy "Authenticated users full access - delivery_locations"
  on public.delivery_locations for all using (auth.role() = 'authenticated');

drop policy if exists "Authenticated users full access - delivery_orders" on public.delivery_orders;
create policy "Authenticated users full access - delivery_orders"
  on public.delivery_orders for all using (auth.role() = 'authenticated');

drop policy if exists "Authenticated users full access - delivery_order_items" on public.delivery_order_items;
create policy "Authenticated users full access - delivery_order_items"
  on public.delivery_order_items for all using (auth.role() = 'authenticated');

-- 7) Storage bucket للتواقيع — public read (الوصول للصور مباشرة من الطباعة)
insert into storage.buckets (id, name, public)
values ('signatures', 'signatures', true)
on conflict (id) do nothing;

-- ملاحظة: رفع التواقيع يتم من جهة العميل عبر الـAuthenticated user، فنحتاج policies على storage.objects
drop policy if exists "Authenticated users can upload signatures" on storage.objects;
create policy "Authenticated users can upload signatures"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'signatures');

drop policy if exists "Authenticated users can read signatures" on storage.objects;
create policy "Authenticated users can read signatures"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'signatures');

drop policy if exists "Authenticated users can delete signatures" on storage.objects;
create policy "Authenticated users can delete signatures"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'signatures');
