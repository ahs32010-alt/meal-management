-- إضافة عمود approval_required للمستخدمين: لكل صفحة، نحدد أي إجراء (إضافة/
-- تعديل/حذف) يحتاج موافقة الأدمن قبل التنفيذ. مستقل عن permissions:
--   - permissions     → هل يستطيع المستخدم فعل الإجراء أصلاً (يظهر الزر؟)
--   - approval_required → لو يستطيع، هل يحتاج موافقة قبل التنفيذ؟
--
-- شكل القيمة: { "beneficiaries": { "add": true, "delete": true }, ... }
-- المفقود = false = مباشر بدون موافقة.

alter table public.app_users
  add column if not exists approval_required jsonb not null default '{}'::jsonb;
