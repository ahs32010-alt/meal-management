'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase-client';
import { MEAL_TYPE_LABELS } from '@/lib/types';
import type { DailyOrder } from '@/lib/types';
import { formatDate } from '@/lib/date-utils';

interface Stats {
  beneficiaries: number;
  meals: number;
  orders: number;
}

export default function DashboardHome() {
  const [stats, setStats] = useState<Stats>({ beneficiaries: 0, meals: 0, orders: 0 });
  const [recentOrders, setRecentOrders] = useState<DailyOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    async function fetchStats() {
      try {
        const [bensResult, mealsResult, ordersResult, recentResult] = await Promise.all([
          supabase.from('beneficiaries').select('id', { count: 'exact', head: true }),
          supabase.from('meals').select('id', { count: 'exact', head: true }),
          supabase.from('daily_orders').select('id', { count: 'exact', head: true }),
          supabase.from('daily_orders').select('id, date, meal_type').order('date', { ascending: false }).limit(5),
        ]);

        setStats({
          beneficiaries: bensResult.count || 0,
          meals: mealsResult.count || 0,
          orders: ordersResult.count || 0,
        });
        if (recentResult.data) setRecentOrders(recentResult.data as unknown as DailyOrder[]);
      } catch (err) {
        console.error('Error fetching stats:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, [supabase]);

  const statCards = [
    {
      label: 'إجمالي المستفيدين',
      value: stats.beneficiaries,
      color: 'bg-blue-50 text-blue-700 border-blue-100',
      iconBg: 'bg-blue-100',
      href: '/beneficiaries',
      icon: (
        <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
    {
      label: 'إجمالي الأصناف',
      value: stats.meals,
      color: 'bg-emerald-50 text-emerald-700 border-emerald-100',
      iconBg: 'bg-emerald-100',
      href: '/meals',
      icon: (
        <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      ),
    },
    {
      label: 'أوامر التشغيل',
      value: stats.orders,
      color: 'bg-violet-50 text-violet-700 border-violet-100',
      iconBg: 'bg-violet-100',
      href: '/orders',
      icon: (
        <svg className="w-6 h-6 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="grid grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-28 bg-slate-200 rounded-xl" />
            ))}
          </div>
          <div className="h-64 bg-slate-200 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">لوحة التحكم</h1>
        <p className="text-slate-500 text-sm mt-1">مرحباً بك في نظام إدارة وجبات المستفيدين</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {statCards.map((card) => (
          <Link key={card.href} href={card.href}>
            <div className={`card p-5 hover:shadow-md transition-shadow cursor-pointer border ${card.color}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium opacity-80">{card.label}</p>
                  <p className="text-4xl font-bold mt-1">{card.value}</p>
                </div>
                <div className={`w-12 h-12 ${card.iconBg} rounded-xl flex items-center justify-center`}>
                  {card.icon}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Recent Orders */}
      <div className="card">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="font-bold text-slate-800">آخر أوامر التشغيل</h3>
          <Link href="/orders" className="text-emerald-600 text-sm font-semibold hover:text-emerald-700">
            عرض الكل ←
          </Link>
        </div>

        {recentOrders.length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p>لا توجد أوامر تشغيل بعد</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">التاريخ</th>
                  <th className="table-header">نوع الوجبة</th>
                  <th className="table-header">الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-slate-50">
                    <td className="table-cell font-medium">
                      {formatDate(order.date)}
                    </td>
                    <td className="table-cell">
                      <MealTypeBadge type={order.meal_type} />
                    </td>
                    <td className="table-cell">
                      <Link
                        href={`/reports?orderId=${order.id}`}
                        className="text-emerald-600 hover:text-emerald-700 text-sm font-semibold"
                      >
                        عرض التقرير
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-2 gap-4">
        <Link href="/beneficiaries">
          <div className="card p-4 hover:shadow-md transition-shadow cursor-pointer flex items-center gap-4">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-slate-800 text-sm">إضافة مستفيد</p>
              <p className="text-xs text-slate-500">إدارة قائمة المستفيدين</p>
            </div>
          </div>
        </Link>
        <Link href="/orders">
          <div className="card p-4 hover:shadow-md transition-shadow cursor-pointer flex items-center gap-4">
            <div className="w-10 h-10 bg-violet-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-slate-800 text-sm">إنشاء أمر تشغيل</p>
              <p className="text-xs text-slate-500">إدارة الوجبات اليومية</p>
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}

function MealTypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    breakfast: 'bg-yellow-100 text-yellow-700',
    lunch: 'bg-blue-100 text-blue-700',
    dinner: 'bg-purple-100 text-purple-700',
  };
  return (
    <span className={`badge ${styles[type] || 'bg-slate-100 text-slate-700'}`}>
      {MEAL_TYPE_LABELS[type as keyof typeof MEAL_TYPE_LABELS] || type}
    </span>
  );
}
