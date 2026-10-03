-- ============================================================================
-- Backup Coverage — beneficiary_menu_overrides
--
-- المشكلة: آخر تعريف لـ backup_logical_tables() (في diet-systems-migration.sql
-- و fixed-extras-manual-migration.sql) لا يشمل جدول beneficiary_menu_overrides
-- (قرارات «استبدال/حذف/إضافة» في منيو المستفيد). النتيجة:
--   • النسخ التلقائية (pg_cron → create_daily_backup) لا تحفظه إطلاقاً.
--   • الاستعادة الذرّية (restore_backup_snapshot) تمسح meals و beneficiaries،
--     فتُحذف كل صفوفه بالـcascade، ثم لا تُعيدها لأنه خارج القائمة → فقدان دائم.
--
-- الحل: نفس القائمة + beneficiary_menu_overrides بعد fixed_extras_manual —
-- مطابقة حرفياً لـ BACKUP_TABLES في lib/backup-snapshot.ts (اختبار
-- tests/backup-coverage.test.ts يتحقق من التطابق).
--
-- ⚠️ لا يمسّ أي بيانات — يعيد تعريف دالة القائمة فقط، فتلتقطها تلقائياً
-- create_daily_backup() و restore_backup_snapshot().
-- شغّله مرة واحدة في Supabase SQL Editor — وبعد أي إعادة تشغيل لـ
-- diet-systems-migration.sql أو fixed-extras-manual-migration.sql (لأنهما
-- يعيدان تعريف القائمة بدون هذا الجدول).
-- ============================================================================

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
