-- ============================================================================
-- «النظام الغذائي» = «النظام الغذائي الأساسي» في كل المشروع
-- ============================================================================
-- قبل: beneficiaries.diet_type خانة نصية حرة تنكتب يدوياً، منفصلة عن الأنظمة
-- المسندة (beneficiary_diets) — فأمر التشغيل والقائمة والمساعد والتصدير يقرون
-- النص، والستيكرات تقرأ الأنظمة، وممكن يختلفون.
--
-- بعد: diet_type تكتبه القاعدة فقط = أسماء أنظمته الأساسية مفصولة بـ « - »
-- («نظام غذائي عادي» أولاً) — نفس صيغة الستيكرات بالضبط. أي كتابة يدوية عليه
-- تنمسح، وأي تغيير في أنظمة المستفيد أو اسم نظام ينعكس فوراً.
--
-- ما يضيع شي: النص القديم ينحفظ في diet_type_legacy، واللي نصه القديم يطابق
-- اسم نظام وما عنده أي نظام أساسي ينسند له النظام تلقائياً. اللي ما تطابق
-- يطلعون في الجدول بالأخير عشان تسندهم يدوياً.
--
-- آمن لإعادة التشغيل. شغّله كامل في Supabase SQL Editor.
-- ============================================================================

-- ① حفظ النص القديم — مرة وحدة فقط (قبل ما تركب الـtrigger)
alter table public.beneficiaries add column if not exists diet_type_legacy text;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'beneficiaries_diet_type_derived'
  ) then
    update public.beneficiaries
       set diet_type_legacy = diet_type
     where diet_type_legacy is null and nullif(btrim(diet_type), '') is not null;
  end if;
end;
$$;

-- ② اسم النظام موحّد للمقارنة (همزات، تاء مربوطة، ألف مقصورة، تشكيل، فراغات)
create or replace function public.diet_name_key(p text)
returns text
language sql
immutable
as $$
  select lower(btrim(regexp_replace(
    translate(regexp_replace(coalesce(p, ''), '[ً-ٰٟـ]', '', 'g'),
              'أإآٱىؤئة', 'اااايويه'),
    '\s+', ' ', 'g')));
$$;

-- ③ المستفيد بلا أي نظام أساسي + نصه القديم يطابق اسم نظام → نسنده له
do $$
declare
  v_ids uuid[];
begin
  with tokens as (
    select b.id as beneficiary_id, public.diet_name_key(t) as k
      from public.beneficiaries b
      cross join lateral regexp_split_to_table(b.diet_type_legacy, '\s*(،|,|/|\+|؛|;| - )\s*') t
     where nullif(btrim(b.diet_type_legacy), '') is not null
       and not exists (select 1 from public.beneficiary_diets bd where bd.beneficiary_id = b.id)
  ), ins as (
    insert into public.beneficiary_diets (beneficiary_id, diet_id)
    select distinct t.beneficiary_id, d.id
      from tokens t
      join public.diet_systems d on public.diet_name_key(d.name) = t.k
     where t.k <> ''
    on conflict (beneficiary_id, diet_id) do nothing
    returning beneficiary_id
  )
  select array_agg(distinct beneficiary_id) into v_ids from ins;

  if v_ids is not null then
    perform public.sync_diet_exclusions(v_ids);
  end if;
end;
$$;

-- ④ التسمية المشتقّة من الأنظمة الأساسية
create or replace function public.beneficiary_diet_label(p_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select nullif(string_agg(x.name, ' - ' order by (x.name = 'نظام غذائي عادي') desc, x.name), '')
    from (
      select distinct btrim(d.name) as name
        from public.beneficiary_diets bd
        join public.diet_systems d on d.id = bd.diet_id
       where bd.beneficiary_id = p_id and nullif(btrim(d.name), '') is not null
    ) x;
$$;

-- ⑤ diet_type على المستفيد = المشتقّ دائماً (أي قيمة يدوية تنكتب فوقها)
create or replace function public.trg_beneficiaries_diet_type_derived()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.diet_type := public.beneficiary_diet_label(new.id);
  return new;
end;
$$;

drop trigger if exists beneficiaries_diet_type_derived on public.beneficiaries;
create trigger beneficiaries_diet_type_derived
  before insert or update on public.beneficiaries
  for each row execute function public.trg_beneficiaries_diet_type_derived();

-- ⑥ تغيّرت أنظمة المستفيد → نحدّث تسميته
create or replace function public.trg_beneficiary_diets_refresh_label()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  foreach v_id in array array_remove(array[
    case when tg_op in ('INSERT', 'UPDATE') then new.beneficiary_id end,
    case when tg_op in ('DELETE', 'UPDATE') then old.beneficiary_id end
  ], null) loop
    update public.beneficiaries
       set diet_type = null   -- الـtrigger ⑤ يحسب القيمة الصحيحة
     where id = v_id
       and diet_type is distinct from public.beneficiary_diet_label(v_id);
  end loop;
  return null;
end;
$$;

drop trigger if exists beneficiary_diets_refresh_label on public.beneficiary_diets;
create trigger beneficiary_diets_refresh_label
  after insert or update or delete on public.beneficiary_diets
  for each row execute function public.trg_beneficiary_diets_refresh_label();

-- ⑦ تغيّر اسم نظام → نحدّث كل من عنده النظام
create or replace function public.trg_diet_systems_refresh_label()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.name is distinct from old.name then
    update public.beneficiaries b
       set diet_type = null
     where b.id in (select bd.beneficiary_id from public.beneficiary_diets bd where bd.diet_id = new.id);
  end if;
  return null;
end;
$$;

drop trigger if exists diet_systems_refresh_label on public.diet_systems;
create trigger diet_systems_refresh_label
  after update of name on public.diet_systems
  for each row execute function public.trg_diet_systems_refresh_label();

-- ⑧ تعبئة الكل الحين
update public.beneficiaries b
   set diet_type = null
 where b.diet_type is distinct from public.beneficiary_diet_label(b.id);

notify pgrst, 'reload schema';

-- ⑨ اللي كان لهم نص قديم وما عندهم أي نظام أساسي → أسندهم يدوياً
select b.name as "الاسم", b.code as "الكود",
       case b.entity_type when 'companion' then 'مرافق' else 'مستفيد' end as "النوع",
       b.diet_type_legacy as "النظام القديم (نص)"
  from public.beneficiaries b
 where nullif(btrim(b.diet_type_legacy), '') is not null
   and not exists (select 1 from public.beneficiary_diets bd where bd.beneficiary_id = b.id)
 order by b.diet_type_legacy, b.name;
