-- ============================================================================
-- Beneficiary Sticker Flags Migration
-- يضيف ثلاثة خيارات (boolean) للمستفيد تظهر كرموز في ستيكرات الغداء والعشاء:
--   no_fish            → لا يفضل السمك            (رمز: معيّن ◈)
--   no_pasta_sandwich  → لا يفضل المكرونة ولا الساندويش (رمز: مربع مصمت ■)
--   low_carb           → قليل الكاربوهيدرات        (رمز: R داخل دائرة Ⓡ)
-- ============================================================================

alter table public.beneficiaries
  add column if not exists no_fish boolean not null default false,
  add column if not exists no_pasta_sandwich boolean not null default false,
  add column if not exists low_carb boolean not null default false;
