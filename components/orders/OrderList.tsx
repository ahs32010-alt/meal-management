'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase-client';
import type { DailyOrder, Meal } from '@/lib/types';
import { MEAL_TYPE_LABELS } from '@/lib/types';
import { formatDate } from '@/lib/date-utils';
import OrderModal from './OrderModal';

const MEAL_TYPE_STYLES: Record<string, string> = {
  breakfast: 'bg-yellow-100 text-yellow-700',
  lunch: 'bg-blue-100 text-blue-700',
  dinner: 'bg-purple-100 text-purple-700',
};

export default function OrderList() {
  const [orders, setOrders] = useState<DailyOrder[]>([]);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [totalBeneficiaries, setTotalBeneficiaries] = useState(0);
  const [exclusionCounts, setExclusionCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<DailyOrder | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [ordersResult, mealsResult, bensResult, exclusionsResult] = await Promise.all([
        supabase
          .from('daily_orders')
          .select(`id, date, meal_type, created_at, order_items(id, meal_id, display_name, extra_quantity, meals(id, name, is_snack))`)
          .order('date', { ascending: false }),
        supabase.from('meals').select('id, name, english_name, type, is_snack, created_at').order('type').order('is_snack').order('name'),
        supabase.from('beneficiaries').select('id', { count: 'exact', head: true }),
        supabase.from('exclusions').select('meal_id'),
      ]);

      if (ordersResult.data) setOrders(ordersResult.data as unknown as DailyOrder[]);
      if (mealsResult.data) setMeals(mealsResult.data as Meal[]);
      if (bensResult.count != null) setTotalBeneficiaries(bensResult.count);

      if (exclusionsResult.data) {
        const counts: Record<string, number> = {};
        for (const ex of exclusionsResult.data) {
          counts[ex.meal_id] = (counts[ex.meal_id] ?? 0) + 1;
        }
        setExclusionCounts(counts);
      }
    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDelete = async (id: string) => {
    if (!confirm('هل أنت متأكد من حذف أمر التشغيل هذا؟')) return;
    setDeleting(id);
    await supabase.from('daily_orders').delete().eq('id', id);
    await fetchData();
    setDeleting(null);
  };

  const itemLabel = (item: { display_name?: string | null; meals?: { name?: string } | null }) =>
    item.display_name ?? item.meals?.name ?? '';

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">أوامر التشغيل</h1>
          <p className="text-slate-500 text-sm mt-0.5">{orders.length} أمر تشغيل</p>
        </div>
        <button onClick={() => { setEditingOrder(null); setIsModalOpen(true); }} className="btn-primary">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          إنشاء أمر تشغيل
        </button>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full mx-auto" />
            <p className="text-slate-400 mt-3 text-sm">جاري التحميل...</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <svg className="w-14 h-14 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="font-medium">لا توجد أوامر تشغيل</p>
            <p className="text-sm mt-1">ابدأ بإنشاء أمر تشغيل جديد</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50">
                  <th className="table-header">#</th>
                  <th className="table-header">التاريخ</th>
                  <th className="table-header">نوع الوجبة</th>
                  <th className="table-header">الأصناف</th>
                  <th className="table-header text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order, index) => (
                  <tr key={order.id} className="hover:bg-slate-50 transition-colors">
                    <td className="table-cell text-slate-400 text-xs">{index + 1}</td>
                    <td className="table-cell font-semibold text-slate-800">
                      {formatDate(order.date)}
                    </td>
                    <td className="table-cell">
                      <span className={`badge ${MEAL_TYPE_STYLES[order.meal_type]}`}>
                        {MEAL_TYPE_LABELS[order.meal_type]}
                      </span>
                    </td>
                    <td className="table-cell">
                      {!order.order_items || order.order_items.length === 0 ? (
                        <span className="text-slate-400 text-xs">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {order.order_items.map((item) => {
                            const label = itemLabel(item);
                            const extra = item.extra_quantity ?? 0;
                            const count = Math.max(0, totalBeneficiaries - (exclusionCounts[item.meal_id] ?? 0));
                            return (
                              <div key={item.id}
                                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border ${item.meals?.is_snack ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-slate-50 border-slate-200 text-slate-700'}`}
                              >
                                <span>{label}</span>
                                <span className={`font-bold ${item.meals?.is_snack ? 'text-amber-600' : 'text-emerald-700'}`}>
                                  {count}{extra > 0 ? `+${extra}` : ''}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center justify-center gap-2">
                        <Link
                          href={`/reports?orderId=${order.id}`}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-semibold hover:bg-emerald-100 transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          التقرير
                        </Link>
                        <button
                          onClick={() => { setEditingOrder(order); setIsModalOpen(true); }}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="تعديل"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDelete(order.id)}
                          disabled={deleting === order.id}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
                          title="حذف"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isModalOpen && (
        <OrderModal
          meals={meals}
          totalBeneficiaries={totalBeneficiaries}
          exclusionCounts={exclusionCounts}
          editingOrder={editingOrder}
          onClose={() => { setIsModalOpen(false); setEditingOrder(null); }}
          onSaved={() => { setIsModalOpen(false); setEditingOrder(null); fetchData(); }}
        />
      )}
    </div>
  );
}
