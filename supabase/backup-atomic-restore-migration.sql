-- ============================================================================
-- Backup Atomic Restore Migration
--
-- المشكلة: الاستعادة كانت تنفّذ من المتصفح على مراحل — «امسح كل الجداول» ثم
-- «أدرج على دفعات». أي انقطاع في المنتصف (شبكة، إغلاق التاب، انتهاء الجلسة)
-- يترك قاعدة البيانات ممسوحة جزئياً بلا بديل: بيانات ذهبت وبيانات ما رجعت.
--
-- الحل: دالة واحدة تنفّذ المسح والإدراج كلها داخل معاملة واحدة (كل دالة
-- plpgsql تعمل داخل معاملة ضمناً). إما تنجح بالكامل أو ترجع القاعدة كما كانت
-- تماماً — لا حالة وسطى.
--
-- ⚠️ هذا الملف لا يمسّ أي بيانات ولا يغيّر أي جدول — يضيف دالة فقط.
-- يعتمد على: backup-tables-coverage-migration.sql (لدالة backup_logical_tables)
-- شغّله مرة واحدة في Supabase SQL Editor.
-- ============================================================================

create or replace function public.restore_backup_snapshot(p_snapshot jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tables    text[] := public.backup_logical_tables();
  v_table     text;
  v_rows      jsonb;
  v_inserted  jsonb := '{}'::jsonb;
  v_skipped   text[] := '{}';
  v_count     int;
  v_exists    boolean;
  i           int;
begin
  if p_snapshot is null or p_snapshot -> 'tables' is null then
    raise exception 'snapshot غير صالح: لا يحتوي مفتاح tables';
  end if;

  -- تعطيل فحص المفاتيح الخارجية داخل هذه المعاملة فقط، فلا يهمّنا ترتيب
  -- الإدراج ولا الحذف. يرجع تلقائياً في نهاية المعاملة.
  set constraints all deferred;

  -- ① المسح — بعكس ترتيب الإدراج (التابع قبل الأم)
  for i in reverse array_length(v_tables, 1) .. 1 loop
    v_table := v_tables[i];

    select exists (
      select 1 from information_schema.tables
       where table_schema = 'public' and table_name = v_table
    ) into v_exists;
    if not v_exists then
      v_skipped := v_skipped || v_table;
      continue;
    end if;

    execute format('delete from public.%I', v_table);
  end loop;

  -- ② الإدراج — بترتيب القائمة
  foreach v_table in array v_tables loop
    if v_table = any (v_skipped) then
      continue;
    end if;

    v_rows := p_snapshot -> 'tables' -> v_table;
    if v_rows is null or jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) = 0 then
      v_inserted := v_inserted || jsonb_build_object(v_table, 0);
      continue;
    end if;

    -- jsonb_populate_record يتجاهل أي مفتاح لا يوجد له عمود، ويضع الافتراضي
    -- لأي عمود غائب — فلقطة أقدم أو أحدث من الجداول الحالية تُستعاد بلا فشل.
    execute format(
      'insert into public.%I select * from jsonb_populate_recordset(null::public.%I, $1)',
      v_table, v_table
    ) using v_rows;

    v_count := jsonb_array_length(v_rows);
    v_inserted := v_inserted || jsonb_build_object(v_table, v_count);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'inserted', v_inserted,
    'skipped_tables', to_jsonb(v_skipped)
  );
end;
$$;

revoke all on function public.restore_backup_snapshot(jsonb) from public;
grant execute on function public.restore_backup_snapshot(jsonb) to authenticated, postgres;

comment on function public.restore_backup_snapshot(jsonb) is
  'يستعيد لقطة نسخة احتياطية كاملة داخل معاملة واحدة — إما كلها أو لا شيء.';
