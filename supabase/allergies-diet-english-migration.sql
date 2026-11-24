-- ════════════════════════════════════════════════════════════════════════════
-- حساسيات وموانع المستفيد + الاسم الإنجليزي للنظام الغذائي
--
--   • beneficiaries.allergies     → خانة «حساسيات وموانع» في صفحة المستفيد،
--                                   وتُطبع في ستيكرات الغداء والعشاء
--   • diet_systems.english_name   → الاسم الإنجليزي للنظام، يُطبع تحت الاسم
--                                   العربي في ستيكرات الغداء والعشاء
--
-- آمن للتشغيل أكثر من مرة. شغّله في Supabase → SQL Editor.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.beneficiaries add column if not exists allergies text;
alter table public.diet_systems  add column if not exists english_name text;

-- تحديث كاش PostgREST عشان الأعمدة تظهر للتطبيق فوراً
notify pgrst, 'reload schema';
