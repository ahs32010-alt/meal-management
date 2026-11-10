-- ============================================================================
-- Backup Nightly Fix Migration — إصلاح النسخة الليلية نهائياً
--
-- المشكلة: pg_cron يبدأ كل ليلة وينتهي بـ`server restarted` (مرة واحدة
-- statement timeout عند daily_orders). الدالة تجمع عمود daily_orders.snapshot
-- (لقطات التقارير، ٣٨٩ أمراً × مئات الكيلوبايت) داخل قيمة JSON واحدة مرتين،
-- وقاعدة البيانات تعيد التشغيل أثناءها. ولأن الانهيار يُلغي كل المعاملة، ما كان
-- يُسجَّل شيء في backup_job_log فبقي الفشل بلا أي تنبيه.
--
-- هذا الملف:
--   1) order_snapshot_archive — اللقطات تُحفظ صفاً بصف (بلا تجميع في الذاكرة)
--      وتُنسخ منها فقط اللقطات التي تغيّرت منذ آخر ليلة.
--   2) trigger يعيد اللقطة تلقائياً عند إدراج أمر بدونها — أي عند الاستعادة،
--      من الدالة الذرّية أو من مسار المتصفح.
--   3) النسخة المنطقية و dump_all_public_tables لا يقرآن عمود snapshot إطلاقاً.
--   4) create_daily_backup(): أي تعذّر في قراءة جدول يُفشل النسخة كلها بدل
--      حفظها ناقصة، و timeout يُسجَّل (when others لا يلتقطه).
--   5) run_daily_backup(): يسجّل «بدأت» ويثبّتها قبل التنفيذ، فلو انهارت القاعدة
--      يبقى السجل فاشلاً وتُظهره صفحة النسخ الاحتياطي.
--   6) الجدولة وزر تغيير الوقت يشغّلان run_daily_backup().
--
-- ⚠️ آمن للتشغيل أكثر من مرة. لا يحذف ولا يغيّر أي لقطة أو نسخة موجودة.
-- يعتمد على: backup-daily-7days-migration.sql + backup-tables-coverage-migration.sql
-- شغّله مرة واحدة في Supabase SQL Editor.
-- ============================================================================

-- ① أرشيف لقطات التقارير ------------------------------------------------------
-- بلا مفتاح أجنبي عمداً: الاستعادة تمسح daily_orders، والأرشيف لازم يبقى بعدها.
create table if not exists public.order_snapshot_archive (
  order_id    uuid primary key,
  snapshot    jsonb not null,
  snapshot_at timestamptz,
  archived_at timestamptz not null default now()
);

alter table public.order_snapshot_archive enable row level security;
drop policy if exists "Authenticated read - order_snapshot_archive" on public.order_snapshot_archive;
create policy "Authenticated read - order_snapshot_archive"
  on public.order_snapshot_archive for select to authenticated using (true);

-- ② إعادة اللقطة عند الاستعادة --------------------------------------------------
-- النسخ القديمة التي تحمل snapshot تمرّ كما هي؛ الأمر الجديد لا يجد شيئاً في الأرشيف.
create or replace function public.trg_daily_orders_restore_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.snapshot is null then
    select a.snapshot, a.snapshot_at
      into new.snapshot, new.snapshot_at
      from public.order_snapshot_archive a
     where a.order_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists daily_orders_restore_snapshot on public.daily_orders;
create trigger daily_orders_restore_snapshot
  before insert on public.daily_orders
  for each row execute function public.trg_daily_orders_restore_snapshot();

-- ③ مصدر صفوف الجدول في النسخة ---------------------------------------------------
-- قائمة أعمدة صريحة لـdaily_orders بدل حذف المفتاح بعد القراءة، حتى لا يُفكّ ضغط
-- اللقطات أصلاً. الأعمدة تُقرأ من الكتالوج فيدخل أي عمود جديد تلقائياً.
create or replace function public.backup_row_source(p_table text)
returns text
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_columns text;
begin
  if p_table <> 'daily_orders' then
    return format('public.%I', p_table);
  end if;
  select string_agg(quote_ident(column_name), ', ')
    into v_columns
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'daily_orders'
     and column_name <> 'snapshot';
  return format('(select %s from public.daily_orders)', v_columns);
end;
$$;

revoke all on function public.backup_row_source(text) from public, anon, authenticated;
grant execute on function public.backup_row_source(text) to postgres, service_role;

-- ④ اللقطة الخام بدون عمود snapshot وبدون الأرشيف -------------------------------
create or replace function public.dump_all_public_tables()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_table_name text;
  v_result jsonb := '{}'::jsonb;
  v_rows jsonb;
begin
  for v_table_name in
    select table_name
      from information_schema.tables
     where table_schema = 'public'
       and table_type = 'BASE TABLE'
       and table_name not in ('backups', 'order_snapshot_archive')
     order by table_name
  loop
    begin
      execute format(
        'select coalesce(jsonb_agg(to_jsonb(t.*)), ''[]''::jsonb) from %s t',
        public.backup_row_source(v_table_name)
      ) into v_rows;
    exception when others then
      -- لو فشل لأي سبب (قيود غير اعتيادية، نوع غير معروف...)، نسجّل array فاضي ونكمّل
      v_rows := '[]'::jsonb;
    end;
    v_result := v_result || jsonb_build_object(v_table_name, v_rows);
  end loop;
  return v_result;
end;
$$;

-- ⑤ النسخة اليومية ---------------------------------------------------------------
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
    -- اللقطات المتغيّرة فقط، صفاً بصف. `#-` يزيل التعشيش من الصفوف القديمة.
    insert into public.order_snapshot_archive (order_id, snapshot, snapshot_at)
    select o.id, o.snapshot #- '{order,snapshot}', o.snapshot_at
      from public.daily_orders o
      left join public.order_snapshot_archive a on a.order_id = o.id
     where o.snapshot is not null
       and (a.order_id is null or a.snapshot_at is distinct from o.snapshot_at)
    on conflict (order_id) do update
      set snapshot = excluded.snapshot,
          snapshot_at = excluded.snapshot_at,
          archived_at = now();

    v_tables := public.backup_logical_tables();

    foreach v_table in array v_tables loop
      begin
        execute format(
          'select coalesce(jsonb_agg(to_jsonb(t.*)), ''[]''::jsonb), count(*) from %s t',
          public.backup_row_source(v_table)
        ) into v_rows, v_count;
      exception
        when undefined_table then
          v_rows := '[]'::jsonb; v_count := 0;  -- جدول ترقيته ما اتشغّلت — صفر بدل الفشل
        -- أي خطأ آخر يصل للمعالج الخارجي: نسخة بلا جدول أخطر من عدم وجود نسخة
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
      v_warn := v_warn || 'full_snapshot: ' || sqlerrm || '; ';
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

    -- لقطات أوامر محذوفة من ٩٠ يوماً لم يعد لها استعادة محتملة
    delete from public.order_snapshot_archive a
     where a.archived_at < now() - interval '90 days'
       and not exists (select 1 from public.daily_orders o where o.id = a.order_id);

    insert into public.backup_job_log (ok, backup_id, total_rows, duration_ms, deleted_old, message)
    values (true, v_id, v_total,
            (extract(epoch from clock_timestamp() - v_started) * 1000)::int, v_deleted,
            nullif(v_warn, ''));
  exception
    -- when others لا يلتقط query_canceled، فنذكره صراحة
    when query_canceled then
      insert into public.backup_job_log (ok, duration_ms, message)
      values (false, (extract(epoch from clock_timestamp() - v_started) * 1000)::int,
              sqlstate || ': ' || sqlerrm);
    when others then
      -- أي فشل يُسجَّل بسببه بدل ما يضيع؛ لا نحذف شيئاً في هذه الحالة
      insert into public.backup_job_log (ok, duration_ms, message)
      values (false, (extract(epoch from clock_timestamp() - v_started) * 1000)::int,
              sqlstate || ': ' || sqlerrm);
  end;

  -- السجل نفسه يبقى صغيراً: آخر 90 يوماً
  delete from public.backup_job_log where ran_at < now() - interval '90 days';
end;
$$;

revoke all on function public.create_daily_backup() from public, anon, authenticated;
grant execute on function public.create_daily_backup() to postgres, service_role;

-- ⑥ غلاف التشغيل الليلي ----------------------------------------------------------
-- إجراء (procedure) لأن الدالة لا تقدر تعمل commit. بلا security definer وبلا
-- set لأن كليهما يمنع commit داخل الإجراء؛ pg_cron يشغّله كـpostgres أصلاً.
-- سطر «بدأت» يُثبَّت أولاً: لو انهارت القاعدة يبقى فشلاً مسجَّلاً، ولو انتهت
-- الدالة (نجاحاً أو فشلاً مسجَّلاً) يُحذف لأن سطرها أدق منه.
create or replace procedure public.run_daily_backup()
language plpgsql
as $$
declare
  v_log_id bigint;
begin
  insert into public.backup_job_log (ok, message)
  values (false, 'بدأت النسخة الليلية ولم تكتمل — انقطعت قاعدة البيانات أثناء التنفيذ')
  returning id into v_log_id;
  commit;

  perform public.create_daily_backup();

  delete from public.backup_job_log where id = v_log_id;
  commit;
end;
$$;

revoke all on procedure public.run_daily_backup() from public, anon, authenticated;
grant execute on procedure public.run_daily_backup() to postgres, service_role;

-- ⑦ الجدولة ----------------------------------------------------------------------
do $$
declare
  v_jobid bigint;
  v_expr  text := '59 20 * * *';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '⚠️ pg_cron غير مفعّل — فعّله من Database → Extensions ثم أعد تشغيل هذا الملف.';
    return;
  end if;
  -- نحافظ على الوقت الحالي لو غيّره المستخدم من صفحة النسخ الاحتياطي
  select jobid, schedule into v_jobid, v_expr from cron.job where jobname = 'create-daily-backup';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
  perform cron.schedule('create-daily-backup', coalesce(v_expr, '59 20 * * *'), $sql$ call public.run_daily_backup(); $sql$);
  raise notice '✓ النسخة الليلية تعمل الآن عبر run_daily_backup().';
end$$;

-- ⑧ زر تغيير الوقت — نفس التعريف السابق، لكن يجدول run_daily_backup() ----------------
create or replace function public.set_daily_backup_schedule(
  p_minute_utc int,
  p_hour_utc   int
) returns text
language plpgsql
security definer
set search_path = public, pg_temp, cron
as $$
declare
  v_jobid bigint;
  v_expr  text;
  v_uid   uuid;
  v_admin boolean;
begin
  -- التحقق من الصلاحية: المستخدم لازم يكون أدمن في app_users
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'unauthorized: no auth user';
  end if;
  begin
    select coalesce(is_admin, false) into v_admin
      from public.app_users where id = v_uid;
  exception when undefined_table then
    -- لو جدول app_users غير موجود، نسمح للمستخدمين المسجّلين
    v_admin := true;
  end;
  if not v_admin then
    raise exception 'unauthorized: admin required';
  end if;

  -- التحقق من المدخلات
  if p_minute_utc < 0 or p_minute_utc > 59 then
    raise exception 'invalid minute: %', p_minute_utc;
  end if;
  if p_hour_utc < 0 or p_hour_utc > 23 then
    raise exception 'invalid hour: %', p_hour_utc;
  end if;

  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron not enabled';
  end if;

  v_expr := format('%s %s * * *', p_minute_utc, p_hour_utc);

  -- إلغاء الجدولة السابقة (إن وُجدت)
  select jobid into v_jobid from cron.job where jobname = 'create-daily-backup';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;

  -- جدولة جديدة بالوقت الجديد
  perform cron.schedule('create-daily-backup', v_expr, $sql$ call public.run_daily_backup(); $sql$);

  return v_expr;
end;
$$;

revoke all on function public.set_daily_backup_schedule(int, int) from public;
grant execute on function public.set_daily_backup_schedule(int, int) to authenticated;
