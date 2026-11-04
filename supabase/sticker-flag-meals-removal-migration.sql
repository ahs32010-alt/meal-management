-- ============================================================================
-- Sticker Flag Meals — إزالة ربط خيارات ستيكر الغداء والعشاء بالأصناف
--
-- يلغي sticker-flag-meals-migration.sql بالكامل: خيارات الستيكر (لا يفضل السمك /
-- المكرونة / الساندويش) ترجع يدوية — تُحط وتُشال من نافذة المستفيد فقط، وما
-- تتغيّر من المحظورات. العلامات الموجودة الحين على المستفيدين تبقى كما هي.
--
-- ⚠️ آمن للتشغيل أكثر من مرة. شغّله مرة واحدة في Supabase SQL Editor.
-- ============================================================================

-- ① الـtriggers أولاً (قبل حذف الجدول — حذف القائمة مع الـtrigger يطفي العلامات)
drop trigger if exists exclusions_sticker_flags_ins on public.exclusions;
drop trigger if exists exclusions_sticker_flags_del on public.exclusions;
drop trigger if exists exclusions_sticker_flags_upd on public.exclusions;
do $$
begin
  if to_regclass('public.sticker_flag_meals') is not null then
    drop trigger if exists sticker_flag_meals_sync_ins on public.sticker_flag_meals;
    drop trigger if exists sticker_flag_meals_sync_del on public.sticker_flag_meals;
    drop trigger if exists sticker_flag_meals_sync_upd on public.sticker_flag_meals;
  end if;
end $$;

drop function if exists public.trg_exclusions_sticker_flags();
drop function if exists public.trg_sticker_flag_meals_sync();
drop function if exists public.sync_sticker_flags(uuid[], text[]);

-- ② الجدول
drop table if exists public.sticker_flag_meals;

-- ③ النسخ الاحتياطي — نفس قائمة diet-fixed-meals-migration.sql
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
    'delivery_order_items'
  ]::text[];
$$;

revoke all on function public.backup_logical_tables() from public;
grant execute on function public.backup_logical_tables() to authenticated, postgres;
