-- Adds a manual "week of month" selection to daily orders (1 = الأسبوع الأول ... 4 = الرابع)
alter table public.daily_orders
  add column if not exists week_of_month smallint
  check (week_of_month is null or (week_of_month between 1 and 4));
