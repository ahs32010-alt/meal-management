'use client';

import { useState, useCallback } from 'react';
import type { EntityType, MealType } from '@/lib/types';
import { MEAL_TYPE_LABELS, ENTITY_TYPE_LABELS_PLURAL } from '@/lib/types';
import { formatDate, formatNow, todayISO } from '@/lib/date-utils';
import type { FixedExtrasReport } from '@/lib/fixed-extras-period';
import FixedExtrasPdf from '@/components/reports/FixedExtrasPdf';

const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner'];

/** أول وآخر يوم في الشهر الحالي — افتراضي معقول للحصر */
function currentMonth(): { from: string; to: string } {
  const today = todayISO();
  const [y, m] = today.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}

/**
 * حصر «الأصناف اليومية الإضافية» (الأصناف الثابتة غير البديلة) لفترة بالتاريخ —
 * ماضية أو قادمة. الحساب في lib/fixed-extras-period.ts.
 */
export default function FixedExtrasView() {
  const [from, setFrom] = useState(() => currentMonth().from);
  const [to, setTo] = useState(() => currentMonth().to);
  const [mealTypes, setMealTypes] = useState<Set<MealType>>(() => new Set(MEAL_TYPES));
  const [entityType, setEntityType] = useState<EntityType | ''>('beneficiary');
  const [report, setReport] = useState<FixedExtrasReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showBens, setShowBens] = useState(false);
  const [exporting, setExporting] = useState(false);
  // الـPDF نسخة مصمَّمة لورق A4 (FixedExtrasPdf) لا لقطة من الشاشة
  const exportPdf = () => { if (report) { setError(''); setExporting(true); } };
  const onPdfDone = useCallback((err?: string) => {
    setExporting(false);
    if (err) setError(err);
  }, []);

  const toggleMeal = (t: MealType) =>
    setMealTypes(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });

  const generate = useCallback(async () => {
    setLoading(true); setError(''); setReport(null);
    try {
      const res = await fetch('/api/reports/fixed-extras', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from, to,
          meal_types: MEAL_TYPES.filter(t => mealTypes.has(t)),
          ...(entityType ? { entity_type: entityType } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || 'حدث خطأ'); else setReport(data);
    } catch { setError('حدث خطأ في الاتصال'); }
    setLoading(false);
  }, [from, to, mealTypes, entityType]);

  const canRun = !!from && !!to && from <= to && mealTypes.size > 0 && !loading;
  const cols = report?.mealTypes ?? [];

  return (
    <>
      <div className="card p-5 no-print space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="label">من تاريخ</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="label">إلى تاريخ</label>
            <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} className="input-field" />
          </div>
          <div className="sm:col-span-2 lg:col-span-4 order-last">
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">الوجبات المطلوب حصرها</label>
              <button
                type="button"
                onClick={() => setMealTypes(mealTypes.size === MEAL_TYPES.length ? new Set() : new Set(MEAL_TYPES))}
                className="text-xs text-emerald-700 hover:text-emerald-800 underline"
              >
                {mealTypes.size === MEAL_TYPES.length ? 'إلغاء الكل' : 'تحديد الكل'}
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {MEAL_TYPES.map(t => {
                const on = mealTypes.has(t);
                return (
                  <button
                    key={t}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggleMeal(t)}
                    className={`flex items-center justify-center gap-2.5 px-4 py-3.5 rounded-xl border-2 text-base font-bold transition-all ${on ? 'bg-emerald-50 border-emerald-500 text-emerald-800 shadow-sm' : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600'}`}
                  >
                    <span className={`flex items-center justify-center w-6 h-6 rounded-md border-2 flex-shrink-0 ${on ? 'bg-emerald-600 border-emerald-600' : 'bg-white border-slate-300'}`}>
                      {on && (
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                    {MEAL_TYPE_LABELS[t]}
                  </button>
                );
              })}
            </div>
            {mealTypes.size === 0 && (
              <p className="text-xs text-red-500 mt-2">اختر وجبة واحدة على الأقل</p>
            )}
          </div>
          <div>
            <label className="label">الفئة المستهدفة</label>
            <select value={entityType} onChange={e => setEntityType(e.target.value as EntityType | '')} className="input-field">
              <option value="">الكل</option>
              <option value="beneficiary">المستفيدون</option>
              <option value="companion">المرافقون</option>
            </select>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-slate-400">
            يحصر الأصناف الثابتة غير المعلَّمة «بديل». الأيام التي لها أمر تشغيل تُحسب مثل الأمر تماماً، والأيام القادمة من التسجيل.
          </p>
          <button onClick={generate} disabled={!canRun} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0">
            {loading
              ? <><span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full ml-2" />جاري الحساب...</>
              : 'احسب الإضافات'}
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-5 py-4 rounded-xl">{error}</div>}

      {report && !loading && (
        <div className="space-y-5">
          {exporting && <FixedExtrasPdf report={report} includeBens={showBens} onDone={onPdfDone} />}
          <div className="hidden print:block text-center mb-2">
            <h1 className="text-2xl font-bold">مركز خطوة أمل — حصر الأصناف اليومية الإضافية</h1>
          </div>

          <div className="card p-4 flex items-center gap-6 flex-wrap">
            <div>
              <p className="text-xs text-slate-500">الفترة</p>
              <p className="font-bold text-slate-800">{formatDate(report.from)} ← {formatDate(report.to)}</p>
            </div>
            <div className="w-px h-10 bg-slate-200" />
            <div>
              <p className="text-xs text-slate-500">عدد الأيام</p>
              <p className="font-bold text-slate-800">{report.days} يوم</p>
            </div>
            <div className="w-px h-10 bg-slate-200" />
            <div>
              <p className="text-xs text-slate-500">الوجبات</p>
              <p className="font-bold text-slate-800">{report.mealTypes.map(t => MEAL_TYPE_LABELS[t]).join(' + ')}</p>
            </div>
            {report.entityType && (
              <>
                <div className="w-px h-10 bg-slate-200" />
                <div>
                  <p className="text-xs text-slate-500">الفئة</p>
                  <p className="font-bold text-slate-800">{ENTITY_TYPE_LABELS_PLURAL[report.entityType]}</p>
                </div>
              </>
            )}
            <div className="w-px h-10 bg-slate-200" />
            <div>
              <p className="text-xs text-slate-500">إجمالي الإضافات</p>
              <p className="font-bold text-emerald-700 text-lg">{report.grandTotal}</p>
            </div>
            <div className="flex-1" />
            <div className="text-xs text-slate-500 space-y-0.5">
              <p>من أوامر تشغيل محفوظة: <b className="text-slate-700">{report.slotsFromOrders}</b> خانة</p>
              <p>من التسجيل (بلا أمر): <b className="text-slate-700">{report.slotsFromRegistration}</b> خانة</p>
            </div>
            <button type="button" onClick={exportPdf} disabled={exporting} className="btn-primary no-print disabled:opacity-50">
              {exporting
                ? <><span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full ml-2" />جاري التصدير...</>
                : '⬇ تصدير PDF'}
            </button>
            <button type="button" onClick={() => window.print()} className="no-print px-3 py-2 rounded-lg text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50">طباعة</button>
          </div>

          <div className="card overflow-hidden">
            <div className="px-4 py-3 bg-emerald-700">
              <h3 className="font-bold text-white text-sm">الأصناف اليومية الإضافية</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-header w-10">#</th>
                    <th className="table-header">الصنف</th>
                    {cols.map(t => <th key={t} className="table-header text-center w-24">{MEAL_TYPE_LABELS[t]}</th>)}
                    <th className="table-header text-center w-24">المجموع</th>
                    <th className="table-header text-center w-28">عدد المستفيدين</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.length === 0 ? (
                    <tr><td colSpan={cols.length + 4} className="table-cell text-center text-slate-400 text-sm py-6">لا توجد إضافات مسجّلة لهذه الفترة</td></tr>
                  ) : report.rows.map((r, i) => (
                    <tr key={r.meal.id}>
                      <td className="table-cell text-xs text-slate-400">{i + 1}</td>
                      <td className="table-cell text-sm font-medium">{r.meal.name}</td>
                      {cols.map(t => (
                        <td key={t} className="table-cell text-center">{r.byMealType[t] || <span className="text-slate-300">—</span>}</td>
                      ))}
                      <td className="table-cell text-center font-bold text-lg">{r.total}</td>
                      <td className="table-cell text-center text-slate-500">{r.beneficiaries}</td>
                    </tr>
                  ))}
                </tbody>
                {report.rows.length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-50">
                      <td className="table-cell" />
                      <td className="table-cell text-xs font-bold text-slate-500">المجموع</td>
                      {cols.map(t => (
                        <td key={t} className="table-cell text-center font-bold">
                          {report.rows.reduce((s, r) => s + (r.byMealType[t] || 0), 0)}
                        </td>
                      ))}
                      <td className="table-cell text-center font-bold text-emerald-700">{report.grandTotal}</td>
                      <td className="table-cell" />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {report.byBeneficiary.length > 0 && (
            <div className="card overflow-hidden">
              <button
                type="button"
                onClick={() => setShowBens(v => !v)}
                className="w-full px-4 py-3 flex items-center justify-between bg-slate-50 hover:bg-slate-100 transition-colors no-print"
              >
                <h3 className="font-bold text-slate-800 text-sm">التفصيل حسب المستفيد ({report.byBeneficiary.length})</h3>
                <span className="text-xs text-slate-500">{showBens ? 'إخفاء' : 'عرض'}</span>
              </button>
              {showBens && (
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="table-header w-10">#</th>
                      <th className="table-header">المستفيد</th>
                      <th className="table-header">الكود</th>
                      <th className="table-header">الإضافات</th>
                      <th className="table-header text-center w-20">المجموع</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byBeneficiary.map((b, i) => (
                      <tr key={b.id}>
                        <td className="table-cell text-xs text-slate-400">{i + 1}</td>
                        <td className="table-cell text-sm font-medium">{b.name}</td>
                        <td className="table-cell text-xs font-mono text-slate-500">{b.code}</td>
                        <td className="table-cell text-xs text-slate-600">
                          {b.items.map(x => `${x.meal.name} ×${x.qty}`).join('، ')}
                        </td>
                        <td className="table-cell text-center font-bold">{b.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          <div className={`hidden print:block text-center text-xs text-slate-500 mt-6 pt-4 border-t border-slate-200`}>
            {formatNow()}
          </div>
        </div>
      )}
    </>
  );
}
