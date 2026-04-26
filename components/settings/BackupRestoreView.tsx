'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase-client';
import { logActivity } from '@/lib/activity-log';
import { useCurrentUser } from '@/lib/use-current-user';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import {
  AUTO_BACKUP_RETENTION,
  type BackupRow,
  type BackupSummary,
  type BackupTriggerType,
  type ScheduleInfo,
  createSnapshot,
  saveBackup,
  hasRecentBackup,
  fetchFullBackup,
  restoreFromSnapshot,
  deleteBackup,
  getBackupSchedule,
  setBackupSchedule,
} from '@/lib/backup-snapshot';
import { downloadBackupAsXLSX, downloadBackupAsJSON } from '@/lib/backup-export';

const TRIGGER_LABELS: Record<BackupTriggerType, string> = {
  auto_daily: 'تلقائية يومية',
  manual: 'يدوية',
  pre_restore: 'قبل الاستعادة',
};

const TRIGGER_BADGES: Record<BackupTriggerType, string> = {
  auto_daily: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  manual: 'bg-violet-100 text-violet-700 border-violet-200',
  pre_restore: 'bg-amber-100 text-amber-800 border-amber-200',
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString('ar', { year: 'numeric', month: 'long', day: '2-digit' });
    const time = d.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' });
    return `${date} — ${time}`;
  } catch {
    return iso;
  }
}

const TABLE_LABELS: Record<string, string> = {
  meals: 'الأصناف',
  beneficiaries: 'المستفيدون والمرافقون',
  daily_orders: 'أوامر التشغيل',
  custom_transliterations: 'الترجمة الحرفية',
  meal_alternatives: 'بدائل الأصناف',
  exclusions: 'المحظورات',
  beneficiary_fixed_meals: 'الأصناف الثابتة',
  menu_items: 'بنود قائمة الطعام',
  order_items: 'أصناف أوامر التشغيل',
  sticker_splits: 'فصل الستيكرات',
};

export default function BackupRestoreView() {
  const supabase = useMemo(() => createClient(), []);
  const { user: currentUser } = useCurrentUser();

  const [backups, setBackups] = useState<BackupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  // dialog يدعم زر تأكيد بنص اختياري
  type DialogState = { title: string; message: string; confirmLabel?: string; onConfirm: () => void } | null;
  const [dialog, setDialog] = useState<DialogState>(null);

  // عشان ما نعيد الفحص التلقائي أكثر من مرة في نفس فتح الصفحة
  const autoCheckedRef = useRef(false);

  // ── Schedule (pg_cron) ─────────────────────────────────────────────────
  const [schedule, setSchedule] = useState<ScheduleInfo | null>(null);
  const [scheduleEditing, setScheduleEditing] = useState(false);
  // قيم محرّر الوقت — بتوقيت السعودية
  const [editHour, setEditHour] = useState(23);
  const [editMinute, setEditMinute] = useState(59);
  const [savingSchedule, setSavingSchedule] = useState(false);

  const loadSchedule = useCallback(async () => {
    const s = await getBackupSchedule(supabase);
    setSchedule(s);
    if (s.enabled && s.hourKSA != null && s.minute != null) {
      setEditHour(s.hourKSA);
      setEditMinute(s.minute);
    }
  }, [supabase]);

  useEffect(() => {
    if (!migrationMissing) void loadSchedule();
  }, [migrationMissing, loadSchedule]);

  const handleSaveSchedule = async () => {
    setSavingSchedule(true);
    setError('');
    setInfo('');
    try {
      await setBackupSchedule(supabase, editHour, editMinute);
      void logActivity({
        action: 'update',
        entity_type: 'backup',
        entity_name: `تحديث وقت الجدولة إلى ${pad2(editHour)}:${pad2(editMinute)} توقيت السعودية`,
        details: { hour_ksa: editHour, minute: editMinute, scope: 'schedule' },
      });
      setInfo(`✓ تم تحديث وقت النسخة التلقائية إلى ${pad2(editHour)}:${pad2(editMinute)} توقيت السعودية.`);
      setScheduleEditing(false);
      await loadSchedule();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingSchedule(false);
    }
  };

  // ── Fetch list ───────────────────────────────────────────────────────────
  const fetchBackups = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: err } = await supabase
      .from('backups')
      .select('id, created_at, trigger_type, created_by_user_id, created_by_user_email, created_by_user_name, summary, notes')
      .order('created_at', { ascending: false });

    if (err) {
      // الجدول غير موجود → الـmigration ما اتشغّل
      if (/relation .*backups.* does not exist|does not exist/i.test(err.message)) {
        setMigrationMissing(true);
      } else {
        setError(err.message);
      }
      setBackups([]);
      setLoading(false);
      return;
    }
    setBackups((data ?? []) as unknown as BackupRow[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { fetchBackups(); }, [fetchBackups]);

  // ── Run backup (manual or auto) ──────────────────────────────────────────
  const runBackup = useCallback(async (triggerType: BackupTriggerType, notes?: string) => {
    setRunning(true);
    setError('');
    setInfo('');
    try {
      const { snapshot, summary, fullDb } = await createSnapshot(supabase);
      await saveBackup(supabase, snapshot, summary, {
        triggerType,
        user: currentUser
          ? { id: currentUser.id, email: currentUser.email ?? null, name: currentUser.full_name ?? null }
          : null,
        notes: notes ?? null,
        fullDb,
      });
      void logActivity({
        action: 'create',
        entity_type: 'backup',
        entity_name: `نسخة احتياطية ${TRIGGER_LABELS[triggerType]}`,
        details: {
          trigger_type: triggerType,
          total_rows: summary.total_rows,
          counts: summary.counts,
          full_db_table_count: summary.full_db_table_count,
          full_db_total_rows: summary.full_db_total_rows,
        },
      });
      const fullDbHint = summary.full_db_table_count
        ? ` + لقطة DB كاملة (${summary.full_db_table_count} جدول، ${summary.full_db_total_rows ?? 0} صف)`
        : '';
      setInfo(`✓ تم إنشاء نسخة احتياطية تحتوي ${summary.total_rows} سجل${fullDbHint}.`);
      await fetchBackups();
    } catch (err) {
      setError(`تعذّر إنشاء النسخة: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  }, [supabase, currentUser, fetchBackups]);

  // ── Auto check on mount (fallback لو pg_cron مش مفعّل) ──────────────────
  // نتفقّد آخر 23 ساعة بدل "اليوم الحالي" عشان ما يحصل تكرار مع pg_cron
  // الذي يأخذ النسخة كل 23:59 (لو فعّلت الـextension).
  useEffect(() => {
    if (autoCheckedRef.current) return;
    if (loading || migrationMissing) return;
    autoCheckedRef.current = true;
    (async () => {
      try {
        const recent = await hasRecentBackup(supabase, 23);
        if (!recent) {
          await runBackup('auto_daily');
        }
      } catch {
        // فشل الفحص لا يُوقف الصفحة — المستخدم يقدر يضغط "تشغيل الآن" يدوياً
      }
    })();
  }, [loading, migrationMissing, supabase, runBackup]);

  // ── Download (XLSX or JSON or full DB JSON) ──────────────────────────────
  const handleDownload = async (backup: BackupRow, kind: 'xlsx' | 'json' | 'fulldb') => {
    setDownloading(backup.id);
    setError('');
    try {
      const { snapshot, fullDb } = await fetchFullBackup(supabase, backup.id);
      const stamp = new Date(backup.created_at).toISOString().slice(0, 19).replace(/[:T]/g, '-');
      if (kind === 'xlsx') {
        await downloadBackupAsXLSX(snapshot, `نسخة_احتياطية_${stamp}.xlsx`);
      } else if (kind === 'json') {
        downloadBackupAsJSON(snapshot, `backup_${stamp}.json`);
      } else {
        // fulldb — لقطة DB الكاملة الخام (كل جداول public)
        if (!fullDb) {
          setError('لقطة DB الكاملة غير متوفرة لهذه النسخة (شغّل supabase/backup-full-db-migration.sql ثم أعد إنشاء نسخة).');
          return;
        }
        // نلفّ fullDb بنفس شكل snapshot عشان أداة التنزيل تكون موحدة
        const wrapped = {
          version: 1 as const,
          taken_at: snapshot.taken_at,
          source: 'full_db_dump',
          tables: fullDb,
        };
        downloadBackupAsJSON(wrapped as never, `db_full_${stamp}.json`);
      }
    } catch (err) {
      setError(`تعذّر التنزيل: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDownloading(null);
    }
  };

  // ── Restore (with pre_restore safety backup) ─────────────────────────────
  const handleRestoreClick = (backup: BackupRow) => {
    setDialog({
      title: 'استعادة من نسخة احتياطية',
      message:
        `سيتم استبدال البيانات الحالية بمحتوى نسخة "${formatDateTime(backup.created_at)}".\n\n` +
        `قبل الاستبدال، سيتم أخذ نسخة احتياطية تلقائية للحالة الحالية باسم "قبل الاستعادة" — ` +
        `بحيث تقدر ترجع للوضع الحالي لو ما عجبك الاستعادة.\n\n` +
        `الجداول التي تتأثر: الأصناف، المستفيدون والمرافقون، أوامر التشغيل، ` +
        `قائمة الطعام، التخصيصات، الترجمات. (المستخدمون والصلاحيات وسجل النشاط لا تتأثر.)\n\n` +
        `متابعة؟`,
      confirmLabel: 'متابعة',
      onConfirm: () => {
        setDialog(null);
        // تأكيد ثاني — الكتابة عشان يتأكد المستخدم
        setDialog({
          title: 'تأكيد نهائي',
          message:
            `هذي العملية لا يمكن التراجع عنها بسهولة (إلا عبر استعادة "قبل الاستعادة").\n\n` +
            `اضغط "نعم، استعادة" للتنفيذ، أو "إلغاء" للتراجع.`,
          confirmLabel: 'نعم، استعادة',
          onConfirm: () => {
            setDialog(null);
            void runRestore(backup);
          },
        });
      },
    });
  };

  const runRestore = async (backup: BackupRow) => {
    setRestoring(backup.id);
    setError('');
    setInfo('');
    try {
      // 1) أخذ نسخة احتياطية للوضع الحالي قبل الاستبدال (نقطة استرجاع)
      const { snapshot: preSnap, summary: preSum, fullDb: preFull } = await createSnapshot(supabase);
      await saveBackup(supabase, preSnap, preSum, {
        triggerType: 'pre_restore',
        user: currentUser
          ? { id: currentUser.id, email: currentUser.email ?? null, name: currentUser.full_name ?? null }
          : null,
        notes: `لقطة قبل استعادة نسخة ${backup.id} (${formatDateTime(backup.created_at)})`,
        fullDb: preFull,
      });

      // 2) جلب الـsnapshot المراد استعادته
      const { snapshot } = await fetchFullBackup(supabase, backup.id);

      // 3) تنفيذ الاستعادة
      const { inserted, warnings } = await restoreFromSnapshot(supabase, snapshot);

      const totalInserted = Object.values(inserted).reduce((s, n) => s + n, 0);
      void logActivity({
        action: 'update',
        entity_type: 'backup',
        entity_id: backup.id,
        entity_name: `استعادة نسخة ${formatDateTime(backup.created_at)}`,
        details: {
          source: 'restore',
          inserted_total: totalInserted,
          inserted_per_table: inserted,
          warnings_count: warnings.length,
        },
      });

      const warnPart = warnings.length > 0
        ? ` — مع ${warnings.length} تحذير (راجع الـconsole).`
        : '';
      if (warnings.length > 0 && process.env.NODE_ENV !== 'production') {
        console.warn('Restore warnings:', warnings);
      }
      setInfo(`✓ تمت الاستعادة. أُدرج ${totalInserted} سجل.${warnPart}`);
      await fetchBackups();
    } catch (err) {
      setError(`تعذّرت الاستعادة: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRestoring(null);
    }
  };

  // ── Delete ───────────────────────────────────────────────────────────────
  const handleDeleteClick = (backup: BackupRow) => {
    setDialog({
      title: 'حذف نسخة احتياطية',
      message: `سيتم حذف النسخة "${formatDateTime(backup.created_at)}" نهائياً. هذا الإجراء لا يمكن التراجع عنه. متابعة؟`,
      confirmLabel: 'حذف',
      onConfirm: async () => {
        setDialog(null);
        setDeletingId(backup.id);
        try {
          await deleteBackup(supabase, backup.id);
          void logActivity({
            action: 'delete',
            entity_type: 'backup',
            entity_id: backup.id,
            entity_name: `نسخة ${formatDateTime(backup.created_at)}`,
            details: { trigger_type: backup.trigger_type },
          });
          await fetchBackups();
        } catch (err) {
          setError(`تعذّر الحذف: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          setDeletingId(null);
        }
      },
    });
  };

  // ── Render ───────────────────────────────────────────────────────────────
  if (migrationMissing) {
    return (
      <div className="card p-6">
        <p className="font-bold text-slate-800 mb-2">⚠ ميزة النسخ الاحتياطي تحتاج تشغيل ملف الترقية:</p>
        <code className="block bg-slate-100 px-3 py-2 rounded text-sm font-mono text-slate-700 mb-3">
          supabase/backup-system-migration.sql
        </code>
        <p className="text-sm text-slate-500">
          شغّله مرة واحدة في Supabase SQL Editor ثم حدّث هذه الصفحة.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-bold text-slate-800">النسخ الاحتياطي والاستعادة</h2>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              النسخة التلقائية اليومية تعمل عبر <span className="font-semibold text-slate-700">pg_cron</span> في الوقت المحدّد أدناه (تقدر تغيّره).
              ولو ما تشغّلت لأي سبب، يتم أخذ نسخة فالبَك تلقائياً عند فتح هذا التبويب.
              يُحتفظ بآخر {AUTO_BACKUP_RETENTION} نسخ تلقائية فقط؛ اليدوية و&quot;قبل الاستعادة&quot; لا تُحذف تلقائياً.
            </p>
          </div>
          <button
            type="button"
            onClick={() => runBackup('manual')}
            disabled={running}
            className="btn-primary text-sm"
          >
            {running ? 'جاري الإنشاء...' : '+ تشغيل نسخة احتياطية الآن'}
          </button>
        </div>

        {/* محرّر وقت الجدولة اليومية */}
        {schedule?.enabled ? (
          <div className="bg-cyan-50 border border-cyan-200 rounded-lg px-3 py-2.5 text-sm">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-cyan-800">
                <span>⏰</span>
                <span className="font-semibold">الجدولة اليومية:</span>
                {!scheduleEditing && schedule.hourKSA != null && schedule.minute != null ? (
                  <span className="bg-white border border-cyan-300 rounded px-2 py-0.5 font-mono font-bold text-cyan-900">
                    {pad2(schedule.hourKSA)}:{pad2(schedule.minute)}
                  </span>
                ) : null}
                {!scheduleEditing && (
                  <span className="text-xs text-cyan-700">توقيت السعودية</span>
                )}
              </div>

              {!scheduleEditing ? (
                <button
                  type="button"
                  onClick={() => setScheduleEditing(true)}
                  className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-cyan-300 text-cyan-700 bg-white hover:bg-cyan-100"
                >
                  تعديل الوقت
                </button>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-cyan-800">الوقت بتوقيت السعودية:</span>
                  <select
                    value={editHour}
                    onChange={e => setEditHour(parseInt(e.target.value, 10))}
                    className="border border-cyan-300 rounded px-1.5 py-1 text-sm bg-white font-mono"
                  >
                    {Array.from({ length: 24 }).map((_, h) => (
                      <option key={h} value={h}>{pad2(h)}</option>
                    ))}
                  </select>
                  <span>:</span>
                  <select
                    value={editMinute}
                    onChange={e => setEditMinute(parseInt(e.target.value, 10))}
                    className="border border-cyan-300 rounded px-1.5 py-1 text-sm bg-white font-mono"
                  >
                    {Array.from({ length: 60 }).map((_, m) => (
                      <option key={m} value={m}>{pad2(m)}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleSaveSchedule}
                    disabled={savingSchedule}
                    className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {savingSchedule ? 'جاري الحفظ...' : 'حفظ'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setScheduleEditing(false);
                      if (schedule.hourKSA != null) setEditHour(schedule.hourKSA);
                      if (schedule.minute != null) setEditMinute(schedule.minute);
                    }}
                    disabled={savingSchedule}
                    className="text-xs font-semibold px-2 py-1 text-slate-500 hover:text-slate-700"
                  >
                    إلغاء
                  </button>
                </div>
              )}
            </div>
            {!scheduleEditing && schedule.cronExpr && (
              <div className="text-[11px] text-cyan-700 mt-1 opacity-75">
                cron expression الحالي: <code className="font-mono">{schedule.cronExpr}</code>
                {schedule.hourUTC != null && (
                  <span> (= {pad2(schedule.hourUTC)}:{pad2(schedule.minute ?? 0)} UTC)</span>
                )}
              </div>
            )}
          </div>
        ) : (
          /* الجدولة غير مفعّلة — تنبيه الإعداد */
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800 leading-relaxed">
            <div className="font-semibold mb-1">⚙️ الجدولة التلقائية اليومية غير مفعّلة بعد. لتفعيلها:</div>
            <ol className="list-decimal pr-4 space-y-0.5">
              <li>افتح Supabase Dashboard → Database → Extensions، فعّل <code className="bg-amber-100 px-1 rounded font-mono">pg_cron</code>.</li>
              <li>شغّل ملف <code className="bg-amber-100 px-1 rounded font-mono">supabase/backup-auto-schedule-migration.sql</code> في SQL Editor.</li>
              <li>حدّث هذه الصفحة — رح يظهر محرّر الوقت هنا.</li>
            </ol>
            <p className="mt-1 opacity-80">
              لحد ما تفعّل الجدولة، النسخة تُؤخذ كاحتياط أول ما تفتح هذا التبويب يومياً.
            </p>
          </div>
        )}

        {/* Messages */}
        {info && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-3 py-2 text-sm flex items-center justify-between gap-2">
            <span>{info}</span>
            <button onClick={() => setInfo('')} className="text-emerald-600 hover:text-emerald-800 leading-none">✕</button>
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm flex items-center justify-between gap-2">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-red-500 hover:text-red-700 leading-none">✕</button>
          </div>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="card p-10 text-center">
          <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full mx-auto" />
          <p className="text-slate-400 mt-3 text-sm">جاري التحميل...</p>
        </div>
      ) : backups.length === 0 ? (
        <div className="card p-10 text-center text-slate-400">
          <p className="font-medium">لا توجد نسخ احتياطية بعد</p>
          <p className="text-sm mt-1">ستُنشأ أول نسخة تلقائياً، أو اضغط &quot;تشغيل نسخة احتياطية الآن&quot;.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {backups.map(b => {
            const summary = b.summary as BackupSummary | null;
            const total = summary?.total_rows ?? 0;
            const counts: Record<string, number> = (summary?.counts ?? {}) as Record<string, number>;
            const isRestoring = restoring === b.id;
            const isDeleting = deletingId === b.id;
            const isDownloading = downloading === b.id;
            return (
              <div key={b.id} className="card p-4 space-y-3">
                {/* Top row: badge + date + actions */}
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`badge ${TRIGGER_BADGES[b.trigger_type]}`}>
                      {TRIGGER_LABELS[b.trigger_type]}
                    </span>
                    <span className="font-bold text-slate-800 text-sm">{formatDateTime(b.created_at)}</span>
                    {b.created_by_user_name && (
                      <span className="text-xs text-slate-500">— {b.created_by_user_name}</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => handleDownload(b, 'xlsx')}
                      disabled={isDownloading}
                      className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      title="تنزيل النسخة المنطقية كملف Excel متعدد الأوراق بنفس صيغ الاستيراد/التصدير"
                    >
                      {isDownloading ? 'جاري...' : '⬇ Excel'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownload(b, 'json')}
                      disabled={isDownloading}
                      className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                      title="تنزيل النسخة المنطقية الخام كملف JSON (نفس بيانات Excel لكن JSON)"
                    >
                      ⬇ JSON
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownload(b, 'fulldb')}
                      disabled={isDownloading || !summary?.full_db_table_count}
                      className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-cyan-300 text-cyan-700 bg-cyan-50 hover:bg-cyan-100 disabled:opacity-40"
                      title="تنزيل لقطة DB كاملة وخام: كل جداول قاعدة البيانات (عدا backups نفسه) — مفيد كنسخة احتياطية على مستوى DB."
                    >
                      🗄 DB كامل
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRestoreClick(b)}
                      disabled={isRestoring || running}
                      className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 disabled:opacity-50"
                      title="استبدل البيانات الحالية بهذه النسخة (يعتمد على النسخة المنطقية فقط)"
                    >
                      {isRestoring ? 'جاري الاستعادة...' : '↺ استعادة'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteClick(b)}
                      disabled={isDeleting || isRestoring}
                      className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40"
                    >
                      🗑 حذف
                    </button>
                  </div>
                </div>

                {/* Summary chips */}
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                    إجمالي (منطقي): {total} سجل
                  </span>
                  {summary?.full_db_table_count != null && (
                    <span
                      className="text-xs font-semibold px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-700 border border-cyan-200"
                      title="لقطة DB كاملة وخام (كل جداول public ماعدا backups نفسه)"
                    >
                      DB كامل: {summary.full_db_table_count} جدول · {summary.full_db_total_rows ?? 0} صف
                    </span>
                  )}
                  {Object.entries(counts).map(([table, count]) => {
                    if (!count) return null;
                    const label = TABLE_LABELS[table] ?? table;
                    return (
                      <span
                        key={table}
                        className="text-xs px-2 py-0.5 rounded-full bg-slate-50 text-slate-600 border border-slate-200"
                      >
                        {label}: {count}
                      </span>
                    );
                  })}
                </div>

                {b.notes && (
                  <p className="text-xs text-slate-500 italic">📝 {b.notes}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!dialog}
        title={dialog?.title ?? ''}
        message={dialog?.message ?? ''}
        confirmLabel={dialog?.confirmLabel}
        onConfirm={() => dialog?.onConfirm()}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}
