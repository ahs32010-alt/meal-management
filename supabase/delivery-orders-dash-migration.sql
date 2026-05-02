-- ============================================================================
-- Delivery Orders — إضافة شرطة لرقم الأمر
-- شغّل هذا الملف بعد delivery-orders-renumber-migration.sql
--
-- يحوّل صيغة رقم الأمر من Delv.NNNN إلى Delv.-NNNN
-- ============================================================================

-- 1) تغيير الـDEFAULT للأرقام الجديدة
alter table public.delivery_orders
  alter column order_number set default
    ('Delv.-' || lpad(nextval('public.delivery_orders_seq')::text, 4, '0'));

-- 2) تحديث الأوامر الموجودة (Delv.0003 → Delv.-0003)
update public.delivery_orders
   set order_number = 'Delv.-' || substring(order_number from 6)
 where order_number like 'Delv.%'
   and order_number not like 'Delv.-%';
