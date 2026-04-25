-- ============================================================================
-- Menu Multiplier Migration
-- يضيف عمود multiplier على menu_items — يظهر في صفحة قائمة الطعام جنب
-- كل صنف، وينعكس تلقائياً على أمر التشغيل لما يُعبَّأ من المنيو.
-- ============================================================================

alter table public.menu_items
  add column if not exists multiplier smallint not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'menu_items_multiplier_check') then
    alter table public.menu_items
      add constraint menu_items_multiplier_check
      check (multiplier between 1 and 100);
  end if;
end$$;
