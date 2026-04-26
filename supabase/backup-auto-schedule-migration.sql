-- ============================================================================
-- Backup Auto-Schedule Migration
-- يضيف:
--   1) دالة SQL  public.create_daily_backup()  تأخذ snapshot كامل وتحفظه في جدول backups
--   2) جدولة pg_cron تنفّذ الدالة كل يوم 23:59 توقيت السعودية (= 20:59 UTC)
--
-- يعتمد على:
--   - supabase/backup-system-migration.sql (لا بد منه قبل هذا الملف)
--   - extension اسمها pg_cron مفعّلة من:
--       Supabase Dashboard → Database → Extensions → ابحث عن "pg_cron" → Enable
--
-- ⚠️ لو pg_cron غير مفعّل، الـmigration ينفّذ الدالة فقط ويطبع تنبيه بدون كسر.
-- ============================================================================

-- ─── 1) الدالة ───────────────────────────────────────────────────────────────
-- تأخذ snapshot كامل لكل الجداول المعنية (نفس قائمة TS في BACKUP_TABLES)،
-- تدرجه في public.backups بنوع 'auto_daily'، وتحذف ما زاد عن آخر 3 نسخ تلقائية.

create or replace function public.create_daily_backup()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot jsonb;
  v_counts   jsonb;
  v_total    int := 0;
  -- per-table json arrays + counts (initialized to fallback values)
  j_meals jsonb := '[]'::jsonb;                    c_meals int := 0;
  j_beneficiaries jsonb := '[]'::jsonb;            c_beneficiaries int := 0;
  j_daily_orders jsonb := '[]'::jsonb;             c_daily_orders int := 0;
  j_custom_translit jsonb := '[]'::jsonb;          c_custom_translit int := 0;
  j_meal_alternatives jsonb := '[]'::jsonb;        c_meal_alternatives int := 0;
  j_exclusions jsonb := '[]'::jsonb;               c_exclusions int := 0;
  j_beneficiary_fixed jsonb := '[]'::jsonb;        c_beneficiary_fixed int := 0;
  j_menu_items jsonb := '[]'::jsonb;               c_menu_items int := 0;
  j_order_items jsonb := '[]'::jsonb;              c_order_items int := 0;
  j_sticker_splits jsonb := '[]'::jsonb;           c_sticker_splits int := 0;
begin
  -- نتجاهل بهدوء أي جدول غير موجود (لو ما اتشغّل migration مرتبط به)
  begin select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb), count(*) into j_meals, c_meals from public.meals t;
  exception when undefined_table then null; end;

  begin select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb), count(*) into j_beneficiaries, c_beneficiaries from public.beneficiaries t;
  exception when undefined_table then null; end;

  begin select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb), count(*) into j_daily_orders, c_daily_orders from public.daily_orders t;
  exception when undefined_table then null; end;

  begin select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb), count(*) into j_custom_translit, c_custom_translit from public.custom_transliterations t;
  exception when undefined_table then null; end;

  begin select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb), count(*) into j_meal_alternatives, c_meal_alternatives from public.meal_alternatives t;
  exception when undefined_table then null; end;

  begin select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb), count(*) into j_exclusions, c_exclusions from public.exclusions t;
  exception when undefined_table then null; end;

  begin select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb), count(*) into j_beneficiary_fixed, c_beneficiary_fixed from public.beneficiary_fixed_meals t;
  exception when undefined_table then null; end;

  begin select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb), count(*) into j_menu_items, c_menu_items from public.menu_items t;
  exception when undefined_table then null; end;

  begin select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb), count(*) into j_order_items, c_order_items from public.order_items t;
  exception when undefined_table then null; end;

  begin select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb), count(*) into j_sticker_splits, c_sticker_splits from public.sticker_splits t;
  exception when undefined_table then null; end;

  v_total := c_meals + c_beneficiaries + c_daily_orders + c_custom_translit
           + c_meal_alternatives + c_exclusions + c_beneficiary_fixed
           + c_menu_items + c_order_items + c_sticker_splits;

  v_snapshot := jsonb_build_object(
    'version', 1,
    'taken_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'tables', jsonb_build_object(
      'meals',                    j_meals,
      'beneficiaries',            j_beneficiaries,
      'daily_orders',             j_daily_orders,
      'custom_transliterations',  j_custom_translit,
      'meal_alternatives',        j_meal_alternatives,
      'exclusions',               j_exclusions,
      'beneficiary_fixed_meals',  j_beneficiary_fixed,
      'menu_items',               j_menu_items,
      'order_items',              j_order_items,
      'sticker_splits',           j_sticker_splits
    )
  );

  v_counts := jsonb_build_object(
    'meals',                    c_meals,
    'beneficiaries',            c_beneficiaries,
    'daily_orders',             c_daily_orders,
    'custom_transliterations',  c_custom_translit,
    'meal_alternatives',        c_meal_alternatives,
    'exclusions',               c_exclusions,
    'beneficiary_fixed_meals',  c_beneficiary_fixed,
    'menu_items',               c_menu_items,
    'order_items',              c_order_items,
    'sticker_splits',           c_sticker_splits
  );

  insert into public.backups (trigger_type, snapshot, summary, notes)
  values (
    'auto_daily',
    v_snapshot,
    jsonb_build_object('counts', v_counts, 'total_rows', v_total),
    'تم إنشاؤها آلياً عبر pg_cron الساعة ' ||
      to_char(now() at time zone 'Asia/Riyadh', 'HH24:MI') ||
      ' توقيت السعودية'
  );

  -- استبقاء آخر 3 نسخ تلقائية فقط (نفس سياسة AUTO_BACKUP_RETENTION في الكود)
  delete from public.backups
   where id in (
     select id from public.backups
      where trigger_type = 'auto_daily'
      order by created_at desc
      offset 3
   );
end;
$$;

revoke all on function public.create_daily_backup() from public;
grant execute on function public.create_daily_backup() to postgres;

-- ─── 2) جدولة pg_cron ────────────────────────────────────────────────────────
-- لو الـextension مش موجودة، نطبع تنبيه ونتخطى بدون كسر الـmigration.

do $$
declare
  v_jobid bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice E'⚠️ pg_cron غير مفعّل. الدالة جاهزة لكن ما رح تنفّذ تلقائياً.\n   فعّله من: Supabase Dashboard → Database → Extensions → "pg_cron" → Enable\n   ثم أعد تشغيل هذا الملف.';
    return;
  end if;

  -- إلغاء أي جدولة سابقة بنفس الاسم (يخلّي الـmigration idempotent)
  select jobid into v_jobid from cron.job where jobname = 'create-daily-backup';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;

  -- جدولة جديدة: الساعة 20:59 UTC = 23:59 توقيت السعودية (الفرق ثابت +3، لا DST)
  perform cron.schedule(
    'create-daily-backup',
    '59 20 * * *',
    $sql$ select public.create_daily_backup(); $sql$
  );

  raise notice E'✓ جُدِّلت النسخة التلقائية يومياً 23:59 توقيت السعودية\n  لتغيير الوقت: استخدم زرّ تعديل الوقت في صفحة "النسخ الاحتياطي" بالتطبيق،\n  أو استدع الدالة public.set_daily_backup_schedule(minute_utc, hour_utc).';
end$$;

-- ─── 3) RPC: قراءة الجدولة الحالية ───────────────────────────────────────────
-- يرجع الـcron expression الحالي للـjob إن وُجد. مفيد لعرض الوقت في الواجهة.
-- SECURITY DEFINER عشان نقدر نقرأ cron.job (المستخدم المسجّل ما عنده وصول مباشر).

create or replace function public.get_daily_backup_schedule()
returns table (schedule text, jobname text)
language plpgsql
security definer
set search_path = public, pg_temp, cron
as $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;
  return query
    select j.schedule::text, j.jobname::text
      from cron.job j
     where j.jobname = 'create-daily-backup';
end;
$$;

revoke all on function public.get_daily_backup_schedule() from public;
grant execute on function public.get_daily_backup_schedule() to authenticated;

-- ─── 4) RPC: تحديث وقت الجدولة ───────────────────────────────────────────────
-- p_hour_utc و p_minute_utc بالـUTC (يحوّلها العميل من توقيت السعودية).
-- مقتصرة على الأدمن: نتحقق من app_users.is_admin.

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
  perform cron.schedule(
    'create-daily-backup',
    v_expr,
    $sql$ select public.create_daily_backup(); $sql$
  );

  return v_expr;
end;
$$;

revoke all on function public.set_daily_backup_schedule(int, int) from public;
grant execute on function public.set_daily_backup_schedule(int, int) to authenticated;
