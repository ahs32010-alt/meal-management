-- ============================================================================
-- Backup Full-DB Migration
-- يضيف لكل نسخة احتياطية لقطة كاملة وخام لجميع جداول schema=public
-- (ماعدا جدول backups نفسه — لتجنب recursion).
--
-- التغييرات:
--   1) عمود full_snapshot jsonb على جدول backups (يحوي {table_name: [rows]})
--   2) دالة public.dump_all_public_tables() تكتشف الجداول ديناميكياً وترجع dump كامل
--   3) تحديث public.create_daily_backup() ليخزّن full_snapshot كذلك
--
-- يعتمد على: backup-system-migration.sql + backup-auto-schedule-migration.sql
-- ============================================================================

-- ─── 1) عمود full_snapshot ───────────────────────────────────────────────────
alter table public.backups
  add column if not exists full_snapshot jsonb;

-- ─── 2) دالة dump_all_public_tables() ────────────────────────────────────────
-- ترجع jsonb على شكل { "table_name": [...rows] } لكل الجداول في schema=public
-- ماعدا backups (تفادياً للتعشيش اللانهائي بين النسخ).

create or replace function public.dump_all_public_tables()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_table_name text;
  v_result jsonb := '{}'::jsonb;
  v_rows jsonb;
begin
  for v_table_name in
    select table_name
      from information_schema.tables
     where table_schema = 'public'
       and table_type = 'BASE TABLE'
       and table_name <> 'backups'  -- تجنّب recursion
     order by table_name
  loop
    begin
      execute format(
        'select coalesce(jsonb_agg(to_jsonb(t.*)), ''[]''::jsonb) from public.%I t',
        v_table_name
      ) into v_rows;
    exception when others then
      -- لو فشل لأي سبب (قيود غير اعتيادية، نوع غير معروف...)، نسجّل array فاضي ونكمّل
      v_rows := '[]'::jsonb;
    end;
    v_result := v_result || jsonb_build_object(v_table_name, v_rows);
  end loop;
  return v_result;
end;
$$;

revoke all on function public.dump_all_public_tables() from public;
grant execute on function public.dump_all_public_tables() to authenticated, postgres;

-- ─── 3) تحديث create_daily_backup() ──────────────────────────────────────────
-- نفس الدالة السابقة + يخزّن full_snapshot من النداء على dump_all_public_tables.

create or replace function public.create_daily_backup()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot jsonb;
  v_full     jsonb;
  v_counts   jsonb;
  v_total    int := 0;
  -- per-table json arrays + counts للنسخة المنطقية (BACKUP_TABLES)
  j_meals jsonb := '[]'::jsonb;                    c_meals int := 0;
  j_beneficiaries jsonb := '[]'::jsonb;            c_beneficiaries int := 0;
  j_daily_orders jsonb := '[]'::jsonb;             c_daily_orders int := 0;
  j_custom_translit jsonb := '[]'::jsonb;          c_custom_translit int := 0;
  j_meal_alternatives jsonb := '[]'::jsonb;        c_meal_alternatives int := 0;
  j_exclusions jsonb := '[]'::jsonb;               c_exclusions int := 0;
  j_beneficiary_fixed jsonb := '[]'::jsonb;        c_beneficiary_fixed int := 0;
  j_menu_items jsonb := '[]'::jsonb;               c_menu_items int := 0;
  j_order_items jsonb := '[]'::jsonb;              c_order_items int := 0;
  j_sticker_splits jsonb := '[]'::jsonb;           c_sticker_splits int := 0;
begin
  begin select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb), count(*) into j_meals, c_meals from public.meals t;
  exception when undefined_table then null; end;

  begin select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb), count(*) into j_beneficiaries, c_beneficiaries from public.beneficiaries t;
  exception when undefined_table then null; end;

  begin select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb), count(*) into j_daily_orders, c_daily_orders from public.daily_orders t;
  exception when undefined_table then null; end;

  begin select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb), count(*) into j_custom_translit, c_custom_translit from public.custom_transliterations t;
  exception when undefined_table then null; end;

  begin select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb), count(*) into j_meal_alternatives, c_meal_alternatives from public.meal_alternatives t;
  exception when undefined_table then null; end;

  begin select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb), count(*) into j_exclusions, c_exclusions from public.exclusions t;
  exception when undefined_table then null; end;

  begin select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb), count(*) into j_beneficiary_fixed, c_beneficiary_fixed from public.beneficiary_fixed_meals t;
  exception when undefined_table then null; end;

  begin select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb), count(*) into j_menu_items, c_menu_items from public.menu_items t;
  exception when undefined_table then null; end;

  begin select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb), count(*) into j_order_items, c_order_items from public.order_items t;
  exception when undefined_table then null; end;

  begin select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb), count(*) into j_sticker_splits, c_sticker_splits from public.sticker_splits t;
  exception when undefined_table then null; end;

  v_total := c_meals + c_beneficiaries + c_daily_orders + c_custom_translit
           + c_meal_alternatives + c_exclusions + c_beneficiary_fixed
           + c_menu_items + c_order_items + c_sticker_splits;

  v_snapshot := jsonb_build_object(
    'version', 1,
    'taken_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'tables', jsonb_build_object(
      'meals',                    j_meals,
      'beneficiaries',            j_beneficiaries,
      'daily_orders',             j_daily_orders,
      'custom_transliterations',  j_custom_translit,
      'meal_alternatives',        j_meal_alternatives,
      'exclusions',               j_exclusions,
      'beneficiary_fixed_meals',  j_beneficiary_fixed,
      'menu_items',               j_menu_items,
      'order_items',              j_order_items,
      'sticker_splits',           j_sticker_splits
    )
  );

  v_counts := jsonb_build_object(
    'meals',                    c_meals,
    'beneficiaries',            c_beneficiaries,
    'daily_orders',             c_daily_orders,
    'custom_transliterations',  c_custom_translit,
    'meal_alternatives',        c_meal_alternatives,
    'exclusions',               c_exclusions,
    'beneficiary_fixed_meals',  c_beneficiary_fixed,
    'menu_items',               c_menu_items,
    'order_items',              c_order_items,
    'sticker_splits',           c_sticker_splits
  );

  -- لقطة DB كاملة (راو) لكل جداول public
  v_full := public.dump_all_public_tables();

  insert into public.backups (trigger_type, snapshot, full_snapshot, summary, notes)
  values (
    'auto_daily',
    v_snapshot,
    v_full,
    jsonb_build_object('counts', v_counts, 'total_rows', v_total),
    'تم إنشاؤها آلياً عبر pg_cron الساعة ' ||
      to_char(now() at time zone 'Asia/Riyadh', 'HH24:MI') ||
      ' توقيت السعودية'
  );

  -- استبقاء آخر 3 نسخ تلقائية فقط
  delete from public.backups
   where id in (
     select id from public.backups
      where trigger_type = 'auto_daily'
      order by created_at desc
      offset 3
   );
end;
$$;
