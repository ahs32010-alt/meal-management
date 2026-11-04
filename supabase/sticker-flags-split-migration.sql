-- ============================================================================
-- Sticker Flags Split — فصل «لا يفضل المكرونة ولا الساندويش» لخيارين
--
--   no_pasta     → لا يفضل المكرونة   (علامة: No M)
--   no_sandwich  → لا يفضل الساندويش  (علامة: No S)
--
-- من كان عليه الخيار القديم (no_pasta_sandwich) يُؤشَّر له الخياران الجديدان،
-- فلا يتغيّر شيء على ستيكراته. العمود القديم يبقى كما هو (لا يُقرأ بعد الآن)
-- احتياطاً — يمكن حذفه لاحقاً.
--
-- يعتمد على: beneficiary-sticker-flags-migration.sql
-- ⚠️ آمن للتشغيل أكثر من مرة. شغّله مرة واحدة في Supabase SQL Editor.
-- ============================================================================

alter table public.beneficiaries
  add column if not exists no_pasta boolean not null default false,
  add column if not exists no_sandwich boolean not null default false;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'beneficiaries' and column_name = 'no_pasta_sandwich'
  ) then
    update public.beneficiaries
       set no_pasta = true, no_sandwich = true
     where no_pasta_sandwich = true;
  end if;
end $$;
