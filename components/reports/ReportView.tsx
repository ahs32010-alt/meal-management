'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase-client';
import type { DailyOrder, Meal, EntityType, MealType } from '@/lib/types';
import { MEAL_TYPE_LABELS, ENTITY_TYPE_LABELS_PLURAL, ENTITY_BADGE_STYLES } from '@/lib/types';
import { formatDate, formatDateFull, formatNow } from '@/lib/date-utils';
import { MENU_DAYS, WEEK_NUMBERS, WEEK_TITLES } from '@/lib/menu-utils';
import type { MenuPeriodReport } from '@/lib/menu-period-report';

// ── Styles ──────────────────────────────────────────────────────────────────
const MEAL_TYPE_STYLES: Record<string, string> = {
  breakfast: 'bg-yellow-100 text-yellow-700',
  lunch:     'bg-blue-100 text-blue-700',
  dinner:    'bg-purple-100 text-purple-700',
};

const DAY_SHORT: Record<number, string> = {
  6: 'سبت', 0: 'أحد', 1: 'إثنين', 2: 'ثلاثاء', 3: 'أربعاء', 4: 'خميس', 5: 'جمعة',
};

// ── Interfaces (daily mode) ──────────────────────────────────────────────────
interface ExcludedItem { meal: Meal; alternative: Meal | null }
interface BeneficiaryDetail {
  beneficiary: { id: string; name: string; code: string; villa?: string; category: string };
  excludedItems: ExcludedItem[];
  fixedItems: { meal: Meal; quantity: number }[];
}
interface MealCount { meal: Meal; gets?: number; qty?: number; quantity?: number }
interface FullReport {
  order: DailyOrder;
  itemsSummary: MealCount[];
  beneficiaryDetails: BeneficiaryDetail[];
  mainMealsSummary: MealCount[];
  snackMealsSummary: MealCount[];
  altSummary: MealCount[];
  snackAltSummary: MealCount[];
  fixedSummary: MealCount[];
}

type Mode = 'daily' | 'period';

// ── SummaryPair ──────────────────────────────────────────────────────────────
function SummaryPair({
  leftTitle, leftColor, leftItems, leftKey,
  rightTitle, rightColor, rightItems, rightKey,
}: {
  leftTitle: string; leftColor: string;
  leftItems: MealCount[]; leftKey: keyof MealCount;
  rightTitle: string; rightColor: string;
  rightItems: MealCount[]; rightKey: keyof MealCount;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="card overflow-hidden">
        <div className={`px-4 py-2.5 border-b ${leftColor}`}>
          <h4 className="font-bold text-sm">{leftTitle}</h4>
        </div>
        <table className="w-full">
          <thead><tr className="bg-slate-50">
            <th className="table-header">الصنف</th>
            <th className="table-header text-center w-16">الكمية</th>
          </tr></thead>
          <tbody>
            {leftItems.length === 0
              ? <tr><td colSpan={2} className="table-cell text-center text-slate-400 text-xs py-4">—</td></tr>
              : leftItems.map(x => (
                <tr key={x.meal.id} className="hover:bg-slate-50">
                  <td className="table-cell text-sm">{x.meal.name}</td>
                  <td className="table-cell text-center font-bold text-lg">{x[leftKey] as number}</td>
                </tr>
              ))}
          </tbody>
          {leftItems.length > 0 && (
            <tfoot><tr className="bg-slate-50">
              <td className="table-cell text-xs font-bold text-slate-500">المجموع</td>
              <td className="table-cell text-center font-bold">{leftItems.reduce((s, x) => s + (x[leftKey] as number || 0), 0)}</td>
            </tr></tfoot>
          )}
        </table>
      </div>
      <div className="card overflow-hidden">
        <div className={`px-4 py-2.5 border-b ${rightColor}`}>
          <h4 className="font-bold text-sm">{rightTitle}</h4>
        </div>
        <table className="w-full">
          <thead><tr className="bg-slate-50">
            <th className="table-header">البديل</th>
            <th className="table-header text-center w-16">الكمية</th>
          </tr></thead>
          <tbody>
            {rightItems.length === 0
              ? <tr><td colSpan={2} className="table-cell text-center text-slate-400 text-xs py-4">لا توجد استبدالات</td></tr>
              : rightItems.map(x => (
                <tr key={x.meal.id} className="hover:bg-slate-50">
                  <td className="table-cell text-sm">{x.meal.name}</td>
                  <td className="table-cell text-center font-bold text-lg">{x[rightKey] as number}</td>
                </tr>
              ))}
          </tbody>
          {rightItems.length > 0 && (
            <tfoot><tr className="bg-slate-50">
              <td className="table-cell text-xs font-bold text-slate-500">المجموع</td>
              <td className="table-cell text-center font-bold">{rightItems.reduce((s, x) => s + (x[rightKey] as number || 0), 0)}</td>
            </tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ── WeekDayGrid ──────────────────────────────────────────────────────────────
type Selections = Record<number, Set<number>>;

function WeekDayGrid({
  selections,
  onChange,
}: {
  selections: Selections;
  onChange: (next: Selections) => void;
}) {
  const allDayValues = MENU_DAYS.map(d => d.value);

  const toggle = (week: number, day: number) => {
    const next = { ...selections, [week]: new Set(selections[week]) };
    if (next[week].has(day)) next[week].delete(day); else next[week].add(day);
    onChange(next);
  };

  const toggleWeekAll = (week: number) => {
    const allSelected = allDayValues.every(d => selections[week].has(d));
    onChange({ ...selections, [week]: allSelected ? new Set() : new Set(allDayValues) });
  };

  const toggleDayAll = (day: number) => {
    const allSelected = WEEK_NUMBERS.every(w => selections[w].has(day));
    const next = { ...selections };
    WEEK_NUMBERS.forEach(w => {
      next[w] = new Set(next[w]);
      if (allSelected) next[w].delete(day); else next[w].add(day);
    });
    onChange(next);
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            <th className="p-2 text-right text-xs text-slate-500 font-medium w-28" />
            {MENU_DAYS.map(d => (
              <th key={d.value} className="p-1 text-center">
                <button
                  type="button"
                  onClick={() => toggleDayAll(d.value)}
                  className={`w-full px-1 py-1.5 rounded text-xs font-medium transition-colors
                    ${WEEK_NUMBERS.every(w => selections[w].has(d.value))
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-500 hover:bg-slate-100'}`}
                >
                  {d.label}
                </button>
              </th>
            ))}
            <th className="p-1 w-20 text-center text-xs text-slate-400 font-normal">الكل</th>
          </tr>
        </thead>
        <tbody>
          {WEEK_NUMBERS.map(week => {
            const selectedCount = selections[week].size;
            const allSelected = selectedCount === allDayValues.length;
            return (
              <tr key={week} className="border-t border-slate-100">
                <td className="py-2 pr-1 pl-2">
                  <span className={`text-xs font-semibold ${selectedCount > 0 ? 'text-slate-800' : 'text-slate-400'}`}>
                    {WEEK_TITLES[week]}
                    {selectedCount > 0 && (
                      <span className="mr-1 text-emerald-600">({selectedCount} يوم)</span>
                    )}
                  </span>
                </td>
                {MENU_DAYS.map(d => {
                  const active = selections[week].has(d.value);
                  return (
                    <td key={d.value} className="p-1 text-center">
                      <button
                        type="button"
                        onClick={() => toggle(week, d.value)}
                        className={`w-8 h-8 rounded-lg text-xs font-bold transition-all
                          ${active
                            ? 'bg-emerald-500 text-white shadow-sm scale-105'
                            : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
                      >
                        {active ? '✓' : DAY_SHORT[d.value]?.charAt(0)}
                      </button>
                    </td>
                  );
                })}
                <td className="p-1 text-center">
                  <button
                    type="button"
                    onClick={() => toggleWeekAll(week)}
                    className={`px-2 py-1 rounded text-xs transition-colors
                      ${allSelected
                        ? 'bg-emerald-100 text-emerald-700 font-semibold'
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                  >
                    {allSelected ? 'إلغاء' : 'كل الأيام'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── WeeksSummaryBadges ────────────────────────────────────────────────────────
function WeeksSummaryBadges({ weeksSummary }: { weeksSummary: MenuPeriodReport['weeksSummary'] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {weeksSummary.map(ws => (
        <div key={ws.week} className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-white border-slate-200 text-xs shadow-sm">
          <span className="font-bold text-slate-700">{WEEK_TITLES[ws.week as 1|2|3|4]}</span>
          <span className="text-slate-400">—</span>
          <span className="text-slate-600">
            {ws.days.length === 7 ? 'كل الأيام' : ws.days.map(d => DAY_SHORT[d]).join('، ')}
          </span>
          {ws.totalItems > 0 && (
            <>
              <span className="text-slate-300">|</span>
              <span className="font-mono font-bold text-emerald-600">{ws.totalItems}</span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
interface Props { initialOrderId?: string }

const emptySelections = (): Selections =>
  Object.fromEntries(WEEK_NUMBERS.map(w => [w, new Set<number>()])) as Selections;

export default function ReportView({ initialOrderId }: Props) {
  const [mode, setMode] = useState<Mode>('daily');

  // ── Daily state ──────────────────────────────────────────────────────────
  const [orders, setOrders] = useState<DailyOrder[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState(initialOrderId || '');
  const [report, setReport] = useState<FullReport | null>(null);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [error, setError] = useState('');

  // ── Period state ─────────────────────────────────────────────────────────
  const [selections, setSelections] = useState<Selections>(emptySelections);
  const [periodMealType, setPeriodMealType] = useState<MealType | ''>('');
  const [periodEntityType, setPeriodEntityType] = useState<EntityType | ''>('beneficiary');
  const [periodReport, setPeriodReport] = useState<MenuPeriodReport | null>(null);
  const [loadingPeriod, setLoadingPeriod] = useState(false);
  const [periodError, setPeriodError] = useState('');

  const supabase = useMemo(() => createClient(), []);

  const totalSelectedDays = useMemo(
    () => Object.values(selections).reduce((s, days) => s + days.size, 0),
    [selections],
  );

  // ── Load orders (daily mode) ──────────────────────────────────────────────
  useEffect(() => {
    const loadOrders = async () => {
      const first = await supabase
        .from('daily_orders')
        .select('id, date, meal_type, entity_type, created_at')
        .order('date', { ascending: false });
      let data: unknown = first.data;
      if (first.error && /entity_type|column/i.test(first.error.message)) {
        const fallback = await supabase
          .from('daily_orders')
          .select('id, date, meal_type, created_at')
          .order('date', { ascending: false });
        data = fallback.data;
      }
      if (data) setOrders(data as DailyOrder[]);
      setLoadingOrders(false);
    };
    loadOrders();
  }, [supabase]);

  const generateReport = useCallback(async (orderId: string) => {
    if (!orderId) return;
    setLoadingReport(true); setError(''); setReport(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/report`);
      const data = await res.json();
      if (!res.ok) setError(data.error || 'حدث خطأ'); else setReport(data);
    } catch { setError('حدث خطأ في الاتصال'); }
    setLoadingReport(false);
  }, []);

  useEffect(() => {
    if (selectedOrderId) generateReport(selectedOrderId);
  }, [selectedOrderId, generateReport]);

  // ── Generate period report ────────────────────────────────────────────────
  const generatePeriodReport = useCallback(async () => {
    if (totalSelectedDays === 0) return;
    setLoadingPeriod(true); setPeriodError(''); setPeriodReport(null);
    try {
      const selectionsBody = Object.fromEntries(
        Object.entries(selections)
          .filter(([, days]) => days.size > 0)
          .map(([w, days]) => [w, [...days]]),
      );
      const res = await fetch('/api/reports/menu-period', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selections: selectionsBody,
          ...(periodMealType ? { meal_type: periodMealType } : {}),
          ...(periodEntityType ? { entity_type: periodEntityType } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) setPeriodError(data.error || 'حدث خطأ'); else setPeriodReport(data);
    } catch { setPeriodError('حدث خطأ في الاتصال'); }
    setLoadingPeriod(false);
  }, [selections, totalSelectedDays, periodMealType, periodEntityType]);

  return (
    <div className="p-6 space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between no-print">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">التقارير</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {mode === 'daily' ? 'تقرير تفصيلي لأمر التشغيل' : 'إحصاء الأصناف من قائمة الطعام'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-slate-100 rounded-xl p-1 gap-0.5 no-print">
            <button
              onClick={() => setMode('daily')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${mode === 'daily' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
            >
              يومي
            </button>
            <button
              onClick={() => setMode('period')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${mode === 'period' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
            >
              فترة زمنية
            </button>
          </div>
          {mode === 'daily' && report && (
            <a
              href={`/orders/${selectedOrderId}/print`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary no-print"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              تصدير PDF
            </a>
          )}
        </div>
      </div>

      {/* ══════════════════════ DAILY MODE ══════════════════════════════════ */}
      {mode === 'daily' && (
        <>
          <div className="card p-4 no-print">
            <label className="label">اختر أمر التشغيل</label>
            {loadingOrders
              ? <div className="input-field text-slate-400">جاري التحميل...</div>
              : (
                <select
                  value={selectedOrderId}
                  onChange={e => setSelectedOrderId(e.target.value)}
                  className="input-field"
                >
                  <option value="">— اختر أمر تشغيل —</option>
                  {orders.map(o => {
                    const e: EntityType = o.entity_type === 'companion' ? 'companion' : 'beneficiary';
                    return (
                      <option key={o.id} value={o.id}>
                        {formatDate(o.date)} — {MEAL_TYPE_LABELS[o.meal_type]} — {ENTITY_TYPE_LABELS_PLURAL[e]}
                      </option>
                    );
                  })}
                </select>
              )}
          </div>

          {loadingReport && (
            <div className="card p-10 text-center">
              <div className="animate-spin w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full mx-auto" />
              <p className="text-slate-400 mt-3">جاري توليد التقرير...</p>
            </div>
          )}

          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-5 py-4 rounded-xl">{error}</div>}

          {report && !loadingReport && (
            <div className="space-y-5" id="report-content">
              {/* Print title */}
              <div className="hidden print:block text-center mb-4 pb-4 border-b-2 border-slate-800">
                <h1 className="text-2xl font-bold">مركز خطوة أمل — تقرير يومي</h1>
                <p className="text-base mt-1">
                  {formatDateFull(report.order.date)} — وجبة {MEAL_TYPE_LABELS[report.order.meal_type]}
                </p>
              </div>

              {/* Order info */}
              <div className="card p-4 no-print flex items-center gap-6 flex-wrap">
                <div>
                  <p className="text-xs text-slate-500">التاريخ</p>
                  <p className="font-bold text-slate-800">{formatDateFull(report.order.date)}</p>
                </div>
                <div className="w-px h-10 bg-slate-200" />
                <div>
                  <p className="text-xs text-slate-500">نوع الوجبة</p>
                  <span className={`badge ${MEAL_TYPE_STYLES[report.order.meal_type]}`}>{MEAL_TYPE_LABELS[report.order.meal_type]}</span>
                </div>
                <div className="w-px h-10 bg-slate-200" />
                <div>
                  <p className="text-xs text-slate-500">الفئة المستهدفة</p>
                  {(() => {
                    const e: EntityType = report.order.entity_type === 'companion' ? 'companion' : 'beneficiary';
                    return <span className={`badge ${ENTITY_BADGE_STYLES[e]}`}>{ENTITY_TYPE_LABELS_PLURAL[e]}</span>;
                  })()}
                </div>
                <div className="w-px h-10 bg-slate-200" />
                <div>
                  <p className="text-xs text-slate-500">لديهم تخصيصات</p>
                  <p className="font-bold text-slate-800">
                    {report.beneficiaryDetails.filter(d => d.excludedItems.length > 0).length}
                  </p>
                </div>
              </div>

              {report.mainMealsSummary.length > 0 && (
                <div>
                  <h3 className="text-sm font-bold text-slate-600 mb-2">الأصناف الرئيسية وبدائلها</h3>
                  <SummaryPair
                    leftTitle="الأصناف الرئيسية" leftColor="bg-green-50 text-green-800 border-green-100"
                    leftItems={report.mainMealsSummary} leftKey="gets"
                    rightTitle="البدائل المستخدمة" rightColor="bg-orange-50 text-orange-800 border-orange-100"
                    rightItems={report.altSummary} rightKey="qty"
                  />
                </div>
              )}

              {report.snackMealsSummary.length > 0 && (
                <div>
                  <h3 className="text-sm font-bold text-slate-600 mb-2">السناكات وبدائلها</h3>
                  <SummaryPair
                    leftTitle="السناكات" leftColor="bg-amber-50 text-amber-800 border-amber-100"
                    leftItems={report.snackMealsSummary} leftKey="gets"
                    rightTitle="بدائل السناكات" rightColor="bg-amber-50 text-amber-800 border-amber-100"
                    rightItems={report.snackAltSummary} rightKey="qty"
                  />
                </div>
              )}

              {report.fixedSummary?.length > 0 && (
                <div className="card overflow-hidden">
                  <div className="px-5 py-3 bg-violet-700 flex items-center justify-between">
                    <h3 className="font-bold text-white text-sm">الأصناف الثابتة اليومية</h3>
                    <span className="text-violet-200 text-xs">المجموع: {report.fixedSummary.reduce((s, x) => s + (x.qty || 0), 0)}</span>
                  </div>
                  <div className="p-4 grid grid-cols-3 md:grid-cols-6 gap-2">
                    {report.fixedSummary.map(({ meal, qty }) => (
                      <div key={meal.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border bg-violet-50 border-violet-200">
                        <span className="text-xs font-medium text-slate-700 truncate">{meal.name}</span>
                        <span className="text-sm font-bold flex-shrink-0 text-violet-700">{qty}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="card overflow-hidden">
                <div className="px-5 py-3 bg-slate-800 flex items-center justify-between">
                  <h3 className="font-bold text-white text-sm">الإحصاء الكلي للأصناف</h3>
                  <span className="text-slate-400 text-xs">المجموع: {report.itemsSummary.reduce((s, x) => s + (x.quantity || 0), 0)}</span>
                </div>
                <div className="p-4 grid grid-cols-3 md:grid-cols-6 gap-2">
                  {report.itemsSummary.map(({ meal, quantity }) => (
                    <div key={meal.id} className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border ${meal.is_snack ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                      <span className="text-xs font-medium text-slate-700 truncate">{meal.name}</span>
                      <span className={`text-sm font-bold flex-shrink-0 ${meal.is_snack ? 'text-amber-700' : 'text-slate-800'}`}>{quantity}</span>
                    </div>
                  ))}
                </div>
              </div>

              {(() => {
                const withCustom = report.beneficiaryDetails.filter(d => d.excludedItems.length > 0 || d.fixedItems.length > 0);
                if (withCustom.length === 0) return (
                  <div className="card p-6 text-center text-slate-400 text-sm">لا يوجد مستفيدون بتخصيصات في هذا الأمر</div>
                );
                return (
                  <div className="card overflow-hidden">
                    <div className="px-5 py-3 bg-slate-50 border-b border-slate-200">
                      <h3 className="font-bold text-slate-800 text-sm">تفاصيل المستفيدين ذوي التخصيصات ({withCustom.length})</h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="bg-slate-50">
                            <th className="table-header">#</th>
                            <th className="table-header">المستفيد</th>
                            <th className="table-header">الكود</th>
                            <th className="table-header">الفيلا</th>
                            <th className="table-header">الممنوع</th>
                            <th className="table-header">البديل</th>
                            <th className="table-header">الثابت اليومي</th>
                          </tr>
                        </thead>
                        <tbody>
                          {withCustom.map((detail, i) => (
                            <tr key={detail.beneficiary.id} className="hover:bg-slate-50">
                              <td className="table-cell text-slate-400 text-xs">{i + 1}</td>
                              <td className="table-cell font-semibold text-slate-800">{detail.beneficiary.name}</td>
                              <td className="table-cell"><code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono">{detail.beneficiary.code}</code></td>
                              <td className="table-cell text-center">
                                {detail.beneficiary.villa
                                  ? <span className="badge bg-blue-50 text-blue-700">{detail.beneficiary.villa}</span>
                                  : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="table-cell">
                                {detail.excludedItems.length === 0
                                  ? <span className="text-slate-300 text-xs">—</span>
                                  : <div className="space-y-0.5">{detail.excludedItems.map(({ meal }) => (
                                    <div key={meal.id} className="badge bg-red-100 text-red-700 text-xs">{meal.name}</div>
                                  ))}</div>}
                              </td>
                              <td className="table-cell">
                                {detail.excludedItems.every(x => !x.alternative)
                                  ? <span className="text-slate-300 text-xs">—</span>
                                  : <div className="space-y-0.5">{detail.excludedItems.map(({ meal, alternative }) => (
                                    <div key={meal.id}>{alternative && <span className="badge bg-emerald-100 text-emerald-700 text-xs">{alternative.name}</span>}</div>
                                  ))}</div>}
                              </td>
                              <td className="table-cell">
                                {detail.fixedItems.length === 0
                                  ? <span className="text-slate-300 text-xs">—</span>
                                  : <div className="flex flex-wrap gap-1">{detail.fixedItems.map(({ meal, quantity }) => (
                                    <span key={meal.id} className="badge bg-violet-100 text-violet-700 text-xs">
                                      {meal.name}{quantity > 1 ? <span className="font-bold mr-0.5">×{quantity}</span> : ''}
                                    </span>
                                  ))}</div>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}

              <div className="hidden print:block text-center text-xs text-slate-500 mt-6 pt-4 border-t border-slate-200">
                {formatNow()}
              </div>
            </div>
          )}
        </>
      )}

      {/* ══════════════════════ PERIOD MODE ════════════════════════════════ */}
      {mode === 'period' && (
        <>
          {/* Week-day selector card */}
          <div className="card p-5 no-print space-y-4">
            <div>
              <h3 className="label mb-3">اختر الأسابيع والأيام</h3>
              <WeekDayGrid selections={selections} onChange={setSelections} />
              {totalSelectedDays === 0 && (
                <p className="text-xs text-slate-400 mt-2 text-center">انقر على أيام لتحديدها — انقر على اسم اليوم لتحديده في كل الأسابيع</p>
              )}
            </div>

            <div className="border-t border-slate-100 pt-4 grid grid-cols-2 gap-4">
              <div>
                <label className="label">نوع الوجبة</label>
                <select
                  value={periodMealType}
                  onChange={e => setPeriodMealType(e.target.value as MealType | '')}
                  className="input-field"
                >
                  <option value="">الكل (فطور + غداء + عشاء)</option>
                  <option value="breakfast">فطور</option>
                  <option value="lunch">غداء</option>
                  <option value="dinner">عشاء</option>
                </select>
              </div>
              <div>
                <label className="label">الفئة المستهدفة</label>
                <select
                  value={periodEntityType}
                  onChange={e => setPeriodEntityType(e.target.value as EntityType | '')}
                  className="input-field"
                >
                  <option value="">الكل</option>
                  <option value="beneficiary">المستفيدون</option>
                  <option value="companion">المرافقون</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-3">
                {totalSelectedDays > 0 && (
                  <span className="text-xs text-emerald-700 font-medium">
                    {totalSelectedDays} يوم محدد عبر {Object.values(selections).filter(s => s.size > 0).length} أسابيع
                  </span>
                )}
                {totalSelectedDays > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelections(emptySelections())}
                    className="text-xs text-slate-400 hover:text-slate-600 underline"
                  >
                    مسح الكل
                  </button>
                )}
              </div>
              <button
                onClick={generatePeriodReport}
                disabled={totalSelectedDays === 0 || loadingPeriod}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loadingPeriod
                  ? <><span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full ml-2" />جاري الحساب...</>
                  : 'احسب الأصناف'}
              </button>
            </div>
          </div>

          {periodError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-5 py-4 rounded-xl">{periodError}</div>
          )}

          {loadingPeriod && (
            <div className="card p-10 text-center">
              <div className="animate-spin w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full mx-auto" />
              <p className="text-slate-400 mt-3">جاري قراءة قائمة الطعام وحساب الكميات...</p>
            </div>
          )}

          {periodReport && !loadingPeriod && (() => {
            const { aggregated, weeksSummary, processedSlots } = periodReport;
            const totalItems = aggregated.itemsSummary.reduce((s, x) => s + x.quantity, 0);

            return (
              <div className="space-y-5">

                {/* Result header */}
                <div className="card p-4 flex items-center gap-6 flex-wrap">
                  <div>
                    <p className="text-xs text-slate-500">الخانات المحسوبة</p>
                    <p className="font-bold text-slate-800">{processedSlots} خانة</p>
                  </div>
                  <div className="w-px h-10 bg-slate-200" />
                  <div>
                    <p className="text-xs text-slate-500">إجمالي الأصناف</p>
                    <p className="font-bold text-emerald-700 text-lg">{totalItems}</p>
                  </div>
                  {periodReport.entityType && (
                    <>
                      <div className="w-px h-10 bg-slate-200" />
                      <div>
                        <p className="text-xs text-slate-500">الفئة</p>
                        <span className={`badge ${ENTITY_BADGE_STYLES[periodReport.entityType]}`}>
                          {ENTITY_TYPE_LABELS_PLURAL[periodReport.entityType]}
                        </span>
                      </div>
                    </>
                  )}
                  {periodReport.mealType && (
                    <>
                      <div className="w-px h-10 bg-slate-200" />
                      <div>
                        <p className="text-xs text-slate-500">الوجبة</p>
                        <span className={`badge ${MEAL_TYPE_STYLES[periodReport.mealType]}`}>
                          {MEAL_TYPE_LABELS[periodReport.mealType]}
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {/* Weeks summary badges */}
                <div className="card overflow-hidden">
                  <div className="px-5 py-3 bg-slate-700 flex items-center justify-between">
                    <h3 className="font-bold text-white text-sm">الأسابيع والأيام المشمولة</h3>
                    <span className="bg-slate-600 text-slate-200 text-xs font-bold px-2.5 py-1 rounded-full">
                      {weeksSummary.length} أسابيع
                    </span>
                  </div>
                  <div className="p-4">
                    <WeeksSummaryBadges weeksSummary={weeksSummary} />
                  </div>
                </div>

                {/* Main meals + alternatives */}
                {aggregated.mainMealsSummary.length > 0 && (
                  <div>
                    <h3 className="text-sm font-bold text-slate-600 mb-2">الأصناف الرئيسية وبدائلها</h3>
                    <SummaryPair
                      leftTitle="الأصناف الرئيسية" leftColor="bg-green-50 text-green-800 border-green-100"
                      leftItems={aggregated.mainMealsSummary as MealCount[]} leftKey="gets"
                      rightTitle="البدائل المستخدمة" rightColor="bg-orange-50 text-orange-800 border-orange-100"
                      rightItems={aggregated.altSummary as MealCount[]} rightKey="qty"
                    />
                  </div>
                )}

                {/* Snacks + alternatives */}
                {aggregated.snackMealsSummary.length > 0 && (
                  <div>
                    <h3 className="text-sm font-bold text-slate-600 mb-2">السناكات وبدائلها</h3>
                    <SummaryPair
                      leftTitle="السناكات" leftColor="bg-amber-50 text-amber-800 border-amber-100"
                      leftItems={aggregated.snackMealsSummary as MealCount[]} leftKey="gets"
                      rightTitle="بدائل السناكات" rightColor="bg-amber-50 text-amber-800 border-amber-100"
                      rightItems={aggregated.snackAltSummary as MealCount[]} rightKey="qty"
                    />
                  </div>
                )}

                {/* Fixed items */}
                {aggregated.fixedSummary.length > 0 && (
                  <div className="card overflow-hidden">
                    <div className="px-5 py-3 bg-violet-700 flex items-center justify-between">
                      <h3 className="font-bold text-white text-sm">الأصناف الثابتة</h3>
                      <span className="text-violet-200 text-xs">المجموع: {aggregated.fixedSummary.reduce((s, x) => s + x.qty, 0)}</span>
                    </div>
                    <div className="p-4 grid grid-cols-3 md:grid-cols-6 gap-2">
                      {aggregated.fixedSummary.map(({ meal, qty }) => (
                        <div key={meal.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border bg-violet-50 border-violet-200">
                          <span className="text-xs font-medium text-slate-700 truncate">{meal.name}</span>
                          <span className="text-sm font-bold flex-shrink-0 text-violet-700">{qty}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Total items grid */}
                <div className="card overflow-hidden">
                  <div className="px-5 py-3 bg-slate-800 flex items-center justify-between">
                    <h3 className="font-bold text-white text-sm">الإحصاء الكلي للأصناف</h3>
                    <span className="text-slate-400 text-xs">المجموع: {totalItems}</span>
                  </div>
                  <div className="p-4 grid grid-cols-3 md:grid-cols-6 gap-2">
                    {aggregated.itemsSummary.map(({ meal, quantity }) => (
                      <div key={meal.id} className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border ${meal.is_snack ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                        <span className="text-xs font-medium text-slate-700 truncate">{meal.name}</span>
                        <span className={`text-sm font-bold flex-shrink-0 ${meal.is_snack ? 'text-amber-700' : 'text-slate-800'}`}>{quantity}</span>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
