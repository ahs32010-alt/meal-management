-- ============================================================================
-- Order Items Category Migration
-- يضيف فئة لكل صنف في أمر التشغيل: حار / بارد / سناك
-- يُستخدم لفصل الستيكرات تلقائياً حسب نوع الكيس
-- ============================================================================

-- 1) Add the category column with safe default
alter table public.order_items
  add column if not exists category text not null default 'hot';

-- 2) Constrain values
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'order_items_category_check') then
    alter table public.order_items
      add constraint order_items_category_check
      check (category in ('hot', 'cold', 'snack'));
  end if;
end$$;

-- 3) Backfill existing rows: snacks → 'snack', everything else stays as the default 'hot'
update public.order_items oi
   set category = 'snack'
  from public.meals m
 where oi.meal_id = m.id
   and m.is_snack = true
   and oi.category <> 'snack';

-- 4) Replace the RPC so new/edit-order paths persist the category
create or replace function public.replace_order_items(
  p_order_id uuid,
  p_date date,
  p_meal_type text,
  p_week_of_month smallint,
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

  if p_week_of_month is not null and (p_week_of_month < 1 or p_week_of_month > 4) then
    raise exception 'invalid week_of_month: %', p_week_of_month;
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'items must be a non-empty array';
  end if;

  if p_order_id is null then
    insert into public.daily_orders (date, meal_type, week_of_month)
    values (p_date, p_meal_type, p_week_of_month)
    returning id into v_id;
  else
    update public.daily_orders
       set date = p_date,
           meal_type = p_meal_type,
           week_of_month = p_week_of_month
     where id = p_order_id
    returning id into v_id;

    if v_id is null then
      raise exception 'order not found: %', p_order_id;
    end if;

    delete from public.order_items where order_id = v_id;
  end if;

  insert into public.order_items (order_id, meal_id, display_name, extra_quantity, category)
  select
    v_id,
    (item->>'meal_id')::uuid,
    nullif(item->>'display_name', ''),
    coalesce((item->>'extra_quantity')::int, 0),
    coalesce(nullif(item->>'category', ''), 'hot')
  from jsonb_array_elements(p_items) as item;

  return jsonb_build_object('order_id', v_id);
end;
$$;

revoke all on function public.replace_order_items(uuid, date, text, smallint, jsonb) from public;
grant execute on function public.replace_order_items(uuid, date, text, smallint, jsonb) to authenticated;

create index if not exists order_items_category_idx on public.order_items (category);
