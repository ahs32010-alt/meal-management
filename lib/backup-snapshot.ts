'use client';

import type { SupabaseClient } from '@supabase/supabase-js';

// ─── أنواع البيانات ───────────────────────────────────────────────────────────

export type BackupTriggerType = 'auto_daily' | 'manual' | 'pre_restore';

// قائمة الجداول المحفوظة في النسخة الاحتياطية، بترتيب لا يضرّ بالـFKs عند الإدراج.
// ترتيب الإدراج:
//   1) meals (مرجع لكل شيء تقريباً)
//   2) beneficiaries (يشمل المستفيدين والمرافقين)
//   3) daily_orders (يجب أن يسبق order_items)
//   4) custom_transliterations (مستقل)
//   5) meal_alternatives (يعتمد على meals فقط)
//   6) exclusions (يعتمد على beneficiaries + meals)
//   7) beneficiary_fixed_meals (يعتمد على beneficiaries + meals)
//   8) menu_items (يعتمد على meals)
//   9) order_items (يعتمد على daily_orders + meals)
//  10) sticker_splits (يعتمد على daily_orders + beneficiaries)
export const BACKUP_TABLES = [
  'meals',
  'beneficiaries',
  'daily_orders',
  'custom_transliterations',
  'meal_alternatives',
  'exclusions',
  'beneficiary_fixed_meals',
  'menu_items',
  'order_items',
  'sticker_splits',
] as const;

export type BackupTableName = (typeof BACKUP_TABLES)[number];

export interface BackupSnapshot {
  // إصدار شكل البيانات — يساعد في الاستعادة لو غيّرنا الشكل لاحقاً
  version: 1;
  taken_at: string; // ISO timestamp
  tables: Record<BackupTableName, Record<string, unknown>[]>;
}

export interface BackupSummary {
  // عدّاد لكل جدول، يُستخدم في عرض القائمة دون تحميل الـsnapshot الكامل
  counts: Record<BackupTableName, number>;
  total_rows: number;
  // عدّاد الجداول في النسخة الكاملة من DB (لو وجدت)
  full_db_table_count?: number;
  full_db_total_rows?: number;
}

// لقطة DB كاملة وخام: { table_name: rows }
// تشمل كل الجداول في schema=public ماعدا backups نفسه (تجنّب recursion).
export type FullDbDump = Record<string, Record<string, unknown>[]>;

export interface BackupRow {
  id: string;
  created_at: string;
  trigger_type: BackupTriggerType;
  created_by_user_id: string | null;
  created_by_user_email: string | null;
  created_by_user_name: string | null;
  summary: BackupSummary | null;
  notes: string | null;
}

// عدد النسخ التلقائية التي نحتفظ بها (يُحذف ما زاد).
// النسخ اليدوية و pre_restore لا تُحذف تلقائياً (تُترك للمستخدم).
export const AUTO_BACKUP_RETENTION = 3;

// ─── إنشاء snapshot ──────────────────────────────────────────────────────────

const TABLE_SELECTS: Record<BackupTableName, string> = {
  meals: '*',
  beneficiaries: '*',
  daily_orders: '*',
  custom_transliterations: '*',
  meal_alternatives: '*',
  exclusions: '*',
  beneficiary_fixed_meals: '*',
  menu_items: '*',
  order_items: '*',
  sticker_splits: '*',
};

/**
 * يجمع لقطة كاملة من كل الجداول المعنية. يتجاهل بهدوء أي جدول/عمود غير
 * موجود (مثلاً لو ما اتشغّل migration بعد) — يُسجّل صفر صفوف لذلك الجدول.
 *
 * كذلك يحاول جلب لقطة DB كاملة عبر RPC `dump_all_public_tables` لو كانت
 * متاحة (تتطلّب backup-full-db-migration.sql مفعّل).
 */
export async function createSnapshot(supabase: SupabaseClient): Promise<{
  snapshot: BackupSnapshot;
  summary: BackupSummary;
  fullDb: FullDbDump | null;
}> {
  const tables: BackupSnapshot['tables'] = {} as BackupSnapshot['tables'];
  const counts: BackupSummary['counts'] = {} as BackupSummary['counts'];

  for (const t of BACKUP_TABLES) {
    try {
      const { data, error } = await supabase.from(t).select(TABLE_SELECTS[t]);
      if (error) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`backup: skipping ${t}:`, error.message);
        }
        tables[t] = [];
        counts[t] = 0;
        continue;
      }
      const rows = (data ?? []) as unknown as Record<string, unknown>[];
      tables[t] = rows;
      counts[t] = rows.length;
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`backup: error fetching ${t}:`, err);
      }
      tables[t] = [];
      counts[t] = 0;
    }
  }

  const total = Object.values(counts).reduce((s, n) => s + n, 0);

  // محاولة جلب لقطة DB كاملة عبر RPC. لو الدالة غير موجودة (الـmigration
  // الجديد ما اتشغّل بعد) نتجاهل بهدوء — النسخة المنطقية تكفي كحدّ أدنى.
  let fullDb: FullDbDump | null = null;
  let fullTableCount: number | undefined;
  let fullTotalRows: number | undefined;
  try {
    const { data, error } = await supabase.rpc('dump_all_public_tables');
    if (!error && data) {
      fullDb = data as FullDbDump;
      fullTableCount = Object.keys(fullDb).length;
      fullTotalRows = Object.values(fullDb).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0);
    } else if (error && process.env.NODE_ENV !== 'production') {
      console.warn('backup: dump_all_public_tables not available:', error.message);
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('backup: dump_all_public_tables threw:', err);
    }
  }

  return {
    snapshot: {
      version: 1,
      taken_at: new Date().toISOString(),
      tables,
    },
    summary: {
      counts,
      total_rows: total,
      ...(fullTableCount != null ? { full_db_table_count: fullTableCount } : {}),
      ...(fullTotalRows != null ? { full_db_total_rows: fullTotalRows } : {}),
    },
    fullDb,
  };
}

// ─── حفظ النسخة + استبقاء الأقدم ─────────────────────────────────────────────

interface SaveBackupOptions {
  triggerType: BackupTriggerType;
  user?: { id: string; email: string | null; name: string | null } | null;
  notes?: string | null;
}

export async function saveBackup(
  supabase: SupabaseClient,
  snapshot: BackupSnapshot,
  summary: BackupSummary,
  opts: SaveBackupOptions & { fullDb?: FullDbDump | null },
): Promise<{ id: string }> {
  const payload: Record<string, unknown> = {
    trigger_type: opts.triggerType,
    created_by_user_id: opts.user?.id ?? null,
    created_by_user_email: opts.user?.email ?? null,
    created_by_user_name: opts.user?.name ?? null,
    snapshot,
    summary,
    notes: opts.notes ?? null,
  };
  // لو لقطة DB الكاملة متاحة، نخزّنها. ولو العمود غير موجود (الـmigration الجديد
  // ما اتشغّل) نعيد المحاولة بدونها بدل ما نوقف الحفظ.
  if (opts.fullDb) payload.full_snapshot = opts.fullDb;

  let { data, error } = await supabase
    .from('backups')
    .insert(payload)
    .select('id')
    .single();
  if (error && /full_snapshot|column/i.test(error.message)) {
    delete payload.full_snapshot;
    ({ data, error } = await supabase.from('backups').insert(payload).select('id').single());
  }
  if (error) throw error;
  if (!data) throw new Error('insert returned no data');

  // استبقاء آخر N تلقائية فقط (اليدوية و pre_restore تُترك للمستخدم).
  if (opts.triggerType === 'auto_daily') {
    await pruneOldAutoBackups(supabase);
  }

  return { id: data.id };
}

async function pruneOldAutoBackups(supabase: SupabaseClient): Promise<void> {
  const { data } = await supabase
    .from('backups')
    .select('id, created_at')
    .eq('trigger_type', 'auto_daily')
    .order('created_at', { ascending: false });

  const list = (data ?? []) as { id: string; created_at: string }[];
  if (list.length <= AUTO_BACKUP_RETENTION) return;

  const toDelete = list.slice(AUTO_BACKUP_RETENTION).map(b => b.id);
  if (toDelete.length === 0) return;
  await supabase.from('backups').delete().in('id', toDelete);
}

// ─── فحص آخر نسخة احتياطية ───────────────────────────────────────────────────

/**
 * يرجع true لو يوجد نسخة احتياطية أُخذت خلال آخر `hours` ساعة (أي نوع كان).
 *
 * سبب الاعتماد على نافذة بالساعات بدل "اليوم": لو الـpg_cron جدولة 23:59
 * أخذت نسخة، فلازم تخطّيها على مدار 23 ساعة حتى ما يحصل تكرار من فحص
 * تحميل الصفحة في اليوم التالي.
 */
export async function hasRecentBackup(
  supabase: SupabaseClient,
  hours: number,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  const { count } = await supabase
    .from('backups')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', cutoff.toISOString());
  return (count ?? 0) > 0;
}

/**
 * @deprecated استخدم hasRecentBackup(supabase, hours) بدلاً منها.
 * مُحتفظ به للتوافق فقط.
 */
export async function hasBackupToday(supabase: SupabaseClient): Promise<boolean> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const { count } = await supabase
    .from('backups')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', startOfDay.toISOString());
  return (count ?? 0) > 0;
}

// ─── جدولة pg_cron — قراءة/تحديث ─────────────────────────────────────────────

// التوقيت في الواجهة بتوقيت السعودية (UTC+3 ثابت بدون DST).
export const KSA_OFFSET_HOURS = 3;

export interface ScheduleInfo {
  enabled: boolean;
  cronExpr?: string;
  // الوقت بتوقيت السعودية كما يعرضه المستخدم
  hourKSA?: number;
  minute?: number;
  // الوقت بـUTC كما هو مخزّن في pg_cron
  hourUTC?: number;
}

/**
 * يقرأ الجدولة الحالية من pg_cron ويحوّلها لتوقيت السعودية للعرض.
 * يرجع enabled=false لو pg_cron غير مفعّل أو الجدولة لم تُنشأ بعد.
 */
export async function getBackupSchedule(supabase: SupabaseClient): Promise<ScheduleInfo> {
  try {
    const { data, error } = await supabase.rpc('get_daily_backup_schedule');
    if (error) {
      // الدالة غير موجودة → الـmigration ما اتشغّل
      if (/function .* does not exist|does not exist/i.test(error.message)) {
        return { enabled: false };
      }
      return { enabled: false };
    }
    const rows = (data as Array<{ schedule?: string }> | null) ?? [];
    if (rows.length === 0 || !rows[0].schedule) return { enabled: false };
    const expr = rows[0].schedule!;
    // الصيغة: "MM HH * * *"
    const m = expr.trim().match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+\*$/);
    if (!m) return { enabled: true, cronExpr: expr };
    const minute = parseInt(m[1], 10);
    const hourUTC = parseInt(m[2], 10);
    const hourKSA = (hourUTC + KSA_OFFSET_HOURS) % 24;
    return { enabled: true, cronExpr: expr, hourKSA, hourUTC, minute };
  } catch {
    return { enabled: false };
  }
}

/**
 * يحدّث وقت الجدولة. يأخذ الساعة والدقيقة بتوقيت السعودية ويحوّلها لـUTC قبل
 * إرسالها للـRPC (لأن pg_cron يعمل بـUTC).
 */
export async function setBackupSchedule(
  supabase: SupabaseClient,
  hourKSA: number,
  minute: number,
): Promise<{ cronExpr: string }> {
  if (hourKSA < 0 || hourKSA > 23) throw new Error('الساعة يجب أن تكون بين 0 و 23');
  if (minute < 0 || minute > 59) throw new Error('الدقيقة يجب أن تكون بين 0 و 59');

  // تحويل من توقيت السعودية إلى UTC: نطرح 3 ساعات (مع لفّ اليوم).
  const hourUTC = (hourKSA - KSA_OFFSET_HOURS + 24) % 24;

  const { data, error } = await supabase.rpc('set_daily_backup_schedule', {
    p_minute_utc: minute,
    p_hour_utc: hourUTC,
  });
  if (error) {
    if (/pg_cron not enabled/i.test(error.message)) {
      throw new Error('pg_cron غير مفعّل. فعّله من Supabase Dashboard → Database → Extensions.');
    }
    if (/unauthorized/i.test(error.message)) {
      throw new Error('غير مصرّح: يحتاج صلاحية مدير.');
    }
    throw error;
  }
  return { cronExpr: (data as string) ?? `${minute} ${hourUTC} * * *` };
}

// ─── الاستعادة من snapshot ───────────────────────────────────────────────────

/**
 * يستعيد محتوى snapshot كاملاً إلى قاعدة البيانات.
 *
 * ⚠️ عملية مدمّرة: تحذف بيانات الجداول المعنية الحالية وتعيد إدخال محتوى الـsnapshot.
 * المستخدمون والصلاحيات وسجل النشاط لا تتأثر.
 *
 * يُفترض أن المُستدعي قد أنشأ نسخة pre_restore قبل النداء كنقطة استرجاع.
 */
export async function restoreFromSnapshot(
  supabase: SupabaseClient,
  snapshot: BackupSnapshot,
): Promise<{ inserted: Record<BackupTableName, number>; warnings: string[] }> {
  const warnings: string[] = [];
  const inserted: Record<BackupTableName, number> = {} as Record<BackupTableName, number>;

  // 1) محو البيانات الحالية. نمسح الجداول الأم أولاً، والتعليقات FKs ON DELETE CASCADE
  //    تتولّى تنظيف الجداول التابعة. الجداول المستقلة نحذفها صراحة.
  //    ترتيب الحذف:
  //      a) order_items (يحذف بقاء سواء كان عبر cascade أو مباشرة)
  //      b) sticker_splits
  //      c) daily_orders
  //      d) menu_items
  //      e) beneficiary_fixed_meals
  //      f) exclusions
  //      g) meal_alternatives
  //      h) beneficiaries
  //      i) meals
  //      j) custom_transliterations
  const wipeOrder: BackupTableName[] = [
    'order_items',
    'sticker_splits',
    'daily_orders',
    'menu_items',
    'beneficiary_fixed_meals',
    'exclusions',
    'meal_alternatives',
    'beneficiaries',
    'meals',
    'custom_transliterations',
  ];
  // كل الجداول الـ10 عندها عمود id (تحقّقتُ من المخططات). نستخدم فلتر
  // صادق دائماً (not id is null) كبديل عن delete بدون where (الذي يحجبه supabase-js).
  for (const t of wipeOrder) {
    const { error } = await supabase.from(t).delete().not('id', 'is', null);
    if (error) {
      warnings.push(`فشل مسح ${t}: ${error.message}`);
    }
  }

  // 2) إعادة الإدراج بالترتيب الصحيح (BACKUP_TABLES مرتب أصلاً)
  //    نقطّع كل جدول إلى دفعات (chunks) لتفادي حدود الحجم.
  const CHUNK = 100;
  for (const t of BACKUP_TABLES) {
    const rows = snapshot.tables[t] ?? [];
    inserted[t] = 0;
    if (rows.length === 0) continue;

    // قد يكون الـsnapshot الأصلي يحوي أعمدة لا توجد بعد في DB الحالية
    // (أو العكس). الـinsert في supabase-js مرن مع الأعمدة الموجودة، لكن لو
    // فشل فلربما هناك عمود ناقص — نعرض تحذيراً ونكمّل.
    for (let c = 0; c < rows.length; c += CHUNK) {
      const slice = rows.slice(c, c + CHUNK);
      const { error } = await supabase.from(t).insert(slice);
      if (error) {
        // إعادة المحاولة صفّاً صفّاً لتحديد الخطأ، ثم تسجيل تحذير.
        let okCount = 0;
        for (const r of slice) {
          const { error: oneErr } = await supabase.from(t).insert(r);
          if (oneErr) {
            warnings.push(`${t}: ${oneErr.message.slice(0, 120)}`);
          } else {
            okCount++;
          }
        }
        inserted[t] += okCount;
      } else {
        inserted[t] += slice.length;
      }
    }
  }

  return { inserted, warnings };
}

// ─── حذف نسخة محددة ──────────────────────────────────────────────────────────

export async function deleteBackup(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('backups').delete().eq('id', id);
  if (error) throw error;
}

// ─── جلب سطر النسخة كامل (للاستعادة/التنزيل) ─────────────────────────────────

export async function fetchFullBackup(
  supabase: SupabaseClient,
  id: string,
): Promise<{
  snapshot: BackupSnapshot;
  fullDb: FullDbDump | null;
  summary: BackupSummary | null;
  row: BackupRow;
}> {
  const { data, error } = await supabase
    .from('backups')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  if (!data) throw new Error('النسخة غير موجودة');

  const snap = data.snapshot as BackupSnapshot;
  const fullDb = (data.full_snapshot as FullDbDump | null | undefined) ?? null;
  return {
    snapshot: snap,
    fullDb,
    summary: (data.summary as BackupSummary | null) ?? null,
    row: {
      id: data.id,
      created_at: data.created_at,
      trigger_type: data.trigger_type,
      created_by_user_id: data.created_by_user_id,
      created_by_user_email: data.created_by_user_email,
      created_by_user_name: data.created_by_user_name,
      summary: data.summary,
      notes: data.notes,
    },
  };
}
