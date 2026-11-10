-- ============================================================================
-- Order Snapshot Cleanup — إزالة اللقطات المتداخلة من daily_orders
--
-- buildOrderReport كان يحفظ اللقطة السابقة داخل الجديدة عند كل حفظ، فتراكمت
-- طبقات داخل snapshot -> order -> snapshot. ولا كود يقرأ هذه الطبقات.
--
-- ⚠️ شغّله بعد نشر إصلاح lib/order-report.ts، وإلا عاد التداخل مع أول حفظ.
--
-- يعالج ٥ أوامر كل دقيقة عبر pg_cron حتى لا يضغط قاعدة البيانات، ثم يلغي جدولته
-- بنفسه عند الانتهاء. يحذف الطبقات الداخلية فقط؛ اللقطة الحالية لكل أمر تبقى كما
-- هي، و snapshot_at لا يتغيّر. آمن للتشغيل أكثر من مرة.
-- شغّله مرة واحدة في Supabase SQL Editor.
-- ============================================================================

create or replace function public.strip_nested_order_snapshots(p_limit int default 5)
returns int
language plpgsql
security definer
set search_path = public, pg_temp, cron
as $$
declare
  v_updated int;
begin
  update public.daily_orders o
     set snapshot = o.snapshot #- '{order,snapshot}'
   where o.id in (
     select d.id
       from public.daily_orders d
      where jsonb_typeof(d.snapshot #> '{order,snapshot}') = 'object'
      limit p_limit
   );
  get diagnostics v_updated = row_count;

  -- انتهى التنظيف: المهمة تلغي نفسها
  if v_updated = 0 and exists (select 1 from cron.job where jobname = 'strip-order-snapshots') then
    perform cron.unschedule('strip-order-snapshots');
  end if;
  return v_updated;
end;
$$;

revoke all on function public.strip_nested_order_snapshots(int) from public, anon, authenticated;
grant execute on function public.strip_nested_order_snapshots(int) to postgres, service_role;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '⚠️ pg_cron غير مفعّل — فعّله من Database → Extensions ثم أعد تشغيل هذا الملف.';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'strip-order-snapshots') then
    perform cron.unschedule('strip-order-snapshots');
  end if;
  perform cron.schedule(
    'strip-order-snapshots',
    '* * * * *',
    $sql$ select public.strip_nested_order_snapshots(5); $sql$
  );
  raise notice '✓ بدأ التنظيف: ٥ أوامر كل دقيقة، ويتوقف من نفسه.';
end$$;
