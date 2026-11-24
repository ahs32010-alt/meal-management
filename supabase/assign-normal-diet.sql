-- ============================================================================
-- كل من خانة «النظام الغذائي» عنده = عادي  ←  نحط له صح على
-- «نظام غذائي عادي» في خانة «النظام الغذائي الأساسي» (beneficiary_diets)
-- ============================================================================
-- آمن لإعادة التشغيل: اللي عنده النظام أصلاً ما يتكرر عليه.
-- ما يشيل أي نظام ثاني مسند للمستفيد — يضيف بس.
-- شغّله كامل في Supabase SQL Editor، والنتيجة تطلع جدول تحت.
-- ============================================================================

drop table if exists pg_temp.normal_diet_report;
create temp table normal_diet_report (step text, info text);

do $$
declare
  v_diet_name text := 'نظام غذائي عادي';  -- ← اسم البوكس في «النظام الغذائي الأساسي»
  v_diet_id   uuid;
  v_ids       uuid[];
  v_added     int;
begin
  select id into v_diet_id
    from public.diet_systems
   where btrim(name) = btrim(v_diet_name);

  if v_diet_id is null then
    raise exception 'ما لقيت نظام اسمه «%». الأنظمة الموجودة: %', v_diet_name,
      (select string_agg('«' || name || '»', '، ' order by name) from public.diet_systems);
  end if;

  -- كل من قيمة خانته «عادي» (بأي صيغة فيها كلمة عادي: عادي / نظام عادي / Normal…)
  select array_agg(b.id) into v_ids
    from public.beneficiaries b
   where btrim(coalesce(b.diet_type, '')) ~* '(عادي|^normal$|^regular$)'
     and btrim(b.diet_type) !~ 'غير';

  if v_ids is null then
    insert into normal_diet_report values ('النتيجة', 'ما فيه أحد خانة نظامه «عادي»');
    return;
  end if;

  insert into public.beneficiary_diets (beneficiary_id, diet_id)
  select unnest(v_ids), v_diet_id
  on conflict (beneficiary_id, diet_id) do nothing;
  get diagnostics v_added = row_count;

  -- نبني محظورات/بدائل النظام لهم (لو النظام مربوط بأصناف أو حالات غذائية)
  perform public.sync_diet_exclusions(v_ids);

  insert into normal_diet_report values
    ('النظام', v_diet_name),
    ('خانتهم «عادي»', array_length(v_ids, 1)::text),
    ('انضاف لهم النظام الحين', v_added::text),
    ('كان عندهم من قبل', (array_length(v_ids, 1) - v_added)::text),
    ('القيم اللي اعتُبرت عادي',
      (select string_agg(distinct '«' || btrim(diet_type) || '»', '، ')
         from public.beneficiaries where id = any(v_ids)));
end;
$$;

select step as "الخطوة", info as "النتيجة" from normal_diet_report;
