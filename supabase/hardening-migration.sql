-- ============================================================
-- Hardening migration
-- 1. Atomic order replace (RPC) — replaces edit's "delete + insert" pattern
-- 2. Defensive RLS WITH CHECK clauses on all "for all" policies
-- 3. Length CHECK constraints on text columns to limit abuse
-- ============================================================

-- ─── 1. Atomic order replace ────────────────────────────────────────────────
-- Replaces all order_items for a given order in a single transaction so the
-- table is never observed in a half-deleted state.
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

  insert into public.order_items (order_id, meal_id, display_name, extra_quantity)
  select
    v_id,
    (item->>'meal_id')::uuid,
    nullif(item->>'display_name', ''),
    coalesce((item->>'extra_quantity')::int, 0)
  from jsonb_array_elements(p_items) as item;

  return jsonb_build_object('order_id', v_id);
end;
$$;

revoke all on function public.replace_order_items(uuid, date, text, smallint, jsonb) from public;
grant execute on function public.replace_order_items(uuid, date, text, smallint, jsonb) to authenticated;

-- ─── 2. Defensive RLS WITH CHECK on all "for all" policies ──────────────────
-- The existing policies use `using (auth.role() = 'authenticated')` without
-- WITH CHECK, which means INSERTs technically bypass the predicate. Add it.

drop policy if exists "Authenticated users full access - beneficiaries" on public.beneficiaries;
create policy "Authenticated users full access - beneficiaries"
  on public.beneficiaries for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated users full access - meals" on public.meals;
create policy "Authenticated users full access - meals"
  on public.meals for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated users full access - exclusions" on public.exclusions;
create policy "Authenticated users full access - exclusions"
  on public.exclusions for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated users full access - daily_orders" on public.daily_orders;
create policy "Authenticated users full access - daily_orders"
  on public.daily_orders for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated users full access - order_items" on public.order_items;
create policy "Authenticated users full access - order_items"
  on public.order_items for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated users full access - beneficiary_fixed_meals" on public.beneficiary_fixed_meals;
create policy "Authenticated users full access - beneficiary_fixed_meals"
  on public.beneficiary_fixed_meals for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "auth_all_sticker_splits" on public.sticker_splits;
create policy "auth_all_sticker_splits"
  on public.sticker_splits for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "auth_all_custom_transliterations" on public.custom_transliterations;
create policy "auth_all_custom_transliterations"
  on public.custom_transliterations for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ─── 3. Length constraints (protect against pathological input) ─────────────
-- Use DO blocks so the migration is idempotent.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'beneficiaries_name_len') then
    alter table public.beneficiaries
      add constraint beneficiaries_name_len check (char_length(name) between 1 and 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'beneficiaries_code_len') then
    alter table public.beneficiaries
      add constraint beneficiaries_code_len check (char_length(code) between 1 and 64);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'beneficiaries_notes_len') then
    alter table public.beneficiaries
      add constraint beneficiaries_notes_len check (notes is null or char_length(notes) <= 2000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'meals_name_len') then
    alter table public.meals
      add constraint meals_name_len check (char_length(name) between 1 and 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'order_items_display_name_len') then
    alter table public.order_items
      add constraint order_items_display_name_len check (display_name is null or char_length(display_name) <= 200);
  end if;
  -- extra_quantity can be negative by design (reduces auto-calculated total).
  -- Wide bounds protect against pathological values without breaking valid offsets.
  if not exists (select 1 from pg_constraint where conname = 'order_items_extra_qty_range') then
    alter table public.order_items
      add constraint order_items_extra_qty_range check (extra_quantity between -1000000 and 1000000);
  end if;
end$$;
