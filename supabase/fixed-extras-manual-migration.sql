-- ============================================================================
-- Fixed Extras Manual Migration — الأصناف المضافة يدوياً في «حصر الإضافات»
--
-- قائمة ثابتة (صنف + وجبة + عدد يومي + فترة من/إلى) تُجمع في كل حصر مع
-- الإضافات المحسوبة من المستفيدين: العدد × أيام الفترة الواقعة داخل الحصر.
-- تبقى محفوظة لكل المستخدمين حتى تُعدَّل أو تُحذف.
--
-- ⚠️ آمن للتشغيل أكثر من مرة. لا يمسّ أي بيانات موجودة.
-- شغّله مرة واحدة في Supabase SQL Editor.
-- ============================================================================

create table if not exists public.fixed_extras_manual (
  id         uuid primary key default gen_random_uuid(),
  meal_id    uuid not null references public.meals(id) on delete cascade,
  meal_type  text not null check (meal_type in ('breakfast', 'lunch', 'dinner')),
  -- العدد اليومي: يُحسب مرة لكل يوم يقع داخل الفترة
  quantity   integer not null check (quantity > 0),
  start_date date not null default current_date,
  -- null = مستمر بلا نهاية
  end_date   date,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint fixed_extras_manual_period check (end_date is null or end_date >= start_date)
);
create index if not exists fixed_extras_manual_period_idx on public.fixed_extras_manual (start_date, end_date);

alter table public.fixed_extras_manual enable row level security;
drop policy if exists "Authenticated users full access - fixed_extras_manual" on public.fixed_extras_manual;
create policy "Authenticated users full access - fixed_extras_manual"
  on public.fixed_extras_manual for all to authenticated using (true) with check (true);

-- النسخ الاحتياطي — نفس قائمة diet-systems-migration.sql + الجدول الجديد.
-- (الاستعادة تتخطّى أي جدول غير موجود، فلا يضر لو ترقية الأنظمة ما اتشغّلت)
create or replace function public.backup_logical_tables()
returns text[]
language sql
immutable
as $$
  select array[
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
    'diet_systems',
    -- تابعة لـ meals / beneficiaries / daily_orders
    'meal_alternatives',
    'diet_system_exclusions',
    'beneficiary_diets',
    'exclusions',
    'beneficiary_fixed_meals',
    'fixed_extras_manual',
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
    'delivery_order_items'
  ]::text[];
$$;

revoke all on function public.backup_logical_tables() from public;
grant execute on function public.backup_logical_tables() to authenticated, postgres;
