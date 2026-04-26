-- ============================================================================
-- Companions Migration
-- يضيف عمود entity_type لجدول المستفيدين وأوامر التشغيل بحيث نقدر نخزن
-- "مرافقين" بنفس الجداول مع المستفيدين دون تكرار البنية.
--   - entity_type = 'beneficiary' (الافتراضي — كل البيانات الحالية تبقى كما هي)
--   - entity_type = 'companion'  (المرافقين)
--
-- ملاحظات:
-- 1) قيد التفرّد على الكود يصير لكل entity_type على حده، عشان نقدر نستخدم
--    نفس الكود في كلا الفئتين.
-- 2) قيد التفرّد على daily_orders يضيف entity_type عشان نقدر نسوي أمر تشغيل
--    لنفس اليوم/الوجبة لكلا الفئتين.
-- 3) دالة replace_order_items صار لها بارامتر اختياري p_entity_type،
--    والقيمة الافتراضية 'beneficiary' عشان الكود القديم يستمر يشتغل.
-- ============================================================================

-- 1) إضافة العمود لجدول المستفيدين
alter table public.beneficiaries
  add column if not exists entity_type text not null default 'beneficiary';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'beneficiaries_entity_type_check') then
    alter table public.beneficiaries
      add constraint beneficiaries_entity_type_check
      check (entity_type in ('beneficiary', 'companion'));
  end if;
end$$;

-- استبدال قيد التفرد على code ليكون لكل entity_type على حده
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'beneficiaries_code_key') then
    alter table public.beneficiaries drop constraint beneficiaries_code_key;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'beneficiaries_entity_code_unique') then
    alter table public.beneficiaries
      add constraint beneficiaries_entity_code_unique unique (entity_type, code);
  end if;
end$$;

create index if not exists idx_beneficiaries_entity_type on public.beneficiaries(entity_type);

-- 2) إضافة العمود لجدول أوامر التشغيل
alter table public.daily_orders
  add column if not exists entity_type text not null default 'beneficiary';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'daily_orders_entity_type_check') then
    alter table public.daily_orders
      add constraint daily_orders_entity_type_check
      check (entity_type in ('beneficiary', 'companion'));
  end if;
end$$;

-- استبدال قيد التفرد على (date, meal_type) ليشمل entity_type
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'daily_orders_date_meal_type_key') then
    alter table public.daily_orders drop constraint daily_orders_date_meal_type_key;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'daily_orders_date_meal_entity_unique') then
    alter table public.daily_orders
      add constraint daily_orders_date_meal_entity_unique unique (date, meal_type, entity_type);
  end if;
end$$;

create index if not exists idx_daily_orders_entity_type on public.daily_orders(entity_type);

-- 3) تحديث RPC ليدعم entity_type
-- ⚠️ نسقط النسخ القديمة بكل توقيعاتها الممكنة قبل ما نعيد الإنشاء.
drop function if exists public.replace_order_items(uuid, date, text, smallint, jsonb);
drop function if exists public.replace_order_items(uuid, date, text, smallint, smallint, jsonb);
drop function if exists public.replace_order_items(uuid, date, text, smallint, smallint, jsonb, text);

create or replace function public.replace_order_items(
  p_order_id uuid,
  p_date date,
  p_meal_type text,
  p_week_number smallint,
  p_day_of_week smallint,
  p_items jsonb,
  p_entity_type text default 'beneficiary'
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_id uuid;
  v_entity text;
begin
  if p_meal_type not in ('breakfast', 'lunch', 'dinner') then
    raise exception 'invalid meal_type: %', p_meal_type;
  end if;

  v_entity := coalesce(p_entity_type, 'beneficiary');
  if v_entity not in ('beneficiary', 'companion') then
    raise exception 'invalid entity_type: %', v_entity;
  end if;

  if p_week_number is not null and (p_week_number < 1 or p_week_number > 4) then
    raise exception 'invalid week_number: %', p_week_number;
  end if;
  if p_day_of_week is not null and (p_day_of_week < 0 or p_day_of_week > 6) then
    raise exception 'invalid day_of_week: %', p_day_of_week;
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'items must be a non-empty array';
  end if;

  if p_order_id is null then
    insert into public.daily_orders (date, meal_type, week_number, day_of_week, entity_type)
    values (p_date, p_meal_type, p_week_number, p_day_of_week, v_entity)
    returning id into v_id;
  else
    update public.daily_orders
       set date = p_date,
           meal_type = p_meal_type,
           week_number = p_week_number,
           day_of_week = p_day_of_week,
           entity_type = v_entity
     where id = p_order_id
    returning id into v_id;

    if v_id is null then
      raise exception 'order not found: %', p_order_id;
    end if;

    delete from public.order_items where order_id = v_id;
  end if;

  insert into public.order_items (order_id, meal_id, display_name, extra_quantity, category, multiplier)
  select
    v_id,
    (item->>'meal_id')::uuid,
    nullif(item->>'display_name', ''),
    coalesce((item->>'extra_quantity')::int, 0),
    coalesce(nullif(item->>'category', ''), 'hot'),
    greatest(1, least(100, coalesce((item->>'multiplier')::int, 1)))
  from jsonb_array_elements(p_items) as item;

  return jsonb_build_object('order_id', v_id);
end;
$$;

revoke all on function public.replace_order_items(uuid, date, text, smallint, smallint, jsonb, text) from public;
grant execute on function public.replace_order_items(uuid, date, text, smallint, smallint, jsonb, text) to authenticated;
