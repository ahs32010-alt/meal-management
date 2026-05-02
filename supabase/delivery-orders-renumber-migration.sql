-- ============================================================================
-- Delivery Orders — Renumber + Default Signature Migration
-- شغّل هذا الملف بعد كل migrations أوامر التسليم السابقة
--
-- 1) تغيير صيغة رقم الأمر من DEL-{YYYY}-{NNNN} إلى Delv.{NNNN}
--    (إزالة السنة، استبدال DEL- بـ Delv.)
-- 2) تحديث الأوامر الموجودة لتأخذ الصيغة الجديدة
-- 3) إضافة عمود لتوقيع المنشئ الافتراضي في هيدر الطباعة
--    (يُرفع مرة واحدة من شاشة "بيانات الهيدر" ويظهر في كل أمر تلقائياً)
-- ============================================================================

-- 1) تغيير القيمة الافتراضية للأرقام الجديدة
alter table public.delivery_orders
  alter column order_number set default
    ('Delv.' || lpad(nextval('public.delivery_orders_seq')::text, 4, '0'));

-- 2) تحديث الأوامر السابقة (نأخذ الجزء الرقمي فقط ونعيد تشكيله)
update public.delivery_orders
   set order_number = 'Delv.' || lpad(split_part(order_number, '-', 3), 4, '0')
 where order_number like 'DEL-%';

-- 3) عمود توقيع المنشئ الافتراضي
alter table public.delivery_print_header
  add column if not exists default_creator_signature_url text;
