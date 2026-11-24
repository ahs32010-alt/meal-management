-- ============================================================================
-- استرجاع مستفيد (أو مرافق) محذوف بالغلط — من آخر نسخة احتياطية فيها
-- ============================================================================
-- يرجّع: بيانات المستفيد + أنظمته الغذائية + محظوراته + ثوابته + تقسيمات
-- الستيكر + قرارات الخانات، بنفس الـid القديم (فأوامر التشغيل ترجع تعرفه).
-- ما يلمس أي شي ثاني في القاعدة — مو استعادة كاملة.
--
-- الاستخدام: شغّل الملف كامل في Supabase SQL Editor.
--   • v_name فاضي  = يرجّع آخر مستفيد/مرافق انحذف.
--   • أو اكتب الاسم بالضبط بين العلامتين.
-- النتيجة تطلع جدول تحت فيه وش رجع.
-- ============================================================================

create or replace function pg_temp.restore_row(p_table text, p_row jsonb)
returns boolean
language plpgsql
as $$
declare
  v_cols text;
  v_sel  text;
begin
  -- الأعمدة الموجودة في النسخة وفي الجدول الحالي فقط (لو انضاف عمود بعد
  -- النسخة ياخذ قيمته الافتراضية بدل null)
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position),
         string_agg('r.' || quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into v_cols, v_sel
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = p_table
     and c.is_generated = 'NEVER'
     and p_row ? c.column_name;
  if v_cols is null then return false; end if;
  execute format(
    'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) r on conflict do nothing',
    p_table, v_cols, v_sel, p_table) using p_row;
  return true;
exception when others then
  -- صف يشير لصنف/نظام انحذف بعدين — نتخطاه ونكمّل
  return false;
end;
$$;

drop table if exists pg_temp.restore_report;
create temp table restore_report (step text, info text);

do $$
declare
  v_name text := '';   -- ← اسم المستفيد بالضبط، أو اتركه فاضي = آخر محذوف
  v_id   uuid;
  v_who  text;
  v_bk   record;
  v_t    text;
  v_row  jsonb;
  v_ok   int;
  v_bad  int;
begin
  select a.entity_id::uuid, a.entity_name
    into v_id, v_who
    from public.activity_log a
   where a.action = 'delete'
     and a.entity_type in ('beneficiary', 'companion')
     and a.entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and (btrim(v_name) = '' or btrim(a.entity_name) = btrim(v_name))
     and not exists (select 1 from public.beneficiaries b where b.id::text = a.entity_id)
   order by a.created_at desc
   limit 1;

  if v_id is null then
    raise exception 'ما لقيت عملية حذف لمستفيد غير موجود حالياً%',
      case when btrim(v_name) = '' then '' else ' باسم «' || v_name || '»' end;
  end if;

  select b.id, b.created_at, b.snapshot
    into v_bk
    from public.backups b
   where b.snapshot -> 'tables' -> 'beneficiaries'
         @> jsonb_build_array(jsonb_build_object('id', v_id::text))
   order by b.created_at desc
   limit 1;

  if not found then
    raise exception '«%» ما هو موجود في أي نسخة احتياطية (غالباً انضاف بعد آخر نسخة)', v_who;
  end if;

  insert into restore_report values
    ('المستفيد', v_who),
    ('من نسخة', to_char(v_bk.created_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI') || ' بتوقيت السعودية');

  -- نوقف مزامنة الأنظمة أثناء الإدخال ونسويها مرة وحدة في الآخر
  perform set_config('app.diet_sync', 'on', true);

  select r into v_row
    from jsonb_array_elements(v_bk.snapshot -> 'tables' -> 'beneficiaries') e(r)
   where r ->> 'id' = v_id::text
   limit 1;
  if not pg_temp.restore_row('beneficiaries', v_row) then
    raise exception 'تعذّر إدخال بيانات «%» نفسها', v_who;
  end if;

  foreach v_t in array array[
    'beneficiary_diets', 'exclusions', 'beneficiary_fixed_meals',
    'sticker_splits', 'beneficiary_menu_overrides'
  ] loop
    v_ok := 0; v_bad := 0;
    for v_row in
      select r from jsonb_array_elements(coalesce(v_bk.snapshot -> 'tables' -> v_t, '[]'::jsonb)) e(r)
       where r ->> 'beneficiary_id' = v_id::text
    loop
      -- محظورات الأنظمة تنبني من جديد بالمزامنة تحت
      if v_t = 'exclusions' and coalesce(v_row ->> 'diet_id', '') <> '' then continue; end if;
      if pg_temp.restore_row(v_t, v_row) then v_ok := v_ok + 1; else v_bad := v_bad + 1; end if;
    end loop;
    if v_ok + v_bad > 0 then
      insert into restore_report values (v_t,
        v_ok || ' رجعت' || case when v_bad > 0 then '، ' || v_bad || ' ما رجعت (صنف أو نظام انحذف)' else '' end);
    end if;
  end loop;

  perform set_config('app.diet_sync', '', true);
  perform public.sync_diet_exclusions(array[v_id]);
  insert into restore_report values ('محظورات الأنظمة', 'انبنت من جديد حسب أنظمته الحالية');
end;
$$;

select step as "الخطوة", info as "النتيجة" from restore_report;
