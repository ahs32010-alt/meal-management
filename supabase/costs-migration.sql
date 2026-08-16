-- ============================================================================
-- Costs Migration — التكاليف
-- شغّل هذا الملف في Supabase SQL Editor
--
-- ثلاثة جداول:
--   1. raw_materials      — المواد الأولية وأسعار شرائها (كبدة، بصل، فلفل…)
--   2. meal_recipe_items  — مكوّنات الصنف: كمية كل مادة أولية *لحصة واحدة*
--   3. order_cost_snapshots — تجميد تكلفة أمر تشغيل بأسعار لحظة الاعتماد
--
-- قاعدة الحساب (انظر lib/costs.ts — نفس المعادلة بالضبط):
--   تكلفة السطر  = (الكمية محوَّلة لوحدة شراء المادة) × سعر وحدة المادة
--   تكلفة الحصة  = مجموع تكاليف أسطر الوصفة
--   تكلفة الأمر  = مجموع (تكلفة حصة الصنف × الكمية النهائية للصنف في الأمر)
-- ============================================================================

-- ── 1. المواد الأولية ───────────────────────────────────────────────────────
-- unit: وحدة الشراء التي يُسعَّر بها. الكميات في الوصفات تُدخل بأي وحدة من نفس
-- البُعد (وزن/حجم/عدد) ويحوّلها النظام — انظر convertQuantity في lib/costs.ts.
create table if not exists public.raw_materials (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text not null check (unit in ('kg', 'g', 'l', 'ml', 'pcs')),
  -- 4 خانات عشرية: لازمة للمواد الرخيصة المسعّرة بالجرام (مثلاً 0.0025 ريال/جم)
  unit_cost numeric(14, 4) not null default 0 check (unit_cost >= 0),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- اسم المادة فريد — يمنع تكرار "بصل" مرتين بسعرين مختلفين (مصدر أخطاء التكلفة)
create unique index if not exists idx_raw_materials_name on public.raw_materials(lower(trim(name)));
create index if not exists idx_raw_materials_active on public.raw_materials(is_active);

-- ── 2. مكوّنات الصنف (الوصفة) ───────────────────────────────────────────────
-- quantity = الكمية اللازمة *لحصة واحدة* من الصنف.
-- on delete restrict على المادة: لا نسمح بحذف مادة مستخدَمة في وصفة، لأن الحذف
-- يخفّض تكلفة الأصناف بصمت. الواجهة تعرض عدد الوصفات وتمنع الحذف برسالة واضحة.
create table if not exists public.meal_recipe_items (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid not null references public.meals(id) on delete cascade,
  raw_material_id uuid not null references public.raw_materials(id) on delete restrict,
  quantity numeric(14, 4) not null check (quantity > 0),
  unit text not null check (unit in ('kg', 'g', 'l', 'ml', 'pcs')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (meal_id, raw_material_id)
);

create index if not exists idx_meal_recipe_items_meal on public.meal_recipe_items(meal_id);
create index if not exists idx_meal_recipe_items_material on public.meal_recipe_items(raw_material_id);

-- ── 3. تجميد تكلفة أمر التشغيل ──────────────────────────────────────────────
-- عند الاعتماد نحفظ الإجمالي + تفصيل كامل (سعر كل مادة وقتها) في breakdown،
-- فتبقى تكلفة الأوامر القديمة ثابتة مهما تغيّرت الأسعار لاحقاً.
create table if not exists public.order_cost_snapshots (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.daily_orders(id) on delete cascade,
  total_cost numeric(16, 4) not null default 0 check (total_cost >= 0),
  breakdown jsonb not null default '{}'::jsonb,
  frozen_at timestamptz not null default timezone('utc', now()),
  frozen_by uuid,
  frozen_by_name text
);

create index if not exists idx_order_cost_snapshots_order on public.order_cost_snapshots(order_id);

-- ── updated_at تلقائياً ─────────────────────────────────────────────────────
create or replace function public.costs_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end $$;

drop trigger if exists raw_materials_touch_updated_at on public.raw_materials;
create trigger raw_materials_touch_updated_at
  before update on public.raw_materials
  for each row execute function public.costs_touch_updated_at();

drop trigger if exists meal_recipe_items_touch_updated_at on public.meal_recipe_items;
create trigger meal_recipe_items_touch_updated_at
  before update on public.meal_recipe_items
  for each row execute function public.costs_touch_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.raw_materials       enable row level security;
alter table public.meal_recipe_items   enable row level security;
alter table public.order_cost_snapshots enable row level security;

drop policy if exists "Authenticated users full access - raw_materials" on public.raw_materials;
create policy "Authenticated users full access - raw_materials"
  on public.raw_materials for all using (auth.role() = 'authenticated');

drop policy if exists "Authenticated users full access - meal_recipe_items" on public.meal_recipe_items;
create policy "Authenticated users full access - meal_recipe_items"
  on public.meal_recipe_items for all using (auth.role() = 'authenticated');

drop policy if exists "Authenticated users full access - order_cost_snapshots" on public.order_cost_snapshots;
create policy "Authenticated users full access - order_cost_snapshots"
  on public.order_cost_snapshots for all using (auth.role() = 'authenticated');
