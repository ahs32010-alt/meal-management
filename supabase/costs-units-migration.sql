-- ============================================================================
-- Costs Units Migration — وحدات القياس كبيانات
-- شغّل هذا الملف بعد costs-migration.sql
--
-- كانت الوحدات قائمة ثابتة في الكود (kg/g/l/ml/pcs). صارت الآن جدولاً يضيف
-- فيه المستخدم وحداته (رطل، أوقية، كرتون، صاع…).
--
-- كل وحدة لها:
--   family — مجموعة التحويل. التحويل مسموح داخل المجموعة فقط، فما نحوّل
--            لتراً إلى كيلو بالغلط.
--   factor — كم وحدة أساسية من مجموعتها تساوي (كجم = 1000 جم).
--
-- الملف آمن للتشغيل أكثر من مرة، ويحافظ على المواد والوصفات الموجودة عبر
-- ترجمة الأكواد القديمة (kg/g/l/ml/pcs) إلى صفوف الجدول الجديد.
-- ============================================================================

-- ── 1. جدول الوحدات ─────────────────────────────────────────────────────────
create table if not exists public.cost_units (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  family text not null,
  -- 8 خانات عشرية: تكفي وحدات مثل الأوقية (28.34952312 جم) بدقة كاملة
  factor numeric(20, 8) not null check (factor > 0),
  is_builtin boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists idx_cost_units_name on public.cost_units(lower(trim(name)));
create index if not exists idx_cost_units_family on public.cost_units(family);

-- الوحدات المدمجة — أساس كل مجموعة معامله 1
insert into public.cost_units (name, family, factor, is_builtin)
select v.name, v.family, v.factor, true
from (values
  ('جم',   'weight', 1::numeric),
  ('كجم',  'weight', 1000::numeric),
  ('مل',   'volume', 1::numeric),
  ('لتر',  'volume', 1000::numeric),
  ('حبة',  'count',  1::numeric)
) as v(name, family, factor)
where not exists (
  select 1 from public.cost_units u where lower(trim(u.name)) = lower(trim(v.name))
);

drop trigger if exists cost_units_touch_updated_at on public.cost_units;
create trigger cost_units_touch_updated_at
  before update on public.cost_units
  for each row execute function public.costs_touch_updated_at();

-- ── 2. ربط المواد الأولية بالوحدات ──────────────────────────────────────────
alter table public.raw_materials
  add column if not exists unit_id uuid references public.cost_units(id) on delete restrict;

-- ترجمة الأكواد القديمة → صفوف الجدول (تعمل فقط ما دام العمود القديم موجوداً)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'raw_materials' and column_name = 'unit'
  ) then
    update public.raw_materials m
    set unit_id = u.id
    from public.cost_units u
    where m.unit_id is null
      and u.name = case m.unit
        when 'kg'  then 'كجم'
        when 'g'   then 'جم'
        when 'l'   then 'لتر'
        when 'ml'  then 'مل'
        when 'pcs' then 'حبة'
      end;
  end if;
end $$;

-- أي صفّ بقي بلا وحدة (بيانات غريبة) نسنده لـ«حبة» بدل ما تفشل الترقية
update public.raw_materials
set unit_id = (select id from public.cost_units where name = 'حبة')
where unit_id is null;

alter table public.raw_materials alter column unit_id set not null;

-- العمود القديم لازم يروح: عنده not null + check، فلو بقي يمنع الإدراج
-- من الكود الجديد الذي ما يعرف عنه شيئاً.
alter table public.raw_materials drop column if exists unit;

-- ── 3. ربط أسطر الوصفات بالوحدات ────────────────────────────────────────────
alter table public.meal_recipe_items
  add column if not exists unit_id uuid references public.cost_units(id) on delete restrict;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'meal_recipe_items' and column_name = 'unit'
  ) then
    update public.meal_recipe_items r
    set unit_id = u.id
    from public.cost_units u
    where r.unit_id is null
      and u.name = case r.unit
        when 'kg'  then 'كجم'
        when 'g'   then 'جم'
        when 'l'   then 'لتر'
        when 'ml'  then 'مل'
        when 'pcs' then 'حبة'
      end;
  end if;
end $$;

-- سطر وصفة بلا وحدة صالحة يأخذ وحدة شراء مادته — أدقّ إسناد ممكن
update public.meal_recipe_items r
set unit_id = m.unit_id
from public.raw_materials m
where r.unit_id is null and r.raw_material_id = m.id;

alter table public.meal_recipe_items alter column unit_id set not null;
alter table public.meal_recipe_items drop column if exists unit;

-- ── 4. RLS ──────────────────────────────────────────────────────────────────
alter table public.cost_units enable row level security;

drop policy if exists "Authenticated users full access - cost_units" on public.cost_units;
create policy "Authenticated users full access - cost_units"
  on public.cost_units for all using (auth.role() = 'authenticated');
