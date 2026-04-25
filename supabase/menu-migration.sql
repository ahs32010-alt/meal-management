-- ============================================================================
-- Menu Migration
-- 1. Rename daily_orders.week_of_month → week_number
-- 2. Add daily_orders.day_of_week (so the order references a slot in the menu
--    independent of the calendar date)
-- 3. Create menu_items table — 4 weeks × 7 days × 3 meals × N items
-- 4. Update replace_order_items RPC to accept week_number + day_of_week
-- ============================================================================

-- ─── 1. Rename column (safe — only renames if old name still exists) ────────
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'daily_orders'
       and column_name  = 'week_of_month'
  ) and not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'daily_orders'
       and column_name  = 'week_number'
  ) then
    alter table public.daily_orders rename column week_of_month to week_number;
  end if;
end$$;

-- ─── 2. Add day_of_week column ──────────────────────────────────────────────
alter table public.daily_orders
  add column if not exists day_of_week smallint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'daily_orders_day_of_week_check') then
    alter table public.daily_orders
      add constraint daily_orders_day_of_week_check
      check (day_of_week is null or (day_of_week between 0 and 6));
  end if;
end$$;

-- ─── 3. menu_items table ────────────────────────────────────────────────────
create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  week_number smallint not null check (week_number between 1 and 4),
  day_of_week smallint not null check (day_of_week between 0 and 6),
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner')),
  meal_id uuid not null references public.meals(id) on delete cascade,
  category text not null check (category in ('hot', 'cold', 'snack')),
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (week_number, day_of_week, meal_type, meal_id)
);

create index if not exists menu_items_slot_idx
  on public.menu_items (week_number, day_of_week, meal_type);

alter table public.menu_items enable row level security;

drop policy if exists "Authenticated users full access - menu_items" on public.menu_items;
create policy "Authenticated users full access - menu_items"
  on public.menu_items for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ─── 4. Update RPC ──────────────────────────────────────────────────────────
-- Drop both old signatures (with smallint and the snapshot signature if any)
drop function if exists public.replace_order_items(uuid, date, text, smallint, jsonb);
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

revoke all on function public.replace_order_items(uuid, date, text, smallint, smallint, jsonb) from public;
grant execute on function public.replace_order_items(uuid, date, text, smallint, smallint, jsonb) to authenticated;
