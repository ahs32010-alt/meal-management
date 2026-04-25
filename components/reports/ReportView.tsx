'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase-client';
import type { DailyOrder, Meal } from '@/lib/types';
import { MEAL_TYPE_LABELS } from '@/lib/types';
import { formatDate, formatDateFull, formatNow } from '@/lib/date-utils';

const MEAL_TYPE_STYLES: Record<string, string> = {
  breakfast: 'bg-yellow-100 text-yellow-700',
  lunch: 'bg-blue-100 text-blue-700',
  dinner: 'bg-purple-100 text-purple-700',
};

interface ExcludedItem { meal: Meal; alternative: Meal | null }
interface BeneficiaryDetail {
  beneficiary: { id: string; name: string; code: string; villa?: string; category: string };
  excludedItems: ExcludedItem[];
  fixedItems: { meal: Meal; quantity: number }[];
}
interface MealCount { meal: Meal; gets?: number; qty?: number; quantity?: number; mainQty?: number; altQty?: number; fixedQty?: number }
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

interface Props { initialOrderId?: string }

export default function ReportView({ initialOrderId }: Props) {
  const [orders, setOrders] = useState<DailyOrder[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState(initialOrderId || '');
  const [report, setReport] = useState<FullReport | null>(null);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [error, setError] = useState('');
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    supabase.from('daily_orders').select('id, date, meal_type, created_at').order('date', { ascending: false })
      .then(({ data }) => { if (data) setOrders(data as unknown as DailyOrder[]); setLoadingOrders(false); });
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

  useEffect(() => { if (selectedOrderId) generateReport(selectedOrderId); }, [selectedOrderId, generateReport]);

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between no-print">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">التقارير</h1>
          <p className="text-slate-500 text-sm mt-0.5">تقرير تفصيلي لأمر التشغيل</p>
        </div>
        {report && (
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

      {/* Order selector */}
      <div className="card p-4 no-print">
        <label className="label">اختر أمر التشغيل</label>
        {loadingOrders ? <div className="input-field text-slate-400">جاري التحميل...</div> : (
          <select value={selectedOrderId} onChange={e => setSelectedOrderId(e.target.value)} className="input-field">
            <option value="">-- اختر أمر تشغيل --</option>
            {orders.map(o => (
              <option key={o.id} value={o.id}>
                {formatDate(o.date)} — {MEAL_TYPE_LABELS[o.meal_type]}
              </option>
            ))}
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
              {formatDateFull(report.order.date)}
              {' — '}وجبة {MEAL_TYPE_LABELS[report.order.meal_type]}
            </p>
          </div>

          {/* Order info */}
          <div className="card p-4 no-print flex items-center gap-6 flex-wrap">
            <div>
              <p className="text-xs text-slate-500">التاريخ</p>
              <p className="font-bold text-slate-800">
                {formatDateFull(report.order.date)}
              </p>
            </div>
            <div className="w-px h-10 bg-slate-200" />
            <div>
              <p className="text-xs text-slate-500">نوع الوجبة</p>
              <span className={`badge ${MEAL_TYPE_STYLES[report.order.meal_type]}`}>{MEAL_TYPE_LABELS[report.order.meal_type]}</span>
            </div>
            <div className="w-px h-10 bg-slate-200" />
            <div>
              <p className="text-xs text-slate-500">لديهم تخصيصات</p>
              <p className="font-bold text-slate-800">{report.beneficiaryDetails.filter(d => d.excludedItems.length > 0).length}</p>
            </div>
          </div>

          {/* ── الأصناف الرئيسية | بدائلها ── */}
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

          {/* ── السناكات | بدائلها ── */}
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

          {/* ── الأصناف الثابتة ── */}
          {report.fixedSummary && report.fixedSummary.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-5 py-3 bg-violet-700 flex items-center justify-between">
                <h3 className="font-bold text-white text-sm">الأصناف الثابتة اليومية</h3>
                <span className="text-violet-200 text-xs">
                  المجموع: {report.fixedSummary.reduce((s, x) => s + (x.qty || 0), 0)}
                </span>
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

          {/* ── الإحصاء الكلي ── */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3 bg-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-white text-sm">الإحصاء الكلي للأصناف</h3>
              <span className="text-slate-400 text-xs">
                المجموع: {report.itemsSummary.reduce((s, x) => s + (x.quantity || 0), 0)}
              </span>
            </div>
            <div id="items-summary-grid" className="p-4 grid grid-cols-3 md:grid-cols-6 gap-2">
              {report.itemsSummary.map(({ meal, quantity }) => (
                <div key={meal.id} className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border ${meal.is_snack ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                  <span className="text-xs font-medium text-slate-700 truncate">{meal.name}</span>
                  <span className={`text-sm font-bold flex-shrink-0 ${meal.is_snack ? 'text-amber-700' : 'text-slate-800'}`}>{quantity}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── تفاصيل المستفيدين (لهم تخصيصات فقط) ── */}
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
                <div className="overflow-x-auto no-mobile-card">
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
                          <td className="table-cell">
                            <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono">{detail.beneficiary.code}</code>
                          </td>
                          <td className="table-cell text-center">
                            {detail.beneficiary.villa
                              ? <span className="badge bg-blue-50 text-blue-700">{detail.beneficiary.villa}</span>
                              : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="table-cell">
                            {detail.excludedItems.length === 0
                              ? <span className="text-slate-300 text-xs">—</span>
                              : <div className="space-y-0.5">
                                {detail.excludedItems.map(({ meal }) => (
                                  <div key={meal.id} className="badge bg-red-100 text-red-700 text-xs">{meal.name}</div>
                                ))}
                              </div>}
                          </td>
                          <td className="table-cell">
                            {detail.excludedItems.length === 0
                              ? <span className="text-slate-300 text-xs">—</span>
                              : <div className="space-y-0.5">
                                {detail.excludedItems.map(({ meal, alternative }) => (
                                  <div key={meal.id}>
                                    {alternative
                                      ? <span className="badge bg-emerald-100 text-emerald-700 text-xs">{alternative.name}</span>
                                      : null}
                                  </div>
                                ))}
                              </div>}
                          </td>
                          <td className="table-cell">
                            {detail.fixedItems.length === 0
                              ? <span className="text-slate-300 text-xs">—</span>
                              : <div className="flex flex-wrap gap-1">
                                {detail.fixedItems.map(({ meal, quantity }) => (
                                  <span key={meal.id} className="badge bg-violet-100 text-violet-700 text-xs">
                                    {meal.name}{quantity > 1 ? <span className="font-bold mr-0.5">×{quantity}</span> : ''}
                                  </span>
                                ))}
                              </div>}
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
    </div>
  );
}
