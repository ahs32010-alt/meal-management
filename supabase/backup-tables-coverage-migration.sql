-- ============================================================================
-- Backup Tables Coverage Migration
--
-- المشكلة: النسخة المنطقية (snapshot) — وهي التي تُستخدم في الاستعادة — كانت
-- مبنية على قائمة جداول مكتوبة يدوياً داخل create_daily_backup()، وتغطّي ١٠
-- جداول فقط. كانت تنقصها:
--     • منظومة أوامر التسليم كاملة (٧ جداول)
--     • منظومة التكاليف كاملة (cost_units, raw_materials, meal_recipe_items,
--       meal_pricing, order_cost_snapshots)
--     • lunch_dinner_diet_colors (ألوان الأنظمة الغذائية للستيكرات)
-- أي استعادة من نسخة كهذه تمسح الموجود ولا تُرجع هذه الجداول → فقدان دائم.
--
-- الحل: قائمة الجداول صارت في دالة واحدة `backup_logical_tables()`، و
-- `create_daily_backup()` يبني اللقطة بالدوران عليها ديناميكياً — فلا تعود
-- القائمة تتخلّف عن الجداول الجديدة، ولا تحتاج تكرار الكود لكل جدول.
--
-- ⚠️ هذا الملف لا يمسّ أي بيانات إطلاقاً — يُعيد تعريف دوال فقط.
-- يعتمد على: backup-system-migration.sql + backup-auto-schedule-migration.sql
--            + backup-full-db-migration.sql
-- شغّله مرة واحدة في Supabase SQL Editor.
-- ============================================================================

-- ─── 1) مصدر واحد لقائمة جداول النسخة المنطقية ──────────────────────────────
-- الترتيب يحترم المفاتيح الخارجية (المرجعي قبل التابع) — نفس ترتيب
-- BACKUP_TABLES في lib/backup-snapshot.ts بالضبط. الاستعادة تمشي بهذا الترتيب
-- للإدراج وبعكسه للمسح.
--
-- غير مشمول عمداً: backups (تفادي التعشيش)، app_users و activity_log
-- (المستخدمون والصلاحيات والسجل لا تتأثر بالاستعادة)، pending_actions
-- (طابور موافقات لحظي — استعادته تُحيي طلبات قديمة).

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
    -- تابعة لـ meals / beneficiaries / daily_orders
    'meal_alternatives',
    'exclusions',
    'beneficiary_fixed_meals',
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

-- ─── 2) create_daily_backup() — بناء اللقطة ديناميكياً ──────────────────────

create or replace function public.create_daily_backup()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tables     text[] := public.backup_logical_tables();
  v_table      text;
  v_rows       jsonb;
  v_count      int;
  v_tabledata  jsonb := '{}'::jsonb;
  v_counts     jsonb := '{}'::jsonb;
  v_total      int   := 0;
  v_snapshot   jsonb;
  v_full       jsonb;
  v_has_full   boolean;
begin
  foreach v_table in array v_tables loop
    begin
      execute format(
        'select coalesce(jsonb_agg(to_jsonb(t.*)), ''[]''::jsonb), count(*) from public.%I t',
        v_table
      ) into v_rows, v_count;
    exception when undefined_table then
      -- جدول ترقيته ما اتشغّلت بعد — نسجّله صفراً ونكمّل بدل ما تفشل النسخة كلها
      v_rows := '[]'::jsonb; v_count := 0;
    when others then
      v_rows := '[]'::jsonb; v_count := 0;
    end;

    v_tabledata := v_tabledata || jsonb_build_object(v_table, v_rows);
    v_counts    := v_counts    || jsonb_build_object(v_table, v_count);
    v_total     := v_total + v_count;
  end loop;

  v_snapshot := jsonb_build_object(
    'version',  1,
    'taken_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'tables',   v_tabledata
  );

  -- لقطة DB كاملة (راو) — شبكة أمان فوق النسخة المنطقية
  begin
    v_full := public.dump_all_public_tables();
  exception when others then
    v_full := null;
  end;

  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'backups' and column_name = 'full_snapshot'
  ) into v_has_full;

  if v_has_full then
    insert into public.backups (trigger_type, snapshot, full_snapshot, summary, notes)
    values (
      'auto_daily', v_snapshot, v_full,
      jsonb_build_object('counts', v_counts, 'total_rows', v_total),
      'تم إنشاؤها آلياً عبر pg_cron الساعة ' ||
        to_char(now() at time zone 'Asia/Riyadh', 'HH24:MI') || ' توقيت السعودية'
    );
  else
    insert into public.backups (trigger_type, snapshot, summary, notes)
    values (
      'auto_daily', v_snapshot,
      jsonb_build_object('counts', v_counts, 'total_rows', v_total),
      'تم إنشاؤها آلياً عبر pg_cron الساعة ' ||
        to_char(now() at time zone 'Asia/Riyadh', 'HH24:MI') || ' توقيت السعودية'
    );
  end if;

  -- استبقاء آخر ٣ نسخ تلقائية فقط (اليدوية و pre_restore تبقى للمستخدم)
  delete from public.backups
   where id in (
     select id from public.backups
      where trigger_type = 'auto_daily'
      order by created_at desc
      offset 3
   );
end;
$$;

-- ─── 3) تحقّق سريع بعد التشغيل ──────────────────────────────────────────────
-- يعرض أي جدول في schema=public غير مشمول في النسخة المنطقية، عشان تراجع
-- بنفسك أن الاستثناء مقصود (backups / app_users / activity_log / pending_actions).
--
--   select table_name
--     from information_schema.tables
--    where table_schema = 'public' and table_type = 'BASE TABLE'
--      and table_name <> all (public.backup_logical_tables())
--    order by table_name;
