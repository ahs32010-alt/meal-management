'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDateFull } from '@/lib/date-utils';
import { exportXLSX } from '@/lib/xlsx-utils';
import { formatMoney, round } from '@/lib/costs';
import { ENTITY_TYPE_LABELS, MEAL_TYPE_LABELS, type MealType } from '@/lib/types';

/** يطابق OrderCostResult في lib/costs-server.ts */
interface CostedItem {
  meal_id: string;
  meal_name: string;
  quantity: number;
  portion_cost: number;
  total_cost: number;
  unpriced: boolean;
  partial: boolean;
}

interface OrderCost {
  order_id: string;
  date: string;
  meal_type: MealType;
  entity_type: 'beneficiary' | 'companion';
  frozen: boolean;
  frozen_at: string | null;
  frozen_by_name: string | null;
  total: number;
  totalPortions: number;
  avgPortionCost: number;
  coverage: number;
  items: CostedItem[];
  unpricedNames: string[];
  partialNames: string[];
  noData: boolean;
}

interface ApiResponse {
  from: string;
  to: string;
  orders: OrderCost[];
  byDate: Record<string, { total: number; portions: number; frozen: number; orders: number }>;
  grandTotal: number;
  totalPortions: number;
}

interface Props {
  canFreeze: boolean;
  canUnfreeze: boolean;
}

const todayStr = () => new Date().toISOString().slice(0, 10);

const shiftDays = (date: string, days: number) => {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

export default function OrderCostsTab({ canFreeze, canUnfreeze }: Props) {
  const [from, setFrom] = useState(todayStr);
  const [to, setTo] = useState(todayStr);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyOrder, setBusyOrder] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/costs/orders?from=${from}&to=${to}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? 'تعذّر جلب التكاليف'); setData(null); }
      else setData(json as ApiResponse);
    } catch {
      setError('تعذّر الاتصال بالخادم');
      setData(null);
    }
    setLoading(false);
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const freeze = async (order: OrderCost, refreeze = false) => {
    setBusyOrder(order.order_id);
    setError('');
    try {
      const res = await fetch('/api/costs/orders/freeze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: order.order_id, refreeze }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? 'تعذّر اعتماد التكلفة');
      else await load();
    } catch { setError('تعذّر الاتصال بالخادم'); }
    setBusyOrder(null);
  };

  const unfreeze = async (order: OrderCost) => {
    setBusyOrder(order.order_id);
    setError('');
    try {
      const res = await fetch('/api/costs/orders/freeze', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: order.order_id }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? 'تعذّر فكّ الاعتماد');
      else await load();
    } catch { setError('تعذّر الاتصال بالخادم'); }
    setBusyOrder(null);
  };

  // تجميع الأوامر حسب اليوم — "تكلفة اليوم بالكامل"
  const days = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, OrderCost[]>();
    for (const o of data.orders) {
      const list = map.get(o.date) ?? [];
      list.push(o);
      map.set(o.date, list);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, orders]) => ({ date, orders }));
  }, [data]);

  const anyUnpriced = useMemo(
    () => (data?.orders ?? []).some(o => o.unpricedNames.length > 0),
    [data],
  );

  const handleExport = () => {
    if (!data || data.orders.length === 0) return;
    const rows: Record<string, string | number>[] = [];
    for (const o of data.orders) {
      for (const item of o.items) {
        rows.push({
          'التاريخ': o.date,
          'الوجبة': MEAL_TYPE_LABELS[o.meal_type],
          'الفئة': ENTITY_TYPE_LABELS[o.entity_type],
          'الصنف': item.meal_name,
          'الكمية': item.quantity,
          'تكلفة الحصة': round(item.portion_cost, 4),
          'الإجمالي': round(item.total_cost, 2),
          'الحالة': item.unpriced ? 'بدون تسعير' : item.partial ? 'تسعير ناقص' : 'مسعّر',
          'اعتماد': o.frozen ? 'مجمّدة' : 'مباشر',
        });
      }
    }
    void exportXLSX(rows, `order-costs-${from}_${to}.xlsx`, 'تكاليف أوامر التشغيل');
  };

  return (
    <div className="space-y-4">
      {/* اختيار الفترة */}
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">من تاريخ</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input-field w-auto" />
          </div>
          <div>
            <label className="label">إلى تاريخ</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className="input-field w-auto" />
          </div>
          <button onClick={() => void load()} disabled={loading} className="btn-primary text-sm">
            {loading ? 'جاري الحساب...' : 'حساب التكلفة'}
          </button>
          {data && data.orders.length > 0 && (
            <button onClick={handleExport} className="btn-secondary text-sm">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              تصدير
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {[
            { label: 'اليوم',        from: todayStr(),                 to: todayStr() },
            { label: 'أمس',          from: shiftDays(todayStr(), -1),  to: shiftDays(todayStr(), -1) },
            { label: 'آخر 7 أيام',   from: shiftDays(todayStr(), -6),  to: todayStr() },
            { label: 'آخر 30 يوم',   from: shiftDays(todayStr(), -29), to: todayStr() },
          ].map(p => (
            <button
              key={p.label}
              onClick={() => { setFrom(p.from); setTo(p.to); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                from === p.from && to === p.to
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      {/* الملخّص العام */}
      {data && data.orders.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="card px-4 py-3 bg-gradient-to-l from-emerald-50 to-white border-emerald-200">
            <div className="text-xs text-emerald-700 font-semibold">إجمالي التكلفة</div>
            <div className="text-2xl font-extrabold text-emerald-700 tabular-nums" dir="ltr">{formatMoney(data.grandTotal)}</div>
            <div className="text-[11px] text-emerald-600/70">ريال</div>
          </div>
          <div className="card px-4 py-3">
            <div className="text-xs text-slate-500 font-semibold">إجمالي الحصص</div>
            <div className="text-2xl font-extrabold text-slate-800 tabular-nums">{data.totalPortions.toLocaleString('en-US')}</div>
          </div>
          <div className="card px-4 py-3">
            <div className="text-xs text-slate-500 font-semibold">متوسط تكلفة الحصة</div>
            <div className="text-2xl font-extrabold text-slate-800 tabular-nums" dir="ltr">
              {formatMoney(data.totalPortions > 0 ? data.grandTotal / data.totalPortions : 0)}
            </div>
          </div>
          <div className="card px-4 py-3">
            <div className="text-xs text-slate-500 font-semibold">عدد الأوامر</div>
            <div className="text-2xl font-extrabold text-slate-800">{data.orders.length}</div>
          </div>
        </div>
      )}

      {anyUnpriced && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg text-sm">
          ⚠️ فيه أصناف بدون تسعير داخل هذه الفترة — تكلفتها محسوبة صفراً، يعني <b>الإجمالي أقل من الحقيقي</b>.
          سعّرها من تبويب &quot;تسعير الأصناف&quot; عشان يضبط الرقم.
        </div>
      )}

      {/* النتائج */}
      {loading ? (
        <div className="card py-12 text-center text-slate-400 text-sm">جاري الحساب...</div>
      ) : !data || data.orders.length === 0 ? (
        <div className="card py-12 text-center text-slate-400 text-sm">
          ما فيه أوامر تشغيل في هذه الفترة
        </div>
      ) : (
        <div className="space-y-4">
          {days.map(({ date, orders }) => {
            const dayTotal = orders.reduce((s, o) => s + o.total, 0);
            const dayPortions = orders.reduce((s, o) => s + o.totalPortions, 0);
            return (
              <div key={date} className="card overflow-hidden">
                {/* رأس اليوم */}
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-slate-50 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-800 text-sm">{formatDateFull(date)}</span>
                    <span className="badge bg-slate-200 text-slate-600">{orders.length} أمر</span>
                    <span className="badge bg-slate-200 text-slate-600">{dayPortions.toLocaleString('en-US')} حصة</span>
                  </div>
                  <div className="text-left">
                    <div className="text-[11px] text-slate-500 font-semibold">تكلفة اليوم كاملاً</div>
                    <div className="text-xl font-extrabold text-emerald-700 tabular-nums" dir="ltr">
                      {formatMoney(dayTotal)} <span className="text-xs font-bold">ريال</span>
                    </div>
                  </div>
                </div>

                {/* أوامر اليوم */}
                <div className="divide-y divide-slate-100">
                  {orders.map(order => {
                    const isOpen = expanded.has(order.order_id);
                    const busy = busyOrder === order.order_id;
                    return (
                      <div key={order.order_id}>
                        <div className="flex flex-wrap items-center gap-2 px-4 py-3 hover:bg-slate-50">
                          <button
                            onClick={() => toggle(order.order_id)}
                            className="flex items-center gap-2 flex-1 min-w-[180px] text-right"
                          >
                            {/* سهم لأسفل عند الفتح، ولليسار عند الطيّ (اتجاه RTL) */}
                            <svg
                              className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? '' : 'rotate-90'}`}
                              fill="none" stroke="currentColor" viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                            <span className="font-semibold text-slate-800 text-sm">{MEAL_TYPE_LABELS[order.meal_type]}</span>
                            <span className="badge bg-slate-100 text-slate-600 text-[10px]">
                              {ENTITY_TYPE_LABELS[order.entity_type]}
                            </span>
                            <span className="text-xs text-slate-400">{order.totalPortions.toLocaleString('en-US')} حصة</span>
                          </button>

                          {/* حالة الاعتماد */}
                          {order.frozen ? (
                            <span
                              className="badge bg-indigo-50 text-indigo-700 border border-indigo-200"
                              title={`اعتُمدت ${order.frozen_at ? new Date(order.frozen_at).toLocaleString('en-GB') : ''}${order.frozen_by_name ? ` — ${order.frozen_by_name}` : ''}`}
                            >
                              🔒 معتمدة
                            </span>
                          ) : (
                            <span className="badge bg-slate-100 text-slate-500" title="محسوبة بأسعار المواد الحالية">
                              ● مباشر
                            </span>
                          )}

                          {order.coverage < 100 && !order.noData && (
                            <span className="badge bg-amber-100 text-amber-700" title={`أصناف غير مسعّرة: ${order.unpricedNames.join('، ') || '—'}`}>
                              تغطية {Math.round(order.coverage)}%
                            </span>
                          )}

                          <div className="font-extrabold text-slate-800 tabular-nums text-left min-w-[100px]" dir="ltr">
                            {formatMoney(order.total)}
                          </div>

                          {/* أزرار الاعتماد */}
                          <div className="flex items-center gap-1">
                            {!order.frozen && canFreeze && !order.noData && (
                              <button
                                onClick={() => void freeze(order)}
                                disabled={busy}
                                title="حفظ التكلفة بأسعار اليوم — ما تتأثر بتغيّر الأسعار بعدين"
                                className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors disabled:opacity-40"
                              >
                                {busy ? '...' : 'اعتماد'}
                              </button>
                            )}
                            {order.frozen && canFreeze && (
                              <button
                                onClick={() => void freeze(order, true)}
                                disabled={busy}
                                title="إعادة الحساب بالأسعار الحالية واستبدال المعتمد"
                                className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-40"
                              >
                                {busy ? '...' : 'إعادة اعتماد'}
                              </button>
                            )}
                            {order.frozen && canUnfreeze && (
                              <button
                                onClick={() => void unfreeze(order)}
                                disabled={busy}
                                title="فكّ الاعتماد فترجع محسوبة مباشرة"
                                className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
                              >
                                فكّ
                              </button>
                            )}
                          </div>
                        </div>

                        {/* تفصيل الأصناف */}
                        {isOpen && (
                          <div className="bg-slate-50/60 px-4 pb-4">
                            {order.noData ? (
                              <div className="py-4 text-center text-slate-400 text-xs">
                                ما فيه كميات محسوبة لهذا الأمر — افتحه من صفحة أوامر التشغيل واحفظه.
                              </div>
                            ) : (
                              <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="text-[11px] text-slate-500">
                                      <th className="text-right py-2 font-bold">الصنف</th>
                                      <th className="text-right py-2 font-bold">الكمية</th>
                                      <th className="text-right py-2 font-bold">تكلفة الحصة</th>
                                      <th className="text-left py-2 font-bold">الإجمالي</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-200">
                                    {order.items.map(item => (
                                      <tr key={item.meal_id}>
                                        <td className="py-2">
                                          <span className="text-slate-700">{item.meal_name}</span>
                                          {item.unpriced && <span className="badge bg-red-50 text-red-600 text-[10px] mr-1.5">بدون تسعير</span>}
                                          {item.partial && <span className="badge bg-amber-100 text-amber-700 text-[10px] mr-1.5">ناقص</span>}
                                        </td>
                                        <td className="py-2 text-slate-600 tabular-nums">{item.quantity.toLocaleString('en-US')}</td>
                                        <td className="py-2 text-slate-600 tabular-nums" dir="ltr">{formatMoney(item.portion_cost)}</td>
                                        <td className="py-2 text-left font-bold text-slate-800 tabular-nums" dir="ltr">{formatMoney(item.total_cost)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                  <tfoot>
                                    <tr className="border-t-2 border-slate-300">
                                      <td className="py-2 font-bold text-slate-700">الإجمالي</td>
                                      <td className="py-2 font-bold text-slate-700 tabular-nums">{order.totalPortions.toLocaleString('en-US')}</td>
                                      <td className="py-2 text-xs text-slate-500" dir="ltr">
                                        متوسط {formatMoney(order.avgPortionCost)}
                                      </td>
                                      <td className="py-2 text-left font-extrabold text-emerald-700 tabular-nums" dir="ltr">
                                        {formatMoney(order.total)}
                                      </td>
                                    </tr>
                                  </tfoot>
                                </table>

                                {order.frozen && (
                                  <p className="text-[11px] text-indigo-600 mt-2">
                                    🔒 هذي أرقام معتمدة بأسعار
                                    {order.frozen_at ? ` ${new Date(order.frozen_at).toLocaleDateString('en-GB')}` : ''}
                                    {order.frozen_by_name ? ` — اعتمدها ${order.frozen_by_name}` : ''}.
                                    تغيّر أسعار المواد بعدها ما يأثر عليها.
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
