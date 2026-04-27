'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { createClient } from '@/lib/supabase-client';
import { logActivity } from '@/lib/activity-log';
import type { DailyOrder, Meal, EntityType } from '@/lib/types';
import { MEAL_TYPE_LABELS, ENTITY_TYPE_LABELS, ENTITY_TYPE_LABELS_PLURAL, ENTITY_BADGE_STYLES, DAY_LABELS } from '@/lib/types';
import { formatDate, formatDateTime } from '@/lib/date-utils';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import Pagination from '@/components/shared/Pagination';
import { usePagination } from '@/lib/use-pagination';

const OrderModal = dynamic(() => import('./OrderModal'), { ssr: false });

const MEAL_TYPE_STYLES: Record<string, string> = {
  breakfast: 'bg-yellow-100 text-yellow-700',
  lunch: 'bg-blue-100 text-blue-700',
  dinner: 'bg-purple-100 text-purple-700',
};

// عدد المستفيدين/المرافقين وعدد المحظورات لكل صنف — مفصول حسب نوع الكيان.
type EntityCounts = { total: number; exclusions: Record<string, number> };
const EMPTY_COUNTS: EntityCounts = { total: 0, exclusions: {} };

export default function OrderList() {
  const [orders, setOrders] = useState<DailyOrder[]>([]);
  const [meals, setMeals] = useState<Meal[]>([]);
  // نخزن عدّاد لكل نوع — كل أمر تشغيل يستخدم العداد الخاص بنوعه.
  const [counts, setCounts] = useState<Record<EntityType, EntityCounts>>({
    beneficiary: EMPTY_COUNTS,
    companion: EMPTY_COUNTS,
  });
  // مهم: نتأكد إن العمود entity_type موجود في DB قبل ما نظهر اختيار النوع
  // (لو الـmigration ما اتشغّل، نخفي الميزة بدل ما يتصلّح خطأ)
  const [hasEntityTypeColumn, setHasEntityTypeColumn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalEntityType, setModalEntityType] = useState<EntityType>('beneficiary');
  const [pickEntityOpen, setPickEntityOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<DailyOrder | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);
  const [search, setSearch] = useState('');
  const supabase = useMemo(() => createClient(), []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Try with the snapshot + entity_type columns first; fall back if either
      // migration hasn't been run yet so the page still works.
      const fetchOrders = async (withSnapshot: boolean, withEntityType: boolean) => {
        // ⚠️ نجلب week_number/day_of_week عشان OrderModal يقدر يفتح الأمر
        //    للتعديل بقيم الأسبوع/اليوم محفوظة (وإلا يطلب اختيارهم من جديد
        //    عند الحفظ). ما نجلب week_of_month (العمود القديم) لأن الـRPC
        //    الحالي يخزّن في week_number فقط.
        // ⚠️ نجلب `category` من order_items عشان لا تنقلب الفئة إلى الافتراضي
        //    (حار) في OrderModal.initSelected ويفقد المستخدم تصنيفاته.
        const baseCols = `id, date, meal_type, week_number, day_of_week, created_at`;
        const extra = `${withSnapshot ? ', snapshot' : ''}${withEntityType ? ', entity_type' : ''}`;
        const sel = `${baseCols}${extra}, order_items(id, meal_id, display_name, extra_quantity, category, multiplier, meals(id, name, is_snack))`;
        return supabase.from('daily_orders').select(sel).order('date', { ascending: false });
      };

      let entityTypeOk = true;
      let ordersResult = await fetchOrders(true, true);
      if (ordersResult.error && /entity_type|column/i.test(ordersResult.error.message)) {
        entityTypeOk = false;
        ordersResult = await fetchOrders(true, false);
      }
      if (ordersResult.error && /snapshot|column/i.test(ordersResult.error.message)) {
        ordersResult = await fetchOrders(false, entityTypeOk);
        if (ordersResult.error && /entity_type|column/i.test(ordersResult.error.message)) {
          entityTypeOk = false;
          ordersResult = await fetchOrders(false, false);
        }
      }
      setHasEntityTypeColumn(entityTypeOk);

      // نجلب المستفيدين والمحظورات مع entity_type عشان نقدر نقسّم العداد.
      // لو entity_type ما كان موجود في beneficiaries (migration ما اتشغّل)،
      // نعتبر الكل مستفيدين.
      const bensSelect = entityTypeOk ? 'id, entity_type' : 'id';
      const exclSelect = entityTypeOk
        ? 'meal_id, beneficiaries!inner(entity_type)'
        : 'meal_id';

      // الأصناف نجلبها كاملة مع عمود entity_type عشان OrderModal يفلتر
      // حسب نوع الأمر (مستفيدين/مرافقين). لو العمود ما موجود نرجع للسلوك القديم.
      const fetchMealsList = async () => {
        const r = await supabase
          .from('meals')
          .select('id, name, english_name, type, is_snack, entity_type, created_at')
          .order('type').order('is_snack').order('name');
        if (r.error && /entity_type|column/i.test(r.error.message)) {
          return supabase
            .from('meals')
            .select('id, name, english_name, type, is_snack, created_at')
            .order('type').order('is_snack').order('name');
        }
        return r;
      };

      const [mealsResult, bensResult, exclusionsResult] = await Promise.all([
        fetchMealsList(),
        supabase.from('beneficiaries').select(bensSelect),
        supabase.from('exclusions').select(exclSelect),
      ]);

      if (ordersResult.error) {
        console.error('Orders fetch error:', ordersResult.error);
      }
      if (ordersResult.data) setOrders(ordersResult.data as unknown as DailyOrder[]);
      if (mealsResult.data) setMeals(mealsResult.data as Meal[]);

      // نبني عدّادات منفصلة لكل entity_type
      const nextCounts: Record<EntityType, EntityCounts> = {
        beneficiary: { total: 0, exclusions: {} },
        companion:   { total: 0, exclusions: {} },
      };

      if (bensResult.data) {
        for (const b of bensResult.data as Array<{ entity_type?: string }>) {
          const t: EntityType = (b.entity_type === 'companion' ? 'companion' : 'beneficiary');
          nextCounts[t].total++;
        }
      }

      if (exclusionsResult.data) {
        const rows = exclusionsResult.data as unknown as Array<{
          meal_id: string;
          beneficiaries?: { entity_type?: string } | { entity_type?: string }[] | null;
        }>;
        for (const ex of rows) {
          // قد يرجع `beneficiaries` إما object (لو !inner) أو array (لو join عادي)
          const ben = Array.isArray(ex.beneficiaries) ? ex.beneficiaries[0] : ex.beneficiaries;
          const t: EntityType = (ben?.entity_type === 'companion' ? 'companion' : 'beneficiary');
          nextCounts[t].exclusions[ex.meal_id] = (nextCounts[t].exclusions[ex.meal_id] ?? 0) + 1;
        }
      }

      setCounts(nextCounts);
    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDelete = (id: string) => {
    const order = orders.find(o => o.id === id);
    setDialog({
      title: 'حذف أمر التشغيل',
      message: `هل أنت متأكد من حذف أمر التشغيل${order ? ` بتاريخ ${order.date}` : ''}؟ لا يمكن التراجع عن هذه العملية.`,
      onConfirm: async () => {
        setDialog(null);
        setDeleting(id);
        await supabase.from('daily_orders').delete().eq('id', id);
        void logActivity({
          action: 'delete',
          entity_type: 'order',
          entity_id: id,
          entity_name: order ? `أمر تشغيل ${MEAL_TYPE_LABELS[order.meal_type]} — ${order.date}` : null,
          details: order ? { date: order.date, meal_type: order.meal_type } : null,
        });
        await fetchData();
        setDeleting(null);
      },
    });
  };

  const itemLabel = (item: { display_name?: string | null; meals?: { name?: string } | null }) =>
    item.display_name ?? item.meals?.name ?? '';

  // بحث شامل: يطابق التاريخ، اسم اليوم، نوع الوجبة، الفئة (مستفيدون/مرافقون)،
  // أسماء الأصناف، وكلمة "سناك" لو الصنف سناك.
  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter(order => {
      const orderEntity: EntityType = order.entity_type === 'companion' ? 'companion' : 'beneficiary';
      const dayLabel = DAY_LABELS[new Date(order.date).getDay()] ?? '';
      const itemsText = (order.order_items ?? [])
        .map(i => `${i.display_name ?? i.meals?.name ?? ''} ${i.meals?.is_snack ? 'سناك snack' : ''}`)
        .join(' ');
      const haystack = [
        order.date,
        formatDate(order.date),
        dayLabel,
        MEAL_TYPE_LABELS[order.meal_type] ?? '',
        ENTITY_TYPE_LABELS[orderEntity],
        ENTITY_TYPE_LABELS_PLURAL[orderEntity],
        itemsText,
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [orders, search]);

  const pagination = usePagination(filteredOrders, { pageSize: 25 });

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">أوامر التشغيل</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {search.trim()
              ? `${filteredOrders.length} نتيجة من ${orders.length} أمر تشغيل`
              : `${orders.length} أمر تشغيل`}
          </p>
        </div>
        <button
          onClick={() => {
            setEditingOrder(null);
            // لو الـmigration ما اتشغّل بعد، نخش مباشرة بنوع المستفيدين عشان ما نكسر شي
            if (!hasEntityTypeColumn) {
              setModalEntityType('beneficiary');
              setIsModalOpen(true);
              return;
            }
            // نطلب من المستخدم يختار: مستفيدين ولا مرافقين؟
            setPickEntityOpen(true);
          }}
          className="btn-primary"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          إنشاء أمر تشغيل
        </button>
      </div>

      {/* Search */}
      <div className="card p-3">
        <div className="relative">
          <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); pagination.setPage(1); }}
            placeholder="ابحث عن وجبة، صنف، سناك، تاريخ، اليوم، مستفيد/مرافق…"
            className="input-field pr-9"
            dir="rtl"
          />
          {search && (
            <button
              type="button"
              onClick={() => { setSearch(''); pagination.setPage(1); }}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm"
              title="مسح"
            >
              ✕
            </button>
          )}
        </div>
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
        ) : filteredOrders.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <svg className="w-14 h-14 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p className="font-medium">ما لقيت نتائج لـ &quot;{search}&quot;</p>
            <p className="text-sm mt-1">جرب كلمة بحث ثانية أو امسح الفلتر</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50">
                  <th className="table-header">#</th>
                  <th className="table-header">التاريخ</th>
                  <th className="table-header">اليوم</th>
                  <th className="table-header">الفئة</th>
                  <th className="table-header">نوع الوجبة</th>
                  <th className="table-header">الأصناف</th>
                  <th className="table-header">تاريخ الإنشاء</th>
                  <th className="table-header text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {pagination.pageItems.map((order, index) => {
                  const orderEntity: EntityType = (order.entity_type === 'companion' ? 'companion' : 'beneficiary');
                  const entityCounts = counts[orderEntity];
                  return (
                  <tr key={order.id} className="hover:bg-slate-50 transition-colors">
                    <td className="table-cell text-slate-400 text-xs">
                      {(pagination.page - 1) * pagination.pageSize + index + 1}
                    </td>
                    <td className="table-cell font-semibold text-slate-800">
                      {formatDate(order.date)}
                    </td>
                    <td className="table-cell text-slate-600">
                      {DAY_LABELS[new Date(order.date).getDay()] ?? '—'}
                    </td>
                    <td className="table-cell">
                      <span className={`badge ${ENTITY_BADGE_STYLES[orderEntity]}`}>
                        {ENTITY_TYPE_LABELS_PLURAL[orderEntity]}
                      </span>
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
                            const mult = item.multiplier ?? 1;
                            // Prefer the order's snapshot count (frozen at save time).
                            // Fall back to the live calculation if no snapshot yet.
                            const snap = (order as DailyOrder & { snapshot?: { itemFinalCounts?: Record<string, number> } }).snapshot;
                            const snapCount = snap?.itemFinalCounts?.[item.meal_id];
                            const liveBase = Math.max(0, entityCounts.total - (entityCounts.exclusions[item.meal_id] ?? 0));
                            const finalCount = snapCount != null
                              ? snapCount
                              : liveBase * mult + extra;
                            const isFrozen = snapCount != null;
                            return (
                              <div key={item.id}
                                title={isFrozen ? 'محفوظ من وقت إنشاء الأمر' : 'محسوب بناءً على الوضع الحالي'}
                                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border ${item.meals?.is_snack ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-slate-50 border-slate-200 text-slate-700'}`}
                              >
                                <span>{label}</span>
                                {mult > 1 && (
                                  <span
                                    title={`مضاعف ×${mult}`}
                                    className="font-bold text-violet-700 bg-violet-50 border border-violet-200 rounded px-1 leading-none"
                                  >
                                    ×{mult}
                                  </span>
                                )}
                                <span className={`font-bold ${item.meals?.is_snack ? 'text-amber-600' : 'text-emerald-700'}`}>
                                  {finalCount}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </td>
                    <td className="table-cell text-slate-500 text-xs whitespace-nowrap">
                      {order.created_at ? formatDateTime(order.created_at) : '—'}
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
                        <Link
                          href={`/orders/${order.id}/print`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-semibold hover:bg-blue-100 transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          PDF
                        </Link>
                        <button
                          onClick={() => {
                            setEditingOrder(order);
                            setModalEntityType(orderEntity);
                            setIsModalOpen(true);
                          }}
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
                  );
                })}
              </tbody>
            </table>
            <Pagination
              page={pagination.page}
              pageCount={pagination.pageCount}
              pageSize={pagination.pageSize}
              total={pagination.total}
              onPageChange={pagination.setPage}
            />
          </div>
        )}
      </div>

      {isModalOpen && (
        <OrderModal
          meals={meals}
          entityType={modalEntityType}
          totalBeneficiaries={counts[modalEntityType].total}
          exclusionCounts={counts[modalEntityType].exclusions}
          editingOrder={editingOrder}
          onClose={() => { setIsModalOpen(false); setEditingOrder(null); }}
          onSaved={() => { setIsModalOpen(false); setEditingOrder(null); fetchData(); }}
        />
      )}

      {/* اختيار نوع الكيان قبل فتح المعالج: مستفيدين أو مرافقين */}
      {pickEntityOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="font-bold text-slate-800">إنشاء أمر تشغيل لمن؟</h3>
              <p className="text-xs text-slate-500 mt-0.5">اختَر فئة المستهدفين — يُعرض بعدها التخصيصات الخاصة بهم فقط.</p>
            </div>
            <div className="p-4 grid grid-cols-2 gap-3">
              {(['beneficiary', 'companion'] as EntityType[]).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setModalEntityType(t);
                    setPickEntityOpen(false);
                    setIsModalOpen(true);
                  }}
                  className={`flex flex-col items-center gap-2 py-5 rounded-xl border-2 transition-all hover:shadow-md ${
                    t === 'beneficiary'
                      ? 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800'
                      : 'border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-800'
                  }`}
                >
                  <span className="text-3xl">{t === 'beneficiary' ? '👥' : '🧑‍🤝‍🧑'}</span>
                  <span className="font-bold text-sm">{ENTITY_TYPE_LABELS_PLURAL[t]}</span>
                  <span className="text-[11px] opacity-70">{counts[t].total} مسجّل</span>
                </button>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setPickEntityOpen(false)}
                className="text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-100"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!dialog}
        title={dialog?.title ?? ''}
        message={dialog?.message ?? ''}
        onConfirm={() => dialog?.onConfirm()}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}
