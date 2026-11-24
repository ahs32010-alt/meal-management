-- ============================================================================
-- Meal Textures Migration — «الحالات الغذائية للصنف»
--
-- المشكلة: مستفيد يأكل نفس الصنف لكن مهروس/خلاط/مقطع. قبل هذي الترقية كان
-- لازم تسوي صنف جديد «فول (مهروس)» يدوياً + استبعاد «فول» بديله «فول (مهروس)»
-- في النظام الغذائي — لكل صنف ولكل حالة.
--
-- الحل: «حالة» = صف في جدول meals نفسه، مربوط بالصنف الأصلي:
--   • texture_of       → الصنف الأصلي (حذف الأصل يحذف حالاته)
--   • texture_name     → اسم الحالة (مهروس / خلاط / مقطع …)
--   • texture_diet_id  → النظام الغذائي المربوط بالحالة
--
-- الاسم يُبنى تلقائياً «<اسم الصنف> (<الحالة>)»، ونوع الوجبة والسناك والفئة
-- والفئة (مستفيد/مرافق) تُنسخ من الأصل وتتبعه لو تغيّر.
--
-- والربط بالنظام يكتب تلقائياً في diet_system_exclusions:
--   النظام X يستبعد «فول» وبديله «فول (مهروس)»
-- فكل ما يقرأ الاستبعادات (أمر التشغيل، الستيكرات، منيو المستفيد، التقارير)
-- يشتغل بلا أي تعديل: ١٠٠ فول و١٠ مستفيدين نظامهم مهروس →
--   ٩٠ فول + ١٠ فول (مهروس)
--
-- ⚠️ آمن للتشغيل أكثر من مرة. يحتاج diet-systems-migration.sql قبله.
-- شغّله مرة واحدة في Supabase SQL Editor.
-- ============================================================================

-- ① الأعمدة ------------------------------------------------------------------
alter table public.meals
  add column if not exists texture_of uuid references public.meals(id) on delete cascade;
alter table public.meals
  add column if not exists texture_name text;
-- بلا FK عمداً: الاستعادة من نسخة احتياطية ترجّع meals قبل diet_systems، فالـFK
-- كان يفشّل الاستعادة كاملة. حذف النظام يصفّر العمود بالـtrigger في ④ب.
alter table public.meals
  add column if not exists texture_diet_id uuid;
alter table public.meals
  drop constraint if exists meals_texture_diet_id_fkey;

create index if not exists meals_texture_of_idx on public.meals (texture_of) where texture_of is not null;
-- نفس الحالة ما تتكرر لنفس الصنف
create unique index if not exists meals_texture_uniq
  on public.meals (texture_of, lower(btrim(texture_name))) where texture_of is not null;

-- ② قبل الحفظ: الاسم والخصائص من الأصل ------------------------------------------
create or replace function public.trg_meal_texture_fill()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.meals%rowtype;
begin
  -- الاستعادة من نسخة احتياطية تكتب الصفوف كما حُفظت
  if coalesce(current_setting('app.diet_sync', true), '') = 'on' then return new; end if;
  if new.texture_of is null then return new; end if;

  if new.texture_name is null or btrim(new.texture_name) = '' then
    raise exception 'اسم الحالة الغذائية مطلوب';
  end if;
  new.texture_name := btrim(new.texture_name);

  select * into p from public.meals where id = new.texture_of;
  if not found then return new; end if;
  if p.texture_of is not null then
    raise exception 'ما يصير تضيف حالة على حالة — أضفها على الصنف الأصلي';
  end if;

  new.name        := p.name || ' (' || new.texture_name || ')';
  new.english_name := case when p.english_name is null or btrim(p.english_name) = '' then null
                           else p.english_name || ' (' || new.texture_name || ')' end;
  new.type        := p.type;
  new.is_snack    := p.is_snack;
  new.category    := p.category;
  new.entity_type := p.entity_type;
  return new;
end;
$$;

drop trigger if exists meal_texture_fill on public.meals;
create trigger meal_texture_fill before insert or update on public.meals
  for each row execute function public.trg_meal_texture_fill();

-- ③ بعد الحفظ: ربط الحالة بالنظام الغذائي -----------------------------------------
-- يكتب/يحدّث صف «النظام يستبعد الأصل → بديله الحالة»
create or replace function public.trg_meal_texture_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('app.diet_sync', true), '') = 'on' then return null; end if;

  -- (أ) الحالة نفسها تغيّرت → فك الربط القديم وكتابة الجديد
  if tg_op = 'UPDATE' and old.texture_of is not null
     and (old.texture_diet_id is distinct from new.texture_diet_id
          or old.texture_of is distinct from new.texture_of) then
    -- فك ربط مقصود — ما نبي ⑤ يرجّعه
    perform set_config('app.texture_sync', 'on', true);
    delete from public.diet_system_exclusions
     where diet_id = old.texture_diet_id
       and meal_id = old.texture_of
       and alternative_meal_id = old.id;
    perform set_config('app.texture_sync', '', true);
  end if;

  -- النظام لازم يكون موجود (الاستعادة من المتصفح ترجّع الأصناف قبل الأنظمة —
  -- وصفوف الربط ترجع وقتها من النسخة نفسها)
  if new.texture_of is not null and new.texture_diet_id is not null
     and exists (select 1 from public.diet_systems where id = new.texture_diet_id) then
    insert into public.diet_system_exclusions (diet_id, meal_id, alternative_meal_id)
    values (new.texture_diet_id, new.texture_of, new.id)
    on conflict (diet_id, meal_id)
      do update set alternative_meal_id = excluded.alternative_meal_id
      where public.diet_system_exclusions.alternative_meal_id is distinct from excluded.alternative_meal_id;
  end if;

  -- الحالة الجديدة تاخذ قسم المطبخ حق الأصل (لو الجدول موجود)
  if tg_op = 'INSERT' and new.texture_of is not null
     and to_regclass('public.meal_kitchen_sections') is not null then
    execute 'insert into public.meal_kitchen_sections (meal_id, section_id)
             select $1, section_id from public.meal_kitchen_sections where meal_id = $2
             on conflict (meal_id) do nothing'
      using new.id, new.texture_of;
  end if;

  -- (ب) الصنف الأصلي تغيّر (اسم/نوع/سناك/فئة) → حالاته تتبعه
  if tg_op = 'UPDATE' and new.texture_of is null
     and (old.name is distinct from new.name
          or old.english_name is distinct from new.english_name
          or old.type is distinct from new.type
          or old.is_snack is distinct from new.is_snack
          or old.category is distinct from new.category
          or old.entity_type is distinct from new.entity_type) then
    update public.meals set texture_name = texture_name where texture_of = new.id;
  end if;

  return null;
end;
$$;

drop trigger if exists meal_texture_link on public.meals;
create trigger meal_texture_link after insert or update on public.meals
  for each row execute function public.trg_meal_texture_link();

-- ④ حذف الحالة → فك ربطها بالنظام (قبل ما يحوّل الـFK البديل إلى null) -------------
create or replace function public.trg_meal_texture_unlink()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('app.diet_sync', true), '') = 'on' then return old; end if;
  if old.texture_of is not null and old.texture_diet_id is not null then
    perform set_config('app.texture_sync', 'on', true);
    delete from public.diet_system_exclusions
     where diet_id = old.texture_diet_id
       and meal_id = old.texture_of
       and alternative_meal_id = old.id;
    perform set_config('app.texture_sync', '', true);
  end if;
  return old;
end;
$$;

drop trigger if exists meal_texture_unlink on public.meals;
create trigger meal_texture_unlink before delete on public.meals
  for each row execute function public.trg_meal_texture_unlink();

-- ④ب حذف نظام غذائي → حالاته تصير «بدون نظام» (بديل الـFK) -----------------------
create or replace function public.trg_diet_texture_unlink()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('app.diet_sync', true), '') = 'on' then return old; end if;
  update public.meals set texture_diet_id = null where texture_diet_id = old.id;
  return old;
end;
$$;

drop trigger if exists diet_texture_unlink on public.diet_systems;
create trigger diet_texture_unlink before delete on public.diet_systems
  for each row execute function public.trg_diet_texture_unlink();

-- ⑤ الحالة هي المرجع: ربطها بالنظام ما ينمسح من شاشة النظام -----------------------
-- حفظ النظام، واستيراد الأنظمة (استبدال)، والموافقة على طلب تعديل نظام قديم —
-- كلها تحذف/تعدّل الاستبعادات بالفرق، فكانت تمسح ربط الحالة بصمت والصنف لسه
-- يقول إنه مربوط. هنا: أي صف ينحذف أو يتعدّل وله حالة مربوطة بنفس النظام يرجع.
-- فك الربط يكون من شاشة الصنف (حذف الحالة أو تغيير نظامها).
create or replace function public.trg_dse_texture_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('app.diet_sync', true), '') = 'on' then return null; end if;
  if coalesce(current_setting('app.texture_sync', true), '') = 'on' then return null; end if;
  -- trigger «لكل أمر» يشتغل حتى لو ما تغيّر ولا صف — و insert … on conflict تحت
  -- يشغّل trigger التعديل دائماً، فبدون هذا السطر يستدعي نفسه بلا نهاية
  -- (stack depth limit exceeded).
  if not exists (select 1 from old_rows) then return null; end if;

  -- كتابتنا هنا ما تستدعي الحماية من جديد
  perform set_config('app.texture_sync', 'on', true);
  insert into public.diet_system_exclusions (diet_id, meal_id, alternative_meal_id)
  select distinct on (v.texture_diet_id, v.texture_of) v.texture_diet_id, v.texture_of, v.id
    from old_rows o
    join public.meals v on v.texture_of = o.meal_id and v.texture_diet_id = o.diet_id
   where exists (select 1 from public.diet_systems d where d.id = v.texture_diet_id)
     and exists (select 1 from public.meals p where p.id = v.texture_of)
   order by v.texture_diet_id, v.texture_of, v.created_at
  on conflict (diet_id, meal_id)
    do update set alternative_meal_id = excluded.alternative_meal_id
    where public.diet_system_exclusions.alternative_meal_id is distinct from excluded.alternative_meal_id;
  perform set_config('app.texture_sync', '', true);
  return null;
end;
$$;

drop trigger if exists dse_texture_guard_del on public.diet_system_exclusions;
drop trigger if exists dse_texture_guard_upd on public.diet_system_exclusions;
create trigger dse_texture_guard_del after delete on public.diet_system_exclusions
  referencing old table as old_rows for each statement execute function public.trg_dse_texture_guard();
create trigger dse_texture_guard_upd after update on public.diet_system_exclusions
  referencing old table as old_rows for each statement execute function public.trg_dse_texture_guard();

-- ⑥ المزامنة: الحالة الغذائية تنعكس دائماً --------------------------------------
-- diet-display-only-migration تخلّي المزامنة تتخطّى الأنظمة «للعرض فقط» (وهو
-- الافتراضي لكل نظام جديد) — فالحالة كانت تنكتب في النظام وما توصل للمستفيد،
-- وأمر التشغيل يطلع الصنف الأصلي للكل.
-- هنا: صف استبعاد بديله «حالة» لنفس الصنف ينعكس حتى لو النظام للعرض فقط.
-- باقي محظورات النظام العادية تبقى على خيار «للعرض فقط» كما هي.
-- (يحتاج diet-display-only-migration.sql قبله)
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
    join public.diet_systems ds on ds.id = bd.diet_id
    join public.diet_system_exclusions dx on dx.diet_id = bd.diet_id
    left join public.meals v on v.id = dx.alternative_meal_id
   where bd.beneficiary_id = any (p_ben_ids)
     and (not ds.display_only or v.texture_of = dx.meal_id)
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

-- إعادة مزامنة كل من عنده نظام غذائي — فالحالات المضافة قبل هذا التصحيح توصل لهم الآن
-- (داخل do: الدالة ترجع void، و select لقيمة void يطلّع خطأ في محرر Supabase)
do $$
declare
  v_ids uuid[];
begin
  select array_agg(distinct beneficiary_id) into v_ids from public.beneficiary_diets;
  perform public.sync_diet_exclusions(v_ids);
end;
$$;

-- ⑦ تحويل الأصناف اليدوية القديمة («فول (مهروس)») لحالات — اختياري -----------------
-- ما يشتغل تلقائياً. الصفحة تتبنّى الصنف الموجود بنفس الاسم لما تضيف الحالة
-- من شاشة الصنف، فتبقى كل المحظورات والثوابت المربوطة فيه شغّالة.

notify pgrst, 'reload schema';
