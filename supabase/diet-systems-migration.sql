-- ============================================================================
-- Diet Systems Migration — «النظام الغذائي»
--
-- نظام غذائي = اسم + قائمة أصناف مستبعدة (لكل صنف بديل اختياري). يُعطى
-- المستفيد نظاماً أو أكثر، فتنطبق استبعادات النظام على منيوه.
--
-- التصميم: استبعادات الأنظمة تُكتب في جدول exclusions نفسه ومعها diet_id
-- (مصدرها). فكل ما يقرأ exclusions — أمر التشغيل، الستيكرات، منيو المستفيد،
-- التقارير، المساعد — يراها تلقائياً بلا أي تعديل عليه.
--   • diet_id is null      → محظور شخصي (يُحرَّر من صفحة المستفيد)
--   • diet_id is not null  → مشتق من نظام غذائي (يُحرَّر من صفحة النظام)
--
-- المزامنة بالـtriggers داخل القاعدة — أي تغيير على أنظمة المستفيد، أو على
-- استبعادات نظام، أو على محظورات المستفيد، يعيد بناء صفوف الأنظمة له:
--   • المحظور الشخصي يغلب: صنف له محظور شخصي لا يُكتب له صف من النظام.
--   • صنف يستبعده أكثر من نظام → صف واحد؛ الأولوية لمن له بديل ثم الأقدم إسناداً.
--   • حذف الشخصي يرجّع صف النظام تلقائياً.
--
-- ⚠️ آمن للتشغيل أكثر من مرة. لا يمسّ أي محظور موجود.
-- شغّله مرة واحدة في Supabase SQL Editor.
-- ============================================================================

-- ① الجداول ------------------------------------------------------------------
create table if not exists public.diet_systems (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  created_at  timestamptz default now()
);
create unique index if not exists diet_systems_name_uniq on public.diet_systems (lower(btrim(name)));

create table if not exists public.diet_system_exclusions (
  id                  uuid primary key default gen_random_uuid(),
  diet_id             uuid not null references public.diet_systems(id) on delete cascade,
  meal_id             uuid not null references public.meals(id) on delete cascade,
  alternative_meal_id uuid references public.meals(id) on delete set null,
  created_at          timestamptz default now(),
  unique (diet_id, meal_id)
);
create index if not exists diet_system_exclusions_diet_idx on public.diet_system_exclusions (diet_id);

create table if not exists public.beneficiary_diets (
  id             uuid primary key default gen_random_uuid(),
  beneficiary_id uuid not null references public.beneficiaries(id) on delete cascade,
  diet_id        uuid not null references public.diet_systems(id) on delete cascade,
  created_at     timestamptz default now(),
  unique (beneficiary_id, diet_id)
);
create index if not exists beneficiary_diets_diet_idx on public.beneficiary_diets (diet_id);

alter table public.exclusions
  add column if not exists diet_id uuid references public.diet_systems(id) on delete cascade;
create index if not exists exclusions_diet_idx on public.exclusions (diet_id) where diet_id is not null;

-- ② الصلاحيات — نفس سياسة بقية الجداول -----------------------------------------
alter table public.diet_systems enable row level security;
alter table public.diet_system_exclusions enable row level security;
alter table public.beneficiary_diets enable row level security;

drop policy if exists "Authenticated users full access - diet_systems" on public.diet_systems;
create policy "Authenticated users full access - diet_systems"
  on public.diet_systems for all to authenticated using (true) with check (true);
drop policy if exists "Authenticated users full access - diet_system_exclusions" on public.diet_system_exclusions;
create policy "Authenticated users full access - diet_system_exclusions"
  on public.diet_system_exclusions for all to authenticated using (true) with check (true);
drop policy if exists "Authenticated users full access - beneficiary_diets" on public.beneficiary_diets;
create policy "Authenticated users full access - beneficiary_diets"
  on public.beneficiary_diets for all to authenticated using (true) with check (true);

-- ③ المزامنة -----------------------------------------------------------------
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
  -- كتاباتنا هنا لا تستدعي المزامنة من جديد
  perform set_config('app.diet_sync', 'on', true);

  delete from public.exclusions
   where beneficiary_id = any (p_ben_ids) and diet_id is not null;

  insert into public.exclusions (beneficiary_id, meal_id, alternative_meal_id, diet_id)
  select distinct on (bd.beneficiary_id, dx.meal_id)
         bd.beneficiary_id, dx.meal_id, dx.alternative_meal_id, dx.diet_id
    from public.beneficiary_diets bd
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

-- exclusions عليه unique(beneficiary_id, meal_id). محظور شخصي جديد على صنف
-- له صف من نظام → نزيل صف النظام أولاً (الشخصي يغلب) بدل ما يفشل الإدراج.
-- يعمل قبل فحص التعارض، فيشمل upsert أيضاً.
create or replace function public.trg_exclusions_personal_wins()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('app.diet_sync', true), '') = 'on' then return new; end if;
  if new.diet_id is null then
    -- الحذف هنا لا يستدعي المزامنة (وإلا رجّعت الصف قبل وصول الشخصي)؛
    -- المزامنة تجري بعد الإدراج من trigger الإدراج
    perform set_config('app.diet_sync', 'on', true);
    delete from public.exclusions
     where beneficiary_id = new.beneficiary_id and meal_id = new.meal_id and diet_id is not null;
    perform set_config('app.diet_sync', '', true);
  end if;
  return new;
end;
$$;

drop trigger if exists exclusions_personal_wins on public.exclusions;
create trigger exclusions_personal_wins before insert on public.exclusions
  for each row execute function public.trg_exclusions_personal_wins();

-- محظورات المستفيد تغيّرت (من أي شاشة) → نعيد بناء صفوف أنظمته
create or replace function public.trg_exclusions_diet_sync()
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
  -- فقط من عنده نظام غذائي — البقية لا شيء يُزامَن لهم
  select array_agg(distinct bd.beneficiary_id) into v_ids
    from public.beneficiary_diets bd where bd.beneficiary_id = any (v_ids);
  perform public.sync_diet_exclusions(v_ids);
  return null;
end;
$$;

drop trigger if exists exclusions_diet_sync_ins on public.exclusions;
drop trigger if exists exclusions_diet_sync_del on public.exclusions;
drop trigger if exists exclusions_diet_sync_upd on public.exclusions;
create trigger exclusions_diet_sync_ins after insert on public.exclusions
  referencing new table as new_rows for each statement execute function public.trg_exclusions_diet_sync();
create trigger exclusions_diet_sync_del after delete on public.exclusions
  referencing old table as old_rows for each statement execute function public.trg_exclusions_diet_sync();
create trigger exclusions_diet_sync_upd after update on public.exclusions
  referencing new table as new_rows old table as old_rows for each statement execute function public.trg_exclusions_diet_sync();

-- أنظمة المستفيد تغيّرت
create or replace function public.trg_beneficiary_diets_sync()
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
  -- المستفيد المحذوف كلياً لا يُزامَن (صفوفه تُحذف بالـcascade)
  select array_agg(id) into v_ids from public.beneficiaries where id = any (v_ids);
  perform public.sync_diet_exclusions(v_ids);
  return null;
end;
$$;

drop trigger if exists beneficiary_diets_sync_ins on public.beneficiary_diets;
drop trigger if exists beneficiary_diets_sync_del on public.beneficiary_diets;
drop trigger if exists beneficiary_diets_sync_upd on public.beneficiary_diets;
create trigger beneficiary_diets_sync_ins after insert on public.beneficiary_diets
  referencing new table as new_rows for each statement execute function public.trg_beneficiary_diets_sync();
create trigger beneficiary_diets_sync_del after delete on public.beneficiary_diets
  referencing old table as old_rows for each statement execute function public.trg_beneficiary_diets_sync();
create trigger beneficiary_diets_sync_upd after update on public.beneficiary_diets
  referencing new table as new_rows old table as old_rows for each statement execute function public.trg_beneficiary_diets_sync();

-- استبعادات نظام تغيّرت → كل من عنده هذا النظام
create or replace function public.trg_diet_exclusions_sync()
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
  perform public.sync_diet_exclusions(v_ids);
  return null;
end;
$$;

drop trigger if exists diet_exclusions_sync_ins on public.diet_system_exclusions;
drop trigger if exists diet_exclusions_sync_del on public.diet_system_exclusions;
drop trigger if exists diet_exclusions_sync_upd on public.diet_system_exclusions;
create trigger diet_exclusions_sync_ins after insert on public.diet_system_exclusions
  referencing new table as new_rows for each statement execute function public.trg_diet_exclusions_sync();
create trigger diet_exclusions_sync_del after delete on public.diet_system_exclusions
  referencing old table as old_rows for each statement execute function public.trg_diet_exclusions_sync();
create trigger diet_exclusions_sync_upd after update on public.diet_system_exclusions
  referencing new table as new_rows old table as old_rows for each statement execute function public.trg_diet_exclusions_sync();

-- ④ النسخ الاحتياطي — الجداول الجديدة تدخل النسخة والاستعادة ------------------
-- (نفس قائمة backup-tables-coverage-migration.sql + الجداول الجديدة قبل exclusions)
create or replace function public.backup_logical_tables()
returns text[]
language sql
immutable
as $$
  select array[
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
    'diet_systems',
    -- تابعة لـ meals / beneficiaries / daily_orders
    'meal_alternatives',
    'diet_system_exclusions',
    'beneficiary_diets',
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

-- الاستعادة ترجّع صفوف exclusions كما حُفظت (بما فيها صفوف الأنظمة) — فنوقف
-- المزامنة طوال المعاملة حتى لا تعيد الـtriggers بناءها في المنتصف.
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

  set constraints all deferred;
  perform set_config('app.diet_sync', 'on', true);

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

  foreach v_table in array v_tables loop
    if v_table = any (v_skipped) then
      continue;
    end if;
    v_rows := p_snapshot -> 'tables' -> v_table;
    if v_rows is null or jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) = 0 then
      v_inserted := v_inserted || jsonb_build_object(v_table, 0);
      continue;
    end if;
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
