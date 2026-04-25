-- ============================================================================
-- Beneficiary Fixed Meals Category Migration
-- يضيف category لكل صنف ثابت في المستفيد، عشان يقدر يفصل في الستيكرات
-- بنفس آلية فصل الأصناف المستبعدة (حار/بارد/سناك → كيس مستقل).
-- ============================================================================

alter table public.beneficiary_fixed_meals
  add column if not exists category text not null default 'hot';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'beneficiary_fixed_meals_category_check') then
    alter table public.beneficiary_fixed_meals
      add constraint beneficiary_fixed_meals_category_check
      check (category in ('hot', 'cold', 'snack'));
  end if;
end$$;

-- Backfill: snacks → 'snack' (rest stays as the default 'hot')
update public.beneficiary_fixed_meals fm
   set category = 'snack'
  from public.meals m
 where fm.meal_id = m.id
   and m.is_snack = true
   and fm.category <> 'snack';
