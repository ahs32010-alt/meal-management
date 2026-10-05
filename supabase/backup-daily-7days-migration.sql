-- ============================================================================
-- Backup Daily (7 days) Migration — إصلاح النسخة التلقائية اليومية
--
-- المشكلة: جدولة pg_cron موجودة ('create-daily-backup' كل 23:59 بتوقيت
-- السعودية) لكن آخر نسخة نجحت كانت 2026-08-24 — المهمة تفشل كل ليلة بصمت،
-- وخطؤها لا يظهر إلا في cron.job_run_details الذي لا يصله التطبيق.
--
-- هذا الملف:
--   1) جدول backup_job_log — كل تشغيل للنسخة اليومية يُسجَّل فيه (نجاح/فشل
--      + رسالة الخطأ)، فلا يعود الفشل صامتاً وتعرضه صفحة النسخ الاحتياطي.
--   2) create_daily_backup() جديدة: نفس النسخة المنطقية + لقطة DB الكاملة،
--      بمهلة كافية، وتلتقط أي خطأ وتسجّله بدل ما تموت بصمت.
--   3) الاستبقاء: بعد كل نسخة ناجحة تُحذف النسخ «التلقائية» الأقدم من 7 أيام
--      — يبقى في النظام آخر 7 أيام فقط. اليدوية و«قبل الاستعادة» لا تُمسّ.
--   4) إعادة الجدولة: كل يوم 23:59 بتوقيت السعودية (20:59 UTC) والتأكد أنها مفعّلة.
--   5) backup_job_runs() — آخر تشغيلات المهمة من cron.job_run_details (للتشخيص).
--
-- ⚠️ آمن للتشغيل أكثر من مرة. لا يحذف إلا نسخاً تلقائية أقدم من 7 أيام.
-- يعتمد على: backup-system-migration.sql + backup-full-db-migration.sql
--            + backup-tables-coverage-migration.sql (backup_logical_tables)
-- يحتاج pg_cron مفعّلاً (Database → Extensions → pg_cron).
-- شغّله مرة واحدة في Supabase SQL Editor.
-- ============================================================================

-- ① سجل التشغيلات ------------------------------------------------------------
create table if not exists public.backup_job_log (
  id          bigserial primary key,
  ran_at      timestamptz not null default now(),
  ok          boolean not null,
  backup_id   uuid,
  total_rows  int,
  duration_ms int,
  deleted_old int,
  message     text
);
create index if not exists backup_job_log_ran_at_idx on public.backup_job_log (ran_at desc);

alter table public.backup_job_log enable row level security;
drop policy if exists "Authenticated read - backup_job_log" on public.backup_job_log;
create policy "Authenticated read - backup_job_log"
  on public.backup_job_log for select to authenticated using (true);

-- ② النسخة اليومية -------------------------------------------------------------
create or replace function public.create_daily_backup()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '10min'
as $$
declare
  v_started    timestamptz := clock_timestamp();
  v_tables     text[];
  v_table      text;
  v_rows       jsonb;
  v_count      int;
  v_tabledata  jsonb := '{}'::jsonb;
  v_counts     jsonb := '{}'::jsonb;
  v_total      int   := 0;
  v_full       jsonb;
  v_has_full   boolean;
  v_id         uuid;
  v_deleted    int := 0;
  v_warn       text := '';
begin
  begin
    v_tables := public.backup_logical_tables();

    foreach v_table in array v_tables loop
      begin
        execute format(
          'select coalesce(jsonb_agg(to_jsonb(t.*)), ''[]''::jsonb), count(*) from public.%I t',
          v_table
        ) into v_rows, v_count;
      exception
        when undefined_table then
          v_rows := '[]'::jsonb; v_count := 0;  -- جدول ترقيته ما اتشغّلت — صفر بدل الفشل
        when others then
          -- جدول واحد لا يُسقط النسخة كلها، لكن يُذكر في السجل
          v_rows := '[]'::jsonb; v_count := 0;
          v_warn := v_warn || v_table || ': ' || sqlerrm || '; ';
      end;
      v_tabledata := v_tabledata || jsonb_build_object(v_table, v_rows);
      v_counts    := v_counts    || jsonb_build_object(v_table, v_count);
      v_total     := v_total + v_count;
    end loop;

    -- لقطة DB الخام — شبكة أمان؛ فشلها لا يُسقط النسخة المنطقية
    begin
      v_full := public.dump_all_public_tables();
    exception when others then
      v_full := null;
    end;

    select exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'backups' and column_name = 'full_snapshot'
    ) into v_has_full;

    if v_has_full then
      insert into public.backups (trigger_type, snapshot, full_snapshot, summary, notes)
      values (
        'auto_daily',
        jsonb_build_object('version', 1,
          'taken_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'tables', v_tabledata),
        v_full,
        jsonb_build_object('counts', v_counts, 'total_rows', v_total),
        'نسخة تلقائية يومية ' || to_char(now() at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI') || ' بتوقيت السعودية'
      ) returning id into v_id;
    else
      insert into public.backups (trigger_type, snapshot, summary, notes)
      values (
        'auto_daily',
        jsonb_build_object('version', 1,
          'taken_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'tables', v_tabledata),
        jsonb_build_object('counts', v_counts, 'total_rows', v_total),
        'نسخة تلقائية يومية ' || to_char(now() at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI') || ' بتوقيت السعودية'
      ) returning id into v_id;
    end if;

    -- الاستبقاء: التلقائية الأقدم من 7 أيام فقط (بعد نجاح نسخة اليوم)
    delete from public.backups
     where trigger_type = 'auto_daily'
       and created_at < now() - interval '7 days';
    get diagnostics v_deleted = row_count;

    insert into public.backup_job_log (ok, backup_id, total_rows, duration_ms, deleted_old, message)
    values (true, v_id, v_total,
            (extract(epoch from clock_timestamp() - v_started) * 1000)::int, v_deleted,
            nullif(v_warn, ''));
  exception when others then
    -- أي فشل يُسجَّل بسببه بدل ما يضيع؛ لا نحذف شيئاً في هذه الحالة
    insert into public.backup_job_log (ok, duration_ms, message)
    values (false, (extract(epoch from clock_timestamp() - v_started) * 1000)::int,
            sqlstate || ': ' || sqlerrm);
  end;

  -- السجل نفسه يبقى صغيراً: آخر 90 يوماً
  delete from public.backup_job_log where ran_at < now() - interval '90 days';
end;
$$;

revoke all on function public.create_daily_backup() from public;
grant execute on function public.create_daily_backup() to postgres, service_role;

-- ③ الجدولة --------------------------------------------------------------------
do $$
declare
  v_jobid bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '⚠️ pg_cron غير مفعّل — فعّله من Database → Extensions ثم أعد تشغيل هذا الملف.';
    return;
  end if;
  select jobid into v_jobid from cron.job where jobname = 'create-daily-backup';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
  -- 23:59 بتوقيت السعودية = 20:59 UTC (لا توقيت صيفي في السعودية)
  perform cron.schedule('create-daily-backup', '59 20 * * *', $sql$ select public.create_daily_backup(); $sql$);
  raise notice '✓ النسخة التلقائية مجدولة يومياً 23:59 بتوقيت السعودية، ويُستبقى آخر 7 أيام.';
end$$;

-- ④ تشخيص: آخر تشغيلات المهمة كما سجّلها pg_cron --------------------------------
create or replace function public.backup_job_runs(p_limit int default 15)
returns table (start_time timestamptz, status text, return_message text)
language plpgsql
security definer
set search_path = public, pg_temp, cron
as $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;
  return query
    select d.start_time, d.status::text, d.return_message::text
      from cron.job_run_details d
      join cron.job j on j.jobid = d.jobid
     where j.jobname = 'create-daily-backup'
     order by d.start_time desc
     limit greatest(1, least(p_limit, 100));
end;
$$;

revoke all on function public.backup_job_runs(int) from public;
grant execute on function public.backup_job_runs(int) to service_role, authenticated;
