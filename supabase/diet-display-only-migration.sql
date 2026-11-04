-- ============================================================================
-- Diet Systems — خيار «لا تعكس الأصناف على المستفيد» (للعرض فقط)
--
-- display_only = true (الافتراضي): النظام يُختار للمستفيد للعرض فقط — محظوراته
-- وبدائله وأصنافه الثابتة لا تُنسخ لبيانات المستفيد، فتبقى بياناته يدوية.
-- display_only = false: المزامنة القديمة كما هي — محظورات النظام وبدائله
-- وأصنافه الثابتة تنعكس على كل من عنده النظام.
--
-- تغيير الخيار على نظام يعيد المزامنة فوراً لكل من عنده النظام:
--   • شيله  → تنعكس المحظورات والبدائل والأصناف الثابتة عليهم.
--   • رجّعه → تنشال صفوف هذا النظام من بياناتهم.
--
-- الصفوف المنسوخة من قبل لأنظمة تصير «للعرض فقط» بهذه الترقية تتحوّل لصفوف
-- يدوية (شخصية) عند أصحابها — فما ينقص من منيو أحد شيء.
--
-- يعتمد على: diet-systems-migration.sql, diet-fixed-meals-migration.sql
-- ⚠️ آمن للتشغيل أكثر من مرة. شغّله مرة واحدة في Supabase SQL Editor.
-- ============================================================================

-- ① العمود --------------------------------------------------------------------
alter table public.diet_systems
  add column if not exists display_only boolean not null default true;

-- ② المزامنة تتخطّى الأنظمة اللي للعرض فقط ------------------------------------
create or replace function public.sync_diet_exclusions(p_ben_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev text := coalesce(current_setting('app.diet_sync', true), '');
begin
  if p_ben_ids is null or array_length(p_ben_ids, 1) is null then return; end if;
  perform set_config('app.diet_sync', 'on', true);

  delete from public.exclusions
   where beneficiary_id = any (p_ben_ids) and diet_id is not null;

  insert into public.exclusions (beneficiary_id, meal_id, alternative_meal_id, diet_id)
  select distinct on (bd.beneficiary_id, dx.meal_id)
         bd.beneficiary_id, dx.meal_id, dx.alternative_meal_id, dx.diet_id
    from public.beneficiary_diets bd
    join public.diet_systems ds on ds.id = bd.diet_id and not ds.display_only
    join public.diet_system_exclusions dx on dx.diet_id = bd.diet_id
   where bd.beneficiary_id = any (p_ben_ids)
     and not exists (
       select 1 from public.exclusions p
        where p.beneficiary_id = bd.beneficiary_id
          and p.meal_id = dx.meal_id
          and p.diet_id is null)
   order by bd.beneficiary_id, dx.meal_id, (dx.alternative_meal_id is null), bd.created_at, bd.diet_id;

  perform set_config('app.diet_sync', v_prev, true);
end;
$$;

revoke all on function public.sync_diet_exclusions(uuid[]) from public;
grant execute on function public.sync_diet_exclusions(uuid[]) to authenticated, postgres;

create or replace function public.sync_diet_fixed_meals(p_ben_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev text := coalesce(current_setting('app.diet_sync', true), '');
begin
  if p_ben_ids is null or array_length(p_ben_ids, 1) is null then return; end if;
  perform set_config('app.diet_sync', 'on', true);

  delete from public.beneficiary_fixed_meals
   where beneficiary_id = any (p_ben_ids) and diet_id is not null;

  insert into public.beneficiary_fixed_meals
         (beneficiary_id, day_of_week, meal_type, meal_id, quantity, category, is_alternative, diet_id)
  select distinct on (bd.beneficiary_id, df.day_of_week, df.meal_type, df.meal_id)
         bd.beneficiary_id, df.day_of_week, df.meal_type, df.meal_id, df.quantity,
         coalesce(to_jsonb(m) ->> 'category', case when m.is_snack then 'snack' else 'hot' end),
         df.is_alternative, df.diet_id
    from public.beneficiary_diets bd
    join public.diet_systems ds on ds.id = bd.diet_id and not ds.display_only
    join public.diet_system_fixed_meals df on df.diet_id = bd.diet_id
    join public.meals m on m.id = df.meal_id
   where bd.beneficiary_id = any (p_ben_ids)
   order by bd.beneficiary_id, df.day_of_week, df.meal_type, df.meal_id, bd.created_at, bd.diet_id
  on conflict do nothing;

  perform set_config('app.diet_sync', v_prev, true);
end;
$$;

revoke all on function public.sync_diet_fixed_meals(uuid[]) from public;
grant execute on function public.sync_diet_fixed_meals(uuid[]) to authenticated, postgres;

-- ③ تغيّر الخيار على نظام → نعيد المزامنة لكل من عنده النظام --------------------
create or replace function public.trg_diet_display_only_sync()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
begin
  if new.display_only is not distinct from old.display_only then return null; end if;
  select array_agg(distinct beneficiary_id) into v_ids
    from public.beneficiary_diets where diet_id = new.id;
  perform public.sync_diet_exclusions(v_ids);
  perform public.sync_diet_fixed_meals(v_ids);
  return null;
end;
$$;

drop trigger if exists diet_display_only_sync on public.diet_systems;
create trigger diet_display_only_sync after update of display_only on public.diet_systems
  for each row execute function public.trg_diet_display_only_sync();

-- ④ الصفوف المنسوخة من قبل لأنظمة «للعرض فقط» → يدوية عند أصحابها ------------
-- (app.diet_sync = on عشان التحويل ما يستدعي المزامنة فتمسحها قبل ما تتحوّل)
do $$
begin
  perform set_config('app.diet_sync', 'on', true);
  update public.exclusions e set diet_id = null
    from public.diet_systems ds
   where ds.id = e.diet_id and ds.display_only;
  update public.beneficiary_fixed_meals f set diet_id = null
    from public.diet_systems ds
   where ds.id = f.diet_id and ds.display_only;
  perform set_config('app.diet_sync', '', true);
end $$;
