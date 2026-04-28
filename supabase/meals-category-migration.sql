-- إضافة عمود category إلى جدول meals لتركيز التصنيف (حار/بارد/سناك) على
-- الصنف نفسه، بدل تكراره في order_items, beneficiary_fixed_meals, menu_items.
-- هذا يحلّ تضارب الستيكرات (نفس الصنف يطلع حار وبارد).
--
-- الترقية آمنة: نضيف العمود مع قيمة افتراضية مبنية على is_snack،
-- ويمكن للمستخدم تعديلها لاحقاً من واجهة الأصناف.

alter table meals
  add column if not exists category text;

-- Backfill: السناكات تأخذ snack، الباقي يبدأ كـ hot (المستخدم يعدّلها للبارد لو احتاج)
update meals
   set category = case when is_snack then 'snack' else 'hot' end
 where category is null;

-- قيد الفحص — نسمح فقط بالقيم الثلاث المعروفة
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'meals_category_check') then
    alter table meals
      add constraint meals_category_check
      check (category in ('hot', 'cold', 'snack'));
  end if;
end $$;

-- لا نضع NOT NULL عشان نتفادى كسر إدخالات قديمة بدون category؛
-- التطبيق يُسند القيمة الافتراضية في الواجهة.
