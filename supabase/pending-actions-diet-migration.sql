-- طلبات الموافقة على «الأنظمة الغذائية»: نوسّع قيد entity_type عشان يقبل
-- 'diet'. بدون هذا الملف، طلب المستخدم المقيَّد بالموافقة على صفحة الأنظمة
-- يُرفض من القاعدة ولا يوصل لصفحة الموافقات. (idempotent — آمن تشغيله أكثر من مرة)

alter table pending_actions drop constraint if exists pending_actions_entity_type_check;
alter table pending_actions add constraint pending_actions_entity_type_check
  check (entity_type in ('beneficiary', 'companion', 'meal', 'menu_item', 'diet'));
