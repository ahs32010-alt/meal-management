-- ============================================================================
-- Diet Systems — لون ستيكر الغداء والعشاء داخل النظام الغذائي نفسه
--
-- color: لون خلفية ستيكر من عنده هذا النظام (Hex مثل #FFC000)، أو null = أبيض.
-- من عنده أكثر من نظام ملوّن ← ستيكره ينقسم أشرطة أفقية بألوان أنظمته.
--
-- الألوان القديمة (lunch_dinner_diet_colors — كانت مربوطة بنص النظام المكتوب
-- باليد) ما عاد تُقرأ. لو اسم نظام أساسي يطابق نصاً قديماً بالضبط ينتقل لونه
-- (أول لون فقط) للنظام. الجدول القديم يبقى كما هو احتياطاً.
--
-- يعتمد على: diet-systems-migration.sql
-- ⚠️ آمن للتشغيل أكثر من مرة. شغّله مرة واحدة في Supabase SQL Editor.
-- ============================================================================

alter table public.diet_systems
  add column if not exists color text;

do $$
begin
  if to_regclass('public.lunch_dinner_diet_colors') is not null then
    update public.diet_systems ds
       set color = split_part(c.color, ',', 1)
      from public.lunch_dinner_diet_colors c
     where ds.color is null
       and trim(c.diet_type) = trim(ds.name)
       and coalesce(trim(c.color), '') <> '';
  end if;
end $$;
