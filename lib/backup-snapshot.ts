'use client';

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/fetch-all';

// ─── أنواع البيانات ───────────────────────────────────────────────────────────

export type BackupTriggerType = 'auto_daily' | 'manual' | 'pre_restore';

/**
 * كل جداول البيانات المحفوظة في النسخة الاحتياطية، **بترتيب إدراج يحترم
 * المفاتيح الخارجية** (الجدول المرجعي قبل التابع له).
 *
 * ⚠️ هذه القائمة هي نفسها ترتيب الاستعادة. أي جدول ناقص هنا:
 *   • لا يُحفظ في النسخة، و
 *   • لا يُستعاد بعد المسح — أي يُفقد نهائياً عند أي استعادة.
 * كان ينقصها: meal_alternatives (مذكور في التعليق ومنسي من القائمة)، ومنظومة
 * التكاليف كاملة (الوحدات/المواد/الوصفات/الأسعار/تجميد التكلفة)، وألوان
 * الأنظمة الغذائية لستيكرات الغداء والعشاء.
 *
 * غير مشمول عمداً: backups (تفادي التكرار)، app_users و activity_log
 * (المستخدمون والصلاحيات والسجل لا تتأثر بالاستعادة)، pending_actions
 * (طابور موافقات لحظي — استعادته تُحيي طلبات قديمة)، telegram_* (ربط حسابات
 * تيليجرام بالمستخدمين — يتبع app_users). اختبار tests/backup-coverage.test.ts
 * يفشل لو أُنشئ جدول جديد في supabase/*.sql ولم يدخل هنا أو في الاستثناءات.
 *
 * ⚠️ قائمة السيرفر backup_logical_tables() (للنسخ التلقائية والاستعادة الذرّية)
 * لازم تطابقها حرفياً — آخر تعريف في supabase/backup-menu-overrides-coverage-migration.sql.
 */
export const BACKUP_TABLES = [
  // ── جداول مستقلة (لا تعتمد على غيرها) ──
  'meals',
  'beneficiaries',
  'daily_orders',
  'custom_transliterations',
  'lunch_dinner_diet_colors',
  'cost_units',
  'cities',
  'delivery_meals',
  'delivery_creators',
  'delivery_print_header',
  'sticker_settings',
  'diet_systems',
  // ── تابعة لـ meals / beneficiaries ──
  'meal_alternatives',
  'diet_system_exclusions', // ← diet_systems + meals
  'beneficiary_diets',      // ← beneficiaries + diet_systems
  'exclusions',             // ← … + diet_systems (diet_id)
  'beneficiary_fixed_meals',
  'fixed_extras_manual',    // ← meals (أصناف حصر الإضافات اليدوية)
  'beneficiary_menu_overrides', // ← beneficiaries + meals + menu_items (قرارات الخانة)
  'menu_items',
  'order_items',
  'sticker_splits',
  // ── منظومة التكاليف ──
  'raw_materials',        // ← cost_units
  'meal_recipe_items',    // ← meals + raw_materials + cost_units
  'meal_pricing',         // ← meals
  'order_cost_snapshots', // ← daily_orders
  // ── منظومة أوامر التسليم ──
  'delivery_locations',   // ← cities
  'delivery_orders',      // ← delivery_locations + daily_orders + delivery_creators
  'delivery_order_items', // ← delivery_orders
] as const;

export type BackupTableName = (typeof BACKUP_TABLES)[number];

/**
 * اسم عربي لكل جدول — يُعرض في قائمة النسخ وفي ورقة Meta داخل ملف Excel.
 * النوع Record<BackupTableName, …> يُجبر على إضافة اسم لأي جدول جديد؛ القائمة
 * السابقة في الواجهة توقفت عند ٩ جداول فكانت البقية تظهر بأسمائها الإنجليزية.
 */
export const BACKUP_TABLE_LABELS: Record<BackupTableName, string> = {
  meals: 'الأصناف',
  beneficiaries: 'المستفيدون والمرافقون',
  daily_orders: 'أوامر التشغيل',
  custom_transliterations: 'الترجمة الحرفية',
  lunch_dinner_diet_colors: 'ألوان الأنظمة (ستيكرات الغداء والعشاء)',
  cost_units: 'وحدات القياس',
  cities: 'المدن',
  delivery_meals: 'أصناف التسليم',
  delivery_creators: 'منشئو أوامر التسليم',
  delivery_print_header: 'ترويسة طباعة التسليم',
  sticker_settings: 'إعدادات الستيكرات',
  diet_systems: 'الأنظمة الغذائية',
  meal_alternatives: 'بدائل الأصناف',
  diet_system_exclusions: 'استبعادات الأنظمة الغذائية',
  beneficiary_diets: 'أنظمة المستفيدين',
  exclusions: 'المحظورات',
  beneficiary_fixed_meals: 'الأصناف الثابتة',
  fixed_extras_manual: 'الإضافات الثابتة اليدوية',
  beneficiary_menu_overrides: 'تعديلات منيو المستفيدين',
  menu_items: 'بنود قائمة الطعام',
  order_items: 'أصناف أوامر التشغيل',
  sticker_splits: 'فصل الستيكرات',
  raw_materials: 'المواد الأولية',
  meal_recipe_items: 'الوصفات',
  meal_pricing: 'أسعار البيع',
  order_cost_snapshots: 'التكاليف المجمّدة',
  delivery_locations: 'مواقع التسليم',
  delivery_orders: 'أوامر التسليم',
  delivery_order_items: 'أصناف أوامر التسليم',
};

/**
 * الجداول الغائبة كلياً عن لقطة (مفتاحها غير موجود) — نسخة أُخذت قبل إضافة
 * الجدول، أو نسخة pg_cron من دالة SQL قديمة. الاستعادة منها تُفرغ الجدول
 * الحالي (أو يُفرَّغ بالـcascade من meals/beneficiaries)، فنحذّر صراحة.
 */
export function snapshotMissingTables(snapshot: Pick<BackupSnapshot, 'tables'>): BackupTableName[] {
  const tables = (snapshot.tables ?? {}) as Record<string, unknown>;
  return BACKUP_TABLES.filter(t => !Array.isArray(tables[t]));
}

/**
 * صفوف الجدول كما تُدرَج في مسار الاستعادة من المتصفح (غير الذرّي).
 * صفوف exclusions المشتقة من نظام غذائي (diet_id ≠ null) تُستبعد: الـtriggers
 * تعيد بنائها تلقائياً عند إدراج beneficiary_diets والمحظورات الشخصية، وإدراجها
 * يدوياً يصطدم بالقيد الفريد (beneficiary_id, meal_id) ويُغرق النتيجة بتحذيرات.
 * (الدالة الذرّية على السيرفر توقف المزامنة وتُدرجها كما هي.)
 */
export function rowsForClientInsert(
  table: BackupTableName,
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  if (table === 'exclusions') return rows.filter(r => r.diet_id == null);
  return rows;
}

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
  /**
   * نتيجة التحقّق: مقارنة ما حُفظ فعلاً مع count(*) الحقيقي لكل جدول.
   * أي فرق يعني نسخة ناقصة — وهي أخطر من عدم وجود نسخة، لأن الاستعادة منها
   * تمسح الموجود. نخزّنه مع النسخة ليبقى الدليل محفوظاً.
   */
  verified?: boolean;
  verify_issues?: string[];
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

// مدة الاحتفاظ بالنسخ التلقائية بالأيام — الأقدم تُحذف (نفس سياسة
// create_daily_backup في backup-daily-7days-migration.sql).
// النسخ اليدوية و pre_restore لا تُحذف تلقائياً (تُترك للمستخدم).
export const AUTO_BACKUP_RETENTION_DAYS = 7;

// ─── إنشاء snapshot ──────────────────────────────────────────────────────────

/**
 * العمود المفتاحي لكل جدول — يُستخدم لترتيب القراءة على دفعات (شرط ألا تتكرر
 * أو تُفقد صفوف بين الدفعات) وكشرط «صادق دائماً» عند المسح قبل الاستعادة.
 * معظم الجداول مفتاحها `id`، وهذان الاثنان مفتاحهما مختلف تماماً.
 */
const TABLE_KEY: Record<BackupTableName, string> = {
  meals: 'id',
  beneficiaries: 'id',
  daily_orders: 'id',
  custom_transliterations: 'id',
  lunch_dinner_diet_colors: 'diet_type',
  cost_units: 'id',
  cities: 'id',
  delivery_meals: 'id',
  delivery_creators: 'id',
  delivery_print_header: 'id',
  sticker_settings: 'id',
  diet_systems: 'id',
  diet_system_exclusions: 'id',
  beneficiary_diets: 'id',
  meal_alternatives: 'id',
  exclusions: 'id',
  beneficiary_fixed_meals: 'id',
  fixed_extras_manual: 'id',
  beneficiary_menu_overrides: 'id',
  menu_items: 'id',
  order_items: 'id',
  sticker_splits: 'id',
  raw_materials: 'id',
  meal_recipe_items: 'id',
  meal_pricing: 'meal_id',
  order_cost_snapshots: 'id',
  delivery_locations: 'id',
  delivery_orders: 'id',
  delivery_order_items: 'id',
};

/**
 * يجمع لقطة كاملة من كل الجداول المعنية. يتجاهل بهدوء أي جدول/عمود غير
 * موجود (مثلاً لو ما اتشغّل migration بعد) — يُسجّل صفر صفوف لذلك الجدول.
 *
 * ⚠️ القراءة على دفعات إلزامية هنا: PostgREST يقصّ أي استعلام عند ١٠٠٠ صف
 * **بدون أي خطأ**. جدول exclusions وحده تعدّى ١٦٠٠ صف، فكانت النسخة تُحفظ
 * ناقصة بصمت — والاستعادة منها تمسح الموجود وتُرجع الجزء المقصوص فقط، أي
 * فقدان دائم للبيانات. هذا أخطر ما كان في المنظومة.
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
      const { data, error } = await fetchAllRows<Record<string, unknown>>((from, to) =>
        supabase.from(t).select('*').order(TABLE_KEY[t]).range(from, to));
      if (error) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`backup: skipping ${t}:`, error.message);
        }
        tables[t] = [];
        counts[t] = 0;
        continue;
      }
      const rows = data ?? [];
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

  // ── التحقّق: هل ما حُفظ = ما في القاعدة فعلاً؟ ─────────────────────────────
  // استعلام count منفصل لكل جدول (head:true — لا ينقل صفوفاً، فرخيص) ومقارنته
  // بما جمعناه. لو اختلفا فالنسخة ناقصة، وهذا ما كان يمرّ بصمت سنوات.
  const verifyIssues: string[] = [];
  for (const t of BACKUP_TABLES) {
    try {
      const { count, error } = await supabase.from(t).select(TABLE_KEY[t], { count: 'exact', head: true });
      if (error || count == null) continue; // جدول غير موجود أو تعذّر العدّ — لا نحكم عليه
      if (count !== counts[t]) {
        verifyIssues.push(`${t}: حُفظ ${counts[t]} صف والموجود ${count}`);
      }
    } catch { /* العدّ غير حرج — لا نُفشل النسخة بسببه */ }
  }

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
      verified: verifyIssues.length === 0,
      ...(verifyIssues.length > 0 ? { verify_issues: verifyIssues } : {}),
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
  const cutoff = new Date(Date.now() - AUTO_BACKUP_RETENTION_DAYS * 86_400_000).toISOString();
  await supabase.from('backups').delete().eq('trigger_type', 'auto_daily').lt('created_at', cutoff);
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
): Promise<{ inserted: Record<BackupTableName, number>; warnings: string[]; atomic: boolean }> {
  const warnings: string[] = [];
  const inserted: Record<BackupTableName, number> = {} as Record<BackupTableName, number>;

  // نسخة أقدم من بعض الجداول — تُستعاد، لكن تلك الجداول ستُفرَّغ.
  const missing = snapshotMissingTables(snapshot);
  if (missing.length > 0) {
    warnings.push(
      `النسخة لا تحتوي: ${missing.map(t => BACKUP_TABLE_LABELS[t]).join('، ')} — ` +
      'أُخذت قبل إضافتها، فستصبح فارغة بعد الاستعادة.'
    );
  }

  // ── المسار المفضّل: استعادة ذرّية على السيرفر ─────────────────────────────
  // كل شيء داخل معاملة واحدة: إما تكتمل أو ترجع القاعدة كما كانت. المسار
  // القديم (مسح ثم إدراج من المتصفح) يترك القاعدة ممسوحة جزئياً لو انقطع
  // الاتصال في المنتصف. نستخدمه كاحتياطي فقط لو الترقية ما اتشغّلت.
  try {
    const { data, error } = await supabase.rpc('restore_backup_snapshot', { p_snapshot: snapshot });
    if (!error && data) {
      const res = data as { inserted?: Record<string, number>; skipped_tables?: string[] };
      const serverInserted = res.inserted ?? {};
      const skipped = res.skipped_tables ?? [];
      for (const t of BACKUP_TABLES) inserted[t] = serverInserted[t] ?? 0;
      for (const t of skipped) {
        warnings.push(`${t}: الجدول غير موجود في قاعدة البيانات — لم يُستعد`);
      }
      // قائمة الجداول على السيرفر (backup_logical_tables) قد تتخلّف عن
      // BACKUP_TABLES — كانت تنقصها beneficiary_menu_overrides، فتُمسح
      // بالـcascade مع meals/beneficiaries ولا تُعاد أبداً. نكمل الناقص هنا.
      const uncovered = tablesNotCoveredByServer(serverInserted, skipped);
      if (uncovered.length > 0) {
        warnings.push(
          `دالة الاستعادة على السيرفر لا تشمل: ${uncovered.join(', ')} — استُعيدت من المتصفح. ` +
          'شغّل supabase/backup-menu-overrides-coverage-migration.sql.'
        );
        await clientRestoreTables(supabase, snapshot, uncovered, inserted, warnings);
      }
      return { inserted, warnings, atomic: uncovered.length === 0 };
    }
    if (error && !/does not exist|could not find|function/i.test(error.message)) {
      // الدالة موجودة لكن التنفيذ فشل — المعاملة تراجعت، فالقاعدة سليمة.
      // لا نُكمل بالمسار غير الذرّي حتى لا نمسح ما نجا.
      throw new Error(`تعذّرت الاستعادة الذرّية ولم يتغيّر شيء: ${error.message}`);
    }
    warnings.push(
      'الاستعادة الذرّية غير متاحة — شغّل supabase/backup-atomic-restore-migration.sql. ' +
      'تمّت الاستعادة بالطريقة القديمة (على مراحل).'
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('تعذّرت الاستعادة الذرّية')) throw err;
    warnings.push('تعذّر نداء الاستعادة الذرّية — تمّت الاستعادة بالطريقة القديمة.');
  }

  await clientRestoreTables(supabase, snapshot, [...BACKUP_TABLES], inserted, warnings);
  return { inserted, warnings, atomic: false };
}

/**
 * جداول BACKUP_TABLES التي لم تظهر في ردّ الدالة الذرّية لا في inserted ولا
 * في skipped_tables — أي أن قائمة السيرفر لا تعرفها أصلاً.
 */
export function tablesNotCoveredByServer(
  serverInserted: Record<string, unknown>,
  skipped: readonly string[],
): BackupTableName[] {
  return BACKUP_TABLES.filter(t => !(t in serverInserted) && !skipped.includes(t));
}

/**
 * مسار الاستعادة من المتصفح (غير ذرّي): مسح الجداول المطلوبة بعكس ترتيب
 * الإدراج ثم إدراجها بالترتيب. يُستخدم كاحتياطي كامل، أو لإكمال جداول لا
 * تعرفها الدالة الذرّية على السيرفر.
 */
async function clientRestoreTables(
  supabase: SupabaseClient,
  snapshot: BackupSnapshot,
  tables: BackupTableName[],
  inserted: Record<BackupTableName, number>,
  warnings: string[],
): Promise<void> {
  // نحافظ على ترتيب BACKUP_TABLES مهما كان ترتيب المُدخل
  const ordered = BACKUP_TABLES.filter(t => tables.includes(t));

  // 1) محو البيانات الحالية — عكس ترتيب الإدراج بالضبط، فالتابع يُمسح قبل الأم.
  //    اشتقاقه من BACKUP_TABLES بدل قائمة يدوية يضمن أن أي جدول يُضاف مستقبلاً
  //    يدخل الاستعادة تلقائياً؛ القائمة اليدوية السابقة نسيت meal_alternatives
  //    ومنظومة التكاليف، فكانت الاستعادة تُبقي بيانات قديمة وتفقد أخرى.
  const wipeOrder: BackupTableName[] = [...ordered].reverse();

  // فلتر «صادق دائماً» بديلاً عن delete بلا where (يحجبه supabase-js) — نستخدم
  // مفتاح كل جدول لأن meal_pricing و lunch_dinner_diet_colors بلا عمود id.
  for (const t of wipeOrder) {
    const { error } = await supabase.from(t).delete().not(TABLE_KEY[t], 'is', null);
    if (error) {
      // لو الجدول غير موجود (الـmigration ما اتشغّل بعد) نتجاوز بهدوء
      if (/relation .* does not exist|does not exist/i.test(error.message)) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`backup restore: skipping wipe of missing table ${t}`);
        }
        continue;
      }
      warnings.push(`فشل مسح ${t}: ${error.message}`);
    }
  }

  // 2) إعادة الإدراج بالترتيب الصحيح (BACKUP_TABLES مرتب أصلاً)
  //    نقطّع كل جدول إلى دفعات (chunks) لتفادي حدود الحجم.
  const CHUNK = 100;
  for (const t of ordered) {
    const rows = rowsForClientInsert(t, snapshot.tables[t] ?? []);
    inserted[t] = 0;
    if (rows.length === 0) continue;

    // قد يكون الـsnapshot الأصلي يحوي أعمدة لا توجد بعد في DB الحالية
    // (أو العكس). الـinsert في supabase-js مرن مع الأعمدة الموجودة، لكن لو
    // فشل فلربما هناك عمود ناقص — نعرض تحذيراً ونكمّل.
    for (let c = 0; c < rows.length; c += CHUNK) {
      const slice = rows.slice(c, c + CHUNK);
      const { error } = await supabase.from(t).insert(slice);
      if (error) {
        // الجدول غير موجود في DB الحالية (مثلاً snapshot أحدث من الـmigrations المطبّقة).
        // نتخطى الجدول كاملاً ونسجل تحذيراً واحداً بدل أن نطبع تحذيراً لكل صف.
        if (/relation .* does not exist|does not exist/i.test(error.message)) {
          warnings.push(`${t}: الجدول غير موجود في قاعدة البيانات — تخطّي ${rows.length} صف`);
          break;
        }
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
