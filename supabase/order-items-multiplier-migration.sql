-- ============================================================================
-- Order Items Multiplier Migration
-- يضيف عمود multiplier لكل صنف في أمر التشغيل (للحالات اللي يحتاج فيها
-- المستفيد ٢ أو ٣ حصص بدل واحدة، مثل الخبز).
-- ينعكس على عدد الإنتاج المطلوب فقط — الستيكرات والتقارير الفردية لا تتأثر.
-- ============================================================================

alter table public.order_items
  add column if not exists multiplier smallint not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'order_items_multiplier_check') then
    alter table public.order_items
      add constraint order_items_multiplier_check
      check (multiplier between 1 and 100);
  end if;
end$$;

-- Update RPC to persist the multiplier
drop function if exists public.replace_order_items(uuid, date, text, smallint, smallint, jsonb);

create or replace function public.replace_order_items(
  p_order_id uuid,
  p_date date,
  p_meal_type text,
  p_week_number smallint,
  p_day_of_week smallint,
  p_items jsonb
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_id uuid;
begin
  if p_meal_type not in ('breakfast', 'lunch', 'dinner') then
    raise exception 'invalid meal_type: %', p_meal_type;
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
    insert into public.daily_orders (date, meal_type, week_number, day_of_week)
    values (p_date, p_meal_type, p_week_number, p_day_of_week)
    returning id into v_id;
  else
    update public.daily_orders
       set date = p_date,
           meal_type = p_meal_type,
           week_number = p_week_number,
           day_of_week = p_day_of_week
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

revoke all on function public.replace_order_items(uuid, date, text, smallint, smallint, jsonb) from public;
grant execute on function public.replace_order_items(uuid, date, text, smallint, smallint, jsonb) to authenticated;
