-- ============================================================================
-- Kitchen Sections Migration — «أقسام المطبخ»
--
-- تجميع تنظيمي للأصناف تحت أقسام يحددها المستخدم (طبخ / أرز / سلطات / حلى …)
-- عشان يتوزع الشغل والمشتريات على المسؤولين في المطبخ.
--
-- ⚠️ إضافة معزولة بالكامل:
--   • لا يغيّر جدول meals ولا أي عمود موجود.
--   • لا علاقة له بتصنيف (حار/بارد/سناك) — ذاك للستيكرات ويبقى كما هو.
--   • لا يقرأه أمر التشغيل ولا الستيكرات ولا التقارير الحالية.
--   • الربط في جدول مستقل: كل صنف في قسم واحد بالكثير.
--     حذف الصنف ← يُحذف ربطه تلقائياً. حذف القسم ← ترجع أصنافه «بدون قسم».
--
-- آمن للتشغيل أكثر من مرة. شغّله مرة واحدة في Supabase SQL Editor.
-- ============================================================================

create table if not exists public.kitchen_sections (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  color       text,
  sort_order  integer not null default 0,
  created_at  timestamptz default now()
);
create unique index if not exists kitchen_sections_name_uniq
  on public.kitchen_sections (lower(btrim(name)));

create table if not exists public.meal_kitchen_sections (
  meal_id     uuid primary key references public.meals(id) on delete cascade,
  section_id  uuid not null references public.kitchen_sections(id) on delete cascade,
  created_at  timestamptz default now()
);
create index if not exists meal_kitchen_sections_section_idx
  on public.meal_kitchen_sections (section_id);

-- الصلاحيات — نفس سياسة بقية الجداول
alter table public.kitchen_sections enable row level security;
alter table public.meal_kitchen_sections enable row level security;

drop policy if exists "Authenticated users full access - kitchen_sections" on public.kitchen_sections;
create policy "Authenticated users full access - kitchen_sections"
  on public.kitchen_sections for all to authenticated using (true) with check (true);

drop policy if exists "Authenticated users full access - meal_kitchen_sections" on public.meal_kitchen_sections;
create policy "Authenticated users full access - meal_kitchen_sections"
  on public.meal_kitchen_sections for all to authenticated using (true) with check (true);

-- أقسام مبدئية (تقدر تعدّلها أو تحذفها من صفحة الأصناف)
insert into public.kitchen_sections (name, color, sort_order)
select v.name, v.color, v.sort_order
  from (values
    ('طبخ',    '#EF4444', 1),
    ('أرز',    '#F59E0B', 2),
    ('سلطات',  '#22C55E', 3),
    ('حلى',    '#EC4899', 4)
  ) as v(name, color, sort_order)
 where not exists (select 1 from public.kitchen_sections);

-- النسخ الاحتياطي — نفس قائمة sticker-flag-meals-removal-migration.sql + الجدولين
-- الجديدين في آخرها (الاستعادة تُدرج بالترتيب وتمسح بعكسه، فيأتي الربط بعد
-- meals و kitchen_sections). الاستعادة تتخطى أي جدول غائب عن نسخة قديمة.
create or replace function public.backup_logical_tables()
returns text[]
language sql
immutable
as $$
  select array[
    -- جداول مستقلة
    'meals',
    'beneficiaries',
    'daily_orders',
    'custom_transliterations',
    'lunch_dinner_diet_colors',
    'cost_units',
    'cities',
    'delivery_meals',
    'delivery_creators',
    'delivery_print_header',
    'sticker_settings',
    'diet_systems',
    -- تابعة لـ meals / beneficiaries / daily_orders
    'meal_alternatives',
    'diet_system_exclusions',
    'diet_system_fixed_meals',
    'beneficiary_diets',
    'exclusions',
    'beneficiary_fixed_meals',
    'fixed_extras_manual',
    'beneficiary_menu_overrides',
    'menu_items',
    'order_items',
    'sticker_splits',
    -- منظومة التكاليف
    'raw_materials',
    'meal_recipe_items',
    'meal_pricing',
    'order_cost_snapshots',
    -- منظومة أوامر التسليم
    'delivery_locations',
    'delivery_orders',
    'delivery_order_items',
    -- أقسام المطبخ (تجميع تنظيمي للأصناف)
    'kitchen_sections',
    'meal_kitchen_sections'
  ]::text[];
$$;

revoke all on function public.backup_logical_tables() from public;
grant execute on function public.backup_logical_tables() to authenticated, postgres;
