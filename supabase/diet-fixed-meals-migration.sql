-- ============================================================================
-- Diet Systems — «الأصناف الثابتة» داخل النظام الغذائي
--
-- يضيف للنظام الغذائي أصنافاً ثابتة أسبوعية (صنف + وجبة + أيام + كمية) بجانب
-- الأصناف المستبعدة. كل من أُسند له النظام تنعكس عليه هذه الأصناف تلقائياً.
--
-- التصميم نفسه في diet-systems-migration.sql: الأصناف تُكتب في جدول
-- beneficiary_fixed_meals نفسه ومعها diet_id (مصدرها)، فكل ما يقرأ الأصناف
-- الثابتة — أمر التشغيل، الستيكرات، منيو المستفيد، التقارير — يراها بلا تعديل.
--   • diet_id is null      → صنف ثابت شخصي (يُحرَّر من صفحة المستفيد)
--   • diet_id is not null  → مشتق من نظام غذائي (يُحرَّر من صفحة النظام)
--
-- المزامنة بالـtriggers داخل القاعدة:
--   • تغيّر أنظمة المستفيد أو أصناف نظام → يعاد بناء صفوف الأنظمة لمن يخصّهم.
--   • حذف أصناف مستفيد (حفظ صفحته يمسح ثم يُدرج) → تُعاد صفوف أنظمته فوراً.
--   • صنف موجود مسبقاً بنفس (اليوم، الوجبة، الصنف) يبقى صفاً واحداً — والإدراج
--     المكرر لصف موجود من نظام يُتجاهل بصمت بدل ما يفشل، فلا تتحوّل أصناف
--     النظام لشخصية عند أي إعادة كتابة لأصناف المستفيد.
--
-- يعتمد على: diet-systems-migration.sql, fixed-meals-category-migration.sql,
--            fixed-meals-is-alternative-migration.sql
-- ⚠️ آمن للتشغيل أكثر من مرة. شغّله مرة واحدة في Supabase SQL Editor.
-- ============================================================================

-- ① الجداول ------------------------------------------------------------------
create table if not exists public.diet_system_fixed_meals (
  id             uuid primary key default gen_random_uuid(),
  diet_id        uuid not null references public.diet_systems(id) on delete cascade,
  day_of_week    smallint not null check (day_of_week between 0 and 6),
  meal_type      text not null,
  meal_id        uuid not null references public.meals(id) on delete cascade,
  quantity       integer not null default 1 check (quantity > 0),
  is_alternative boolean not null default false,
  created_at     timestamptz default now(),
  unique (diet_id, day_of_week, meal_type, meal_id)
);
create index if not exists diet_system_fixed_meals_diet_idx on public.diet_system_fixed_meals (diet_id);

alter table public.beneficiary_fixed_meals
  add column if not exists diet_id uuid references public.diet_systems(id) on delete cascade;
create index if not exists beneficiary_fixed_meals_diet_idx
  on public.beneficiary_fixed_meals (diet_id) where diet_id is not null;

-- ② الصلاحيات ----------------------------------------------------------------
alter table public.diet_system_fixed_meals enable row level security;
drop policy if exists "Authenticated users full access - diet_system_fixed_meals" on public.diet_system_fixed_meals;
create policy "Authenticated users full access - diet_system_fixed_meals"
  on public.diet_system_fixed_meals for all to authenticated using (true) with check (true);

-- ③ المزامنة -----------------------------------------------------------------
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

  -- صنف في أكثر من نظام → صف واحد (الأقدم إسناداً). الصنف الشخصي بنفس
  -- المفتاح يغلب (on conflict do nothing). الفئة من الصنف نفسه — to_jsonb
  -- يقرأها بلا اعتماد على وجود العمود.
  insert into public.beneficiary_fixed_meals
         (beneficiary_id, day_of_week, meal_type, meal_id, quantity, category, is_alternative, diet_id)
  select distinct on (bd.beneficiary_id, df.day_of_week, df.meal_type, df.meal_id)
         bd.beneficiary_id, df.day_of_week, df.meal_type, df.meal_id, df.quantity,
         coalesce(to_jsonb(m) ->> 'category', case when m.is_snack then 'snack' else 'hot' end),
         df.is_alternative, df.diet_id
    from public.beneficiary_diets bd
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

-- إدراج صف مكرر لصف موجود من نظام → يُتجاهل (يبقى صف النظام). يحمي من
-- الشاشات التي تمسح أصناف المستفيد ثم تعيد إدراج ما قرأته: المسح يعيد صفوف
-- النظام فوراً (trigger الحذف)، ثم يصل الإدراج المكرر فيُتجاهل بدل ما يفشل.
create or replace function public.trg_fixed_meals_diet_row_wins()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('app.diet_sync', true), '') = 'on' then return new; end if;
  if exists (
    select 1 from public.beneficiary_fixed_meals f
     where f.beneficiary_id = new.beneficiary_id
       and f.day_of_week = new.day_of_week
       and f.meal_type = new.meal_type
       and f.meal_id = new.meal_id
       and f.diet_id is not null
  ) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists fixed_meals_diet_row_wins on public.beneficiary_fixed_meals;
create trigger fixed_meals_diet_row_wins before insert on public.beneficiary_fixed_meals
  for each row execute function public.trg_fixed_meals_diet_row_wins();

-- حُذفت أصناف مستفيد (من أي شاشة) → نعيد صفوف أنظمته
create or replace function public.trg_fixed_meals_diet_sync()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
begin
  if coalesce(current_setting('app.diet_sync', true), '') = 'on' then return null; end if;
  select array_agg(distinct bd.beneficiary_id) into v_ids
    from public.beneficiary_diets bd
   where bd.beneficiary_id in (select beneficiary_id from old_rows)
     and exists (select 1 from public.beneficiaries b where b.id = bd.beneficiary_id);
  perform public.sync_diet_fixed_meals(v_ids);
  return null;
end;
$$;

drop trigger if exists fixed_meals_diet_sync_del on public.beneficiary_fixed_meals;
create trigger fixed_meals_diet_sync_del after delete on public.beneficiary_fixed_meals
  referencing old table as old_rows for each statement execute function public.trg_fixed_meals_diet_sync();

-- أنظمة المستفيد تغيّرت
create or replace function public.trg_beneficiary_diets_fixed_sync()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
begin
  if coalesce(current_setting('app.diet_sync', true), '') = 'on' then return null; end if;
  if tg_op = 'INSERT' then
    select array_agg(distinct beneficiary_id) into v_ids from new_rows;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct beneficiary_id) into v_ids from old_rows;
  else
    select array_agg(distinct b) into v_ids
      from (select beneficiary_id b from new_rows union select beneficiary_id from old_rows) s;
  end if;
  select array_agg(id) into v_ids from public.beneficiaries where id = any (v_ids);
  perform public.sync_diet_fixed_meals(v_ids);
  return null;
end;
$$;

drop trigger if exists beneficiary_diets_fixed_sync_ins on public.beneficiary_diets;
drop trigger if exists beneficiary_diets_fixed_sync_del on public.beneficiary_diets;
drop trigger if exists beneficiary_diets_fixed_sync_upd on public.beneficiary_diets;
create trigger beneficiary_diets_fixed_sync_ins after insert on public.beneficiary_diets
  referencing new table as new_rows for each statement execute function public.trg_beneficiary_diets_fixed_sync();
create trigger beneficiary_diets_fixed_sync_del after delete on public.beneficiary_diets
  referencing old table as old_rows for each statement execute function public.trg_beneficiary_diets_fixed_sync();
create trigger beneficiary_diets_fixed_sync_upd after update on public.beneficiary_diets
  referencing new table as new_rows old table as old_rows for each statement execute function public.trg_beneficiary_diets_fixed_sync();

-- أصناف نظام تغيّرت → كل من عنده هذا النظام
create or replace function public.trg_diet_fixed_meals_sync()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_diets uuid[];
  v_ids   uuid[];
begin
  if coalesce(current_setting('app.diet_sync', true), '') = 'on' then return null; end if;
  if tg_op = 'INSERT' then
    select array_agg(distinct diet_id) into v_diets from new_rows;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct diet_id) into v_diets from old_rows;
  else
    select array_agg(distinct d) into v_diets
      from (select diet_id d from new_rows union select diet_id from old_rows) s;
  end if;
  select array_agg(distinct beneficiary_id) into v_ids
    from public.beneficiary_diets where diet_id = any (v_diets);
  perform public.sync_diet_fixed_meals(v_ids);
  return null;
end;
$$;

drop trigger if exists diet_fixed_meals_sync_ins on public.diet_system_fixed_meals;
drop trigger if exists diet_fixed_meals_sync_del on public.diet_system_fixed_meals;
drop trigger if exists diet_fixed_meals_sync_upd on public.diet_system_fixed_meals;
create trigger diet_fixed_meals_sync_ins after insert on public.diet_system_fixed_meals
  referencing new table as new_rows for each statement execute function public.trg_diet_fixed_meals_sync();
create trigger diet_fixed_meals_sync_del after delete on public.diet_system_fixed_meals
  referencing old table as old_rows for each statement execute function public.trg_diet_fixed_meals_sync();
create trigger diet_fixed_meals_sync_upd after update on public.diet_system_fixed_meals
  referencing new table as new_rows old table as old_rows for each statement execute function public.trg_diet_fixed_meals_sync();

-- ④ النسخ الاحتياطي — الجدول الجديد يدخل النسخة والاستعادة ---------------------
-- (نفس قائمة backup-menu-overrides-coverage-migration.sql + diet_system_fixed_meals)
-- الاستعادة الذرّية توقف app.diet_sync أصلاً، فلا تتدخل هذه الـtriggers فيها.
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
