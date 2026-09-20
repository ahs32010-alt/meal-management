-- ============================================================================
-- Delivery Orders — Entity Type Migration — فئة أمر التسليم (مستفيدين/مرافقين)
-- شغّل هذا الملف بعد delivery-meals-migration.sql
--
-- يضيف عمود `entity_type` لأوامر التسليم عشان الأمر يعرف لأي فئة أُنشئ،
-- تماماً كما في daily_orders (أوامر التشغيل) و beneficiaries و meals.
--
-- الأوامر القائمة تُعتبر «مستفيدين» — هذا هو الوضع الذي أُنشئت فيه قبل
-- وجود الخيار، فالافتراض لا يغيّر معنى أي بيانات موجودة.
-- ============================================================================

alter table public.delivery_orders
  add column if not exists entity_type text not null default 'beneficiary';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'delivery_orders_entity_type_check'
      and conrelid = 'public.delivery_orders'::regclass
  ) then
    alter table public.delivery_orders
      add constraint delivery_orders_entity_type_check
      check (entity_type in ('beneficiary', 'companion'));
  end if;
end$$;

create index if not exists idx_delivery_orders_entity_type
  on public.delivery_orders(entity_type);
