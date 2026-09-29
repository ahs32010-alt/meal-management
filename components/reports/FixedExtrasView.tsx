'use client';

import { useState, useCallback, useEffect } from 'react';
import type { EntityType, MealType } from '@/lib/types';
import { MEAL_TYPE_LABELS, ENTITY_TYPE_LABELS_PLURAL } from '@/lib/types';
import { formatNow, todayISO } from '@/lib/date-utils';

/** 2026-09-01 → 01/09/2026 */
const dmy = (iso: string) => iso.split('-').reverse().join('/');
import type { FixedExtrasReport, ManualExtra } from '@/lib/fixed-extras-period';
import ManualExtrasEditor from '@/components/reports/ManualExtrasEditor';

// مسودة الأصناف اليدوية تبقى في متصفح المستخدم بين الزيارات — راحة فقط
const MANUAL_KEY = 'fixed-extras:manual';
import FixedExtrasPdf from '@/components/reports/FixedExtrasPdf';
import { formatMoney } from '@/lib/costs';

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
  const [manual, setManual] = useState<ManualExtra[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(MANUAL_KEY);
      if (raw) setManual(JSON.parse(raw) as ManualExtra[]);
    } catch { /* تخزين غير متاح — نبدأ فاضي */ }
  }, []);
  const updateManual = (items: ManualExtra[]) => {
    setManual(items);
    try { localStorage.setItem(MANUAL_KEY, JSON.stringify(items)); } catch { /* تجاهل */ }
  };
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
          manual,
          ...(entityType ? { entity_type: entityType } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || 'حدث خطأ'); else setReport(data);
    } catch { setError('حدث خطأ في الاتصال'); }
    setLoading(false);
  }, [from, to, mealTypes, entityType, manual]);

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
        <ManualExtrasEditor
          items={manual}
          onChange={updateManual}
          mealTypes={MEAL_TYPES.filter(t => mealTypes.has(t))}
        />
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

          <div className="card p-4 space-y-4">
            {/* الأرقام الكبيرة أولاً، ثم تفاصيل الفترة — شبكة تلتف بلا تداخل على أي عرض */}
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
              <div className="col-span-1 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3">
                <p className="text-xs text-emerald-700 font-semibold">إجمالي الإضافات</p>
                <p className="text-2xl font-extrabold text-emerald-700 tabular-nums">{report.grandTotal}</p>
              </div>
              <div className="col-span-1 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3">
                <p className="text-xs text-emerald-700 font-semibold">إجمالي السعر</p>
                <p className="text-2xl font-extrabold text-emerald-700 tabular-nums whitespace-nowrap">
                  {formatMoney(report.grandTotalPrice)} <span className="text-xs font-semibold">ريال</span>
                </p>
              </div>
              {([
                ['الفترة', `${dmy(report.from)} ← ${dmy(report.to)}`],
                ['عدد الأيام', `${report.days} يوم`],
                ['الوجبات', report.mealTypes.map(t => MEAL_TYPE_LABELS[t]).join(' + ')],
                ['الفئة', report.entityType ? ENTITY_TYPE_LABELS_PLURAL[report.entityType] : 'الكل'],
              ] as const).map(([k, v]) => (
                <div key={k} className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 min-w-0">
                  <p className="text-xs text-slate-500">{k}</p>
                  <p className="font-bold text-slate-800 truncate" title={v}>{v}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 flex-wrap border-t border-slate-100 pt-3">
              <p className="text-xs text-slate-500">
                من أوامر تشغيل محفوظة: <b className="text-slate-700">{report.slotsFromOrders}</b> خانة
                <span className="mx-2 text-slate-300">|</span>
                من التسجيل (بلا أمر): <b className="text-slate-700">{report.slotsFromRegistration}</b> خانة
              </p>
              <div className="flex gap-2 no-print">
                <button type="button" onClick={() => window.print()} className="px-3 py-2 rounded-lg text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50">طباعة</button>
                <button type="button" onClick={exportPdf} disabled={exporting} className="btn-primary disabled:opacity-50">
                  {exporting
                    ? <><span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full ml-2" />جاري التصدير...</>
                    : '⬇ تصدير PDF'}
                </button>
              </div>
            </div>
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
                    <th className="table-header text-center w-28">سعر الحبة</th>
                    <th className="table-header text-center w-32">إجمالي السعر</th>
                    <th className="table-header text-center w-28">عدد المستفيدين</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.length === 0 ? (
                    <tr><td colSpan={cols.length + 6} className="table-cell text-center text-slate-400 text-sm py-6">لا توجد إضافات مسجّلة لهذه الفترة</td></tr>
                  ) : report.rows.map((r, i) => (
                    <tr key={r.meal.id}>
                      <td className="table-cell text-xs text-slate-400">{i + 1}</td>
                      <td className="table-cell text-sm font-medium">
                        {r.meal.name}
                        {r.manual > 0 && (
                          <span className="mr-2 text-[11px] font-semibold text-sky-700 bg-sky-50 border border-sky-200 rounded px-1.5 py-0.5 whitespace-nowrap">
                            {r.manual === r.total ? 'يدوي' : `منها ${r.manual} يدوي`}
                          </span>
                        )}
                      </td>
                      {cols.map(t => (
                        <td key={t} className="table-cell text-center">{r.byMealType[t] || <span className="text-slate-300">—</span>}</td>
                      ))}
                      <td className="table-cell text-center font-bold text-lg">{r.total}</td>
                      <td className="table-cell text-center text-slate-600" dir="ltr">
                        {r.unitPrice === null ? <span className="text-amber-600 text-xs">بلا سعر</span> : formatMoney(r.unitPrice)}
                      </td>
                      <td className="table-cell text-center font-bold text-emerald-700" dir="ltr">
                        {r.unitPrice === null ? <span className="text-slate-300">—</span> : formatMoney(r.totalPrice)}
                      </td>
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
                      <td className="table-cell text-center font-bold text-emerald-700" dir="ltr">{formatMoney(report.grandTotalPrice)}</td>
                      <td className="table-cell" />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {report.unpricedCount > 0 && (
              <p className="px-4 py-2 text-xs text-amber-700 bg-amber-50 border-t border-amber-100">
                {report.unpricedCount} صنف بلا سعر بيع — غير محسوب في إجمالي السعر. حدّد سعره من صفحة «الأسعار والتكاليف».
              </p>
            )}
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
                      <th className="table-header text-center w-28">السعر</th>
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
                        <td className="table-cell text-center text-emerald-700 font-semibold" dir="ltr">{formatMoney(b.totalPrice)}</td>
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
