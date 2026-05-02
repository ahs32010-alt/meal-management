'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { logActivity } from '@/lib/activity-log';
import type { DeliveryOrder } from '@/lib/types';
import { DELIVERY_MEAL_TYPE_LABELS, DAY_LABELS } from '@/lib/types';
import { formatDate, formatDateTime } from '@/lib/date-utils';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import Pagination from '@/components/shared/Pagination';
import { usePagination } from '@/lib/use-pagination';

const DeliveryOrderModal = dynamic(() => import('./DeliveryOrderModal'), { ssr: false });
const DeliveryPrintHeaderModal = dynamic(() => import('./DeliveryPrintHeaderModal'), { ssr: false });

const MEAL_TYPE_STYLES: Record<string, string> = {
  breakfast: 'bg-yellow-100 text-yellow-700',
  lunch: 'bg-blue-100 text-blue-700',
  dinner: 'bg-purple-100 text-purple-700',
  all: 'bg-emerald-100 text-emerald-700',
};

export default function DeliveryOrderList() {
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isHeaderModalOpen, setIsHeaderModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<DeliveryOrder | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);
  const [search, setSearch] = useState('');

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/delivery-orders');
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        console.error('Fetch delivery orders failed:', j);
        setOrders([]);
        return;
      }
      const data: DeliveryOrder[] = await res.json();
      setOrders(data);
    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const handleDelete = (order: DeliveryOrder) => {
    setDialog({
      title: 'حذف أمر التسليم',
      message: `هل أنت متأكد من حذف أمر التسليم رقم ${order.order_number}؟ لا يمكن التراجع عن هذه العملية.`,
      onConfirm: async () => {
        setDialog(null);
        setDeleting(order.id);
        const res = await fetch(`/api/delivery-orders/${order.id}`, { method: 'DELETE' });
        if (res.ok) {
          void logActivity({
            action: 'delete',
            entity_type: 'order',
            entity_id: order.id,
            entity_name: `أمر تسليم ${order.order_number}`,
          });
          await fetchOrders();
        } else {
          const j = await res.json().catch(() => ({}));
          alert(j.error ?? 'تعذّر الحذف');
        }
        setDeleting(null);
      },
    });
  };

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter(order => {
      const dayLabel = DAY_LABELS[new Date(order.date).getDay()] ?? '';
      const itemsText = (order.delivery_order_items ?? [])
        .map(i => i.display_name)
        .join(' ');
      const haystack = [
        order.order_number,
        order.date,
        formatDate(order.date),
        dayLabel,
        DELIVERY_MEAL_TYPE_LABELS[order.meal_type] ?? '',
        order.delivery_locations?.name ?? '',
        order.delivery_locations?.cities?.name ?? '',
        order.created_by_name ?? '',
        order.created_by_phone ?? '',
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
          <h1 className="text-2xl font-bold text-slate-800">أوامر التسليم</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {search.trim()
              ? `${filteredOrders.length} نتيجة من ${orders.length} أمر تسليم`
              : `${orders.length} أمر تسليم`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsHeaderModalOpen(true)}
            className="btn-secondary"
            title="تعديل بيانات الهيدر التي تظهر في الطباعة"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            بيانات الهيدر
          </button>
          <button
            onClick={() => { setEditingOrder(null); setIsModalOpen(true); }}
            className="btn-primary"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            إنشاء أمر تسليم
          </button>
        </div>
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
            placeholder="ابحث عن رقم الأمر، التاريخ، الموقع، المنشئ، أو صنف…"
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
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
            </svg>
            <p className="font-medium">لا توجد أوامر تسليم</p>
            <p className="text-sm mt-1">ابدأ بإنشاء أمر تسليم جديد</p>
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
                  <th className="table-header">رقم الأمر</th>
                  <th className="table-header">التاريخ</th>
                  <th className="table-header">اليوم</th>
                  <th className="table-header">نوع الوجبة</th>
                  <th className="table-header">موقع التسليم</th>
                  <th className="table-header">المدينة</th>
                  <th className="table-header">المنشئ</th>
                  <th className="table-header">عدد الأصناف</th>
                  <th className="table-header">تاريخ الإنشاء</th>
                  <th className="table-header text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {pagination.pageItems.map((order, index) => (
                  <tr key={order.id} className="hover:bg-slate-50 transition-colors">
                    <td className="table-cell text-slate-400 text-xs">
                      {(pagination.page - 1) * pagination.pageSize + index + 1}
                    </td>
                    <td className="table-cell font-mono font-bold text-emerald-700">
                      {order.order_number}
                    </td>
                    <td className="table-cell font-semibold text-slate-800">
                      {formatDate(order.date)}
                    </td>
                    <td className="table-cell text-slate-600">
                      {DAY_LABELS[new Date(order.date).getDay()] ?? '—'}
                    </td>
                    <td className="table-cell">
                      <span className={`badge ${MEAL_TYPE_STYLES[order.meal_type]}`}>
                        {DELIVERY_MEAL_TYPE_LABELS[order.meal_type]}
                      </span>
                    </td>
                    <td className="table-cell text-slate-700">
                      {order.delivery_locations?.name ?? '—'}
                    </td>
                    <td className="table-cell text-slate-600">
                      {order.delivery_locations?.cities?.name ?? '—'}
                    </td>
                    <td className="table-cell text-slate-700">
                      {order.created_by_name ?? '—'}
                      {order.created_by_phone && (
                        <div className="text-xs text-slate-400" dir="ltr">{order.created_by_phone}</div>
                      )}
                    </td>
                    <td className="table-cell text-center font-bold text-slate-700">
                      {order.delivery_order_items?.length ?? 0}
                    </td>
                    <td className="table-cell text-slate-500 text-xs whitespace-nowrap">
                      {order.created_at ? formatDateTime(order.created_at) : '—'}
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center justify-center gap-2">
                        <Link
                          href={`/delivery-orders/${order.id}/print`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-semibold hover:bg-blue-100 transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                          </svg>
                          طباعة
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
                          onClick={() => handleDelete(order)}
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
        <DeliveryOrderModal
          editingOrder={editingOrder}
          onClose={() => { setIsModalOpen(false); setEditingOrder(null); }}
          onSaved={() => { setIsModalOpen(false); setEditingOrder(null); fetchOrders(); }}
        />
      )}

      {isHeaderModalOpen && (
        <DeliveryPrintHeaderModal onClose={() => setIsHeaderModalOpen(false)} />
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
