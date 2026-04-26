-- ============================================================================
-- Companions Meals + Menu Migration
-- يكمّل ملف companions-migration.sql ويضيف entity_type لجدولَي:
--   - meals       (الأصناف)
--   - menu_items  (قائمة الطعام الأسبوعية)
--
-- يعتمد على ملف companions-migration.sql فلازم تشغّله أولاً.
--
-- البيانات الحالية كلها تتحوّل إلى entity_type='beneficiary' افتراضياً،
-- وأي صنف/منيو جديد للمرافقين يُسجَّل بـentity_type='companion'.
-- ============================================================================

-- 1) إضافة العمود لجدول الأصناف
alter table public.meals
  add column if not exists entity_type text not null default 'beneficiary';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'meals_entity_type_check') then
    alter table public.meals
      add constraint meals_entity_type_check
      check (entity_type in ('beneficiary', 'companion'));
  end if;
end$$;

-- ⚠️ نسقط القيد القديم (entity_type, name) لو تم إنشاؤه في تشغيل سابق —
-- كان ضيّقاً ويتعارض مع نفس الاسم في وجبات مختلفة (مثلاً "فواكه" تتكرر بين الفطور والعشاء).
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'meals_entity_name_unique') then
    alter table public.meals drop constraint meals_entity_name_unique;
  end if;
end$$;

-- القيد الجديد على (entity_type, type, is_snack, name) — أدق وأوسع:
-- نفس الاسم يُسمح في وجبات مختلفة، أو سناك مقابل صنف رئيسي، لكن مكرّر داخل
-- نفس الـbucket ممنوع. نتحقق أولاً من عدم وجود مكررات قبل الإنشاء؛ لو وُجدت
-- نطبع notice للمستخدم ونتخطى القيد بدل ما تنكسر الـmigration.
do $$
declare
  dup_count int;
begin
  select count(*) into dup_count
  from (
    select entity_type, type, is_snack, name
      from public.meals
     group by entity_type, type, is_snack, name
    having count(*) > 1
  ) d;

  if dup_count > 0 then
    raise notice
      'تم تخطّي قيد تفرّد الأصناف: يوجد % مجموعة بأسماء مكررة داخل نفس (entity_type, type, is_snack, name). نظّف المكررات يدوياً ثم أعد تشغيل هذا الملف لإضافة القيد.',
      dup_count;
  elsif not exists (select 1 from pg_constraint where conname = 'meals_entity_type_snack_name_unique') then
    alter table public.meals
      add constraint meals_entity_type_snack_name_unique
      unique (entity_type, type, is_snack, name);
  end if;
end$$;

create index if not exists idx_meals_entity_type on public.meals(entity_type);

-- 2) إضافة العمود لجدول قائمة الطعام
alter table public.menu_items
  add column if not exists entity_type text not null default 'beneficiary';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'menu_items_entity_type_check') then
    alter table public.menu_items
      add constraint menu_items_entity_type_check
      check (entity_type in ('beneficiary', 'companion'));
  end if;
end$$;

create index if not exists idx_menu_items_entity_type on public.menu_items(entity_type);

-- توحيد قيم entity_type على جدول menu_items مع نوع الصنف المرتبط:
-- لو الـmeal_id يخص فئة معينة فالـmenu_item يجب أن يكون لنفس الفئة.
-- (هذا تنظيف one-time للبيانات القديمة لو وُجد سجلات تخالف هذا الافتراض.)
update public.menu_items mi
   set entity_type = m.entity_type
  from public.meals m
 where mi.meal_id = m.id
   and mi.entity_type <> m.entity_type;
