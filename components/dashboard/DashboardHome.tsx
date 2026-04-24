'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase-client';
import { MEAL_TYPE_LABELS } from '@/lib/types';
import type { DailyOrder } from '@/lib/types';
import { formatDate } from '@/lib/date-utils';

// ─── Types ───────────────────────────────────────────────────────────────────
type MealTypeFilter = 'all' | 'breakfast' | 'lunch' | 'dinner';

interface MealUsage {
  meal_id: string;
  name: string;
  type: string;
  is_snack: boolean;
  count: number;
}

interface TypeDistribution { breakfast: number; lunch: number; dinner: number }

interface TopExcluded { name: string; type: string; count: number }

interface AnalyticsData {
  mealUsage: MealUsage[];
  typeDistribution: TypeDistribution;
  topExcluded: TopExcluded[];
  totalOrdersInPeriod: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────
const DATE_PRESETS = [
  { label: '7 أيام',    days: 7  },
  { label: '30 يوم',   days: 30 },
  { label: '90 يوم',   days: 90 },
  { label: 'كل الوقت', days: 0  },
] as const;

const TYPE_META: Record<string, { label: string; bar: string; badge: string; light: string }> = {
  breakfast: { label: 'فطور',  bar: 'bg-amber-400',   badge: 'bg-amber-100 text-amber-700',    light: 'bg-amber-50'   },
  lunch:     { label: 'غداء',  bar: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700', light: 'bg-emerald-50' },
  dinner:    { label: 'عشاء',  bar: 'bg-violet-500',  badge: 'bg-violet-100 text-violet-700',   light: 'bg-violet-50'  },
  snack:     { label: 'سناك',  bar: 'bg-orange-400',  badge: 'bg-orange-100 text-orange-700',   light: 'bg-orange-50'  },
};

function getDateRange(days: number) {
  const to = new Date().toISOString().slice(0, 10);
  const from = days === 0
    ? '2000-01-01'
    : new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  return { from, to };
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function DashboardHome() {
  const [stats, setStats]               = useState({ beneficiaries: 0, meals: 0, orders: 0, exclusions: 0 });
  const [recentOrders, setRecentOrders] = useState<DailyOrder[]>([]);
  const [loading, setLoading]           = useState(true);

  const [datePreset, setDatePreset]           = useState(30);
  const [mealTypeFilter, setMealTypeFilter]   = useState<MealTypeFilter>('all');
  const [topN]                                = useState(14);
  const [analytics, setAnalytics]             = useState<AnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const supabase = useMemo(() => createClient(), []);

  // ── Static stats ─────────────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    try {
      const [bens, meals, orders, excls, recent] = await Promise.all([
        supabase.from('beneficiaries').select('id', { count: 'exact', head: true }),
        supabase.from('meals').select('id', { count: 'exact', head: true }),
        supabase.from('daily_orders').select('id', { count: 'exact', head: true }),
        supabase.from('exclusions').select('id', { count: 'exact', head: true }),
        supabase.from('daily_orders').select('id, date, meal_type').order('date', { ascending: false }).limit(5),
      ]);
      setStats({ beneficiaries: bens.count ?? 0, meals: meals.count ?? 0, orders: orders.count ?? 0, exclusions: excls.count ?? 0 });
      if (recent.data) setRecentOrders(recent.data as unknown as DailyOrder[]);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  // Initial load
  useEffect(() => { fetchStats(); }, [fetchStats]);

  // ── Analytics (re-fetches on filter change) ──────────────────────────────
  const fetchAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const { from, to } = getDateRange(datePreset);

      // Orders in date range
      const { data: ordersArr } = await supabase
        .from('daily_orders')
        .select('id, meal_type')
        .gte('date', from)
        .lte('date', to);

      const allOrders = ordersArr ?? [];
      const orderIds  = allOrders.map(o => o.id);

      // Type distribution
      const typeDistribution: TypeDistribution = { breakfast: 0, lunch: 0, dinner: 0 };
      for (const o of allOrders) {
        if (o.meal_type in typeDistribution) typeDistribution[o.meal_type as keyof TypeDistribution]++;
      }

      // Meal usage
      let mealUsage: MealUsage[] = [];
      if (orderIds.length > 0) {
        const { data: itemsData } = await supabase
          .from('order_items')
          .select('order_id, meal_id, meals(id, name, type, is_snack)')
          .in('order_id', orderIds);

        // Filter by selected meal type
        const filteredOrderIds = new Set(
          mealTypeFilter === 'all'
            ? orderIds
            : allOrders.filter(o => o.meal_type === mealTypeFilter).map(o => o.id)
        );

        const mealMap = new Map<string, { name: string; type: string; is_snack: boolean; orderIds: Set<string> }>();
        for (const item of itemsData ?? []) {
          const m = item.meals as unknown as { id: string; name: string; type: string; is_snack: boolean } | null;
          if (!m || !filteredOrderIds.has(item.order_id)) continue;
          if (!mealMap.has(item.meal_id)) mealMap.set(item.meal_id, { name: m.name, type: m.type, is_snack: m.is_snack, orderIds: new Set() });
          mealMap.get(item.meal_id)!.orderIds.add(item.order_id);
        }

        mealUsage = Array.from(mealMap.entries())
          .map(([meal_id, v]) => ({ meal_id, name: v.name, type: v.type, is_snack: v.is_snack, count: v.orderIds.size }))
          .sort((a, b) => b.count - a.count)
          .slice(0, topN);
      }

      // Top excluded meals (global, not date-scoped)
      const { data: exclRaw } = await supabase.from('exclusions').select('meal_id, meals(name, type)');
      const exclMap = new Map<string, { name: string; type: string; count: number }>();
      for (const e of exclRaw ?? []) {
        const m = e.meals as unknown as { name: string; type: string } | null;
        if (!m) continue;
        if (!exclMap.has(e.meal_id)) exclMap.set(e.meal_id, { name: m.name, type: m.type, count: 0 });
        exclMap.get(e.meal_id)!.count++;
      }
      const topExcluded: TopExcluded[] = Array.from(exclMap.values()).sort((a, b) => b.count - a.count).slice(0, 7);

      const filteredOrderCount = mealTypeFilter === 'all'
        ? allOrders.length
        : allOrders.filter(o => o.meal_type === mealTypeFilter).length;

      setAnalytics({ mealUsage, typeDistribution, topExcluded, totalOrdersInPeriod: filteredOrderCount });
    } finally {
      setAnalyticsLoading(false);
    }
  }, [supabase, datePreset, mealTypeFilter, topN]);

  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  // ── Realtime: تحديث فوري عند أي تغيير في الأوامر ──────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('dashboard-refresh')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_orders' }, () => {
        fetchStats();
        fetchAnalytics();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => {
        fetchAnalytics();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [supabase, fetchStats, fetchAnalytics]);

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="grid grid-cols-4 gap-4">{[1,2,3,4].map(i => <div key={i} className="h-24 bg-slate-200 rounded-xl" />)}</div>
          <div className="h-96 bg-slate-200 rounded-xl" />
        </div>
      </div>
    );
  }

  const maxUsage = analytics?.mealUsage[0]?.count ?? 1;
  const totalTypeOrders = analytics
    ? analytics.typeDistribution.breakfast + analytics.typeDistribution.lunch + analytics.typeDistribution.dinner
    : 0;
  const topMeal = analytics?.mealUsage[0];
  const topExclMax = analytics?.topExcluded[0]?.count ?? 1;

  return (
    <div className="p-6 space-y-6">

      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800">لوحة التحكم</h1>
        <p className="text-slate-500 text-sm mt-1">مرحباً بك في نظام إدارة وجبات المستفيدين لمركز خطوة أمل</p>
      </div>

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard href="/beneficiaries" label="المستفيدون"     value={stats.beneficiaries} color="blue"   icon={<UsersIcon />} />
        <StatCard href="/meals"         label="الأصناف"        value={stats.meals}         color="emerald" icon={<MealsIcon />} />
        <StatCard href="/orders"        label="أوامر التشغيل"  value={stats.orders}        color="violet"  icon={<OrdersIcon />} />
        <StatCard href="/beneficiaries" label="إجمالي المحظورات" value={stats.exclusions}  color="rose"    icon={<ExclIcon />} />
      </div>

      {/* ── Analytics Card ── */}
      <div className="card overflow-hidden">

        {/* Header + Filters */}
        <div className="px-5 py-4 border-b border-slate-100">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h3 className="font-bold text-slate-800 text-base">تحليل الأصناف</h3>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Date presets */}
              <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
                {DATE_PRESETS.map(p => (
                  <button
                    key={p.days}
                    onClick={() => setDatePreset(p.days)}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                      datePreset === p.days
                        ? 'bg-white text-slate-800 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {/* Meal type filter */}
              <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
                {(['all', 'breakfast', 'lunch', 'dinner'] as MealTypeFilter[]).map(t => (
                  <button
                    key={t}
                    onClick={() => setMealTypeFilter(t)}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                      mealTypeFilter === t
                        ? 'bg-white text-slate-800 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {t === 'all' ? 'الكل' : TYPE_META[t].label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Mini stats row */}
        <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100" style={{ direction: 'rtl' }}>
          <MiniStat
            label="أوامر التشغيل في الفترة"
            value={analytics?.totalOrdersInPeriod ?? 0}
            loading={analyticsLoading}
            color="text-violet-700"
          />
          <MiniStat
            label="أكثر صنف طُلب"
            value={topMeal ? topMeal.name : '—'}
            sub={topMeal ? `${topMeal.count} أمر` : undefined}
            loading={analyticsLoading}
            color={topMeal ? (TYPE_META[topMeal.is_snack ? 'snack' : topMeal.type]?.badge.split(' ')[1] ?? 'text-slate-700') : 'text-slate-400'}
          />
          <MiniStat
            label="أكثر وجبة نشاطاً"
            value={
              totalTypeOrders === 0 ? '—'
              : TYPE_META[
                  Object.entries(analytics?.typeDistribution ?? {}).sort((a, b) => (b[1] as number) - (a[1] as number))[0]?.[0] ?? ''
                ]?.label ?? '—'
            }
            loading={analyticsLoading}
            color="text-emerald-700"
          />
        </div>

        {/* Chart + Side Panel */}
        <div className="grid grid-cols-1 md:grid-cols-3">

          {/* ── Horizontal Bar Chart ── */}
          <div className="md:col-span-2 p-5 border-l border-slate-100">
            <p className="text-xs font-semibold text-slate-500 mb-4">
              الأصناف الأكثر ظهوراً في الأوامر
              {analyticsLoading && <span className="mr-2 text-slate-400 font-normal">جاري التحميل...</span>}
            </p>

            {!analyticsLoading && analytics?.mealUsage.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-sm">لا توجد بيانات في هذه الفترة</div>
            ) : (
              <div className="space-y-2.5">
                {(analyticsLoading ? Array(8).fill(null) : analytics?.mealUsage ?? []).map((meal, i) => {
                  if (!meal) return (
                    <div key={i} className="flex items-center gap-3 animate-pulse">
                      <div className="w-24 h-3 bg-slate-200 rounded" />
                      <div className="flex-1 h-6 bg-slate-100 rounded-full" />
                      <div className="w-6 h-3 bg-slate-200 rounded" />
                    </div>
                  );
                  const colorKey = meal.is_snack ? 'snack' : meal.type;
                  const pct = Math.max(4, (meal.count / maxUsage) * 100);
                  return (
                    <div key={meal.meal_id} className="flex items-center gap-3" dir="rtl">
                      <span className="text-xs text-slate-700 w-28 truncate text-right flex-shrink-0">{meal.name}</span>
                      <div className="flex-1 bg-slate-100 rounded-full h-6 overflow-hidden relative">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${TYPE_META[colorKey]?.bar ?? 'bg-slate-400'} opacity-80`}
                          style={{ width: `${pct}%` }}
                        />
                        <span className="absolute inset-0 flex items-center pr-3 text-[11px] font-bold text-white mix-blend-luminosity">
                          {meal.count > 0 && meal.count}
                        </span>
                      </div>
                      <span className={`text-xs font-bold w-8 text-left flex-shrink-0 ${TYPE_META[colorKey]?.badge.split(' ')[1] ?? 'text-slate-600'}`}>
                        {meal.count}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Legend */}
            <div className="flex items-center gap-4 mt-5 pt-4 border-t border-slate-100 flex-wrap" dir="rtl">
              {Object.entries(TYPE_META).map(([key, m]) => (
                <span key={key} className="flex items-center gap-1.5 text-xs text-slate-500">
                  <span className={`w-3 h-3 rounded-sm ${m.bar}`} />
                  {m.label}
                </span>
              ))}
            </div>
          </div>

          {/* ── Side Panel ── */}
          <div className="p-5 space-y-6 bg-slate-50/50" dir="rtl">

            {/* Type Distribution */}
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-3">توزيع الوجبات</p>
              {totalTypeOrders === 0 ? (
                <p className="text-xs text-slate-400">لا توجد بيانات</p>
              ) : (
                <div className="space-y-2">
                  {(['breakfast', 'lunch', 'dinner'] as const).map(t => {
                    const count = analytics?.typeDistribution[t] ?? 0;
                    const pct   = totalTypeOrders > 0 ? Math.round((count / totalTypeOrders) * 100) : 0;
                    return (
                      <div key={t}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-medium text-slate-700">{TYPE_META[t].label}</span>
                          <span className="text-slate-500">{count} أمر ({pct}%)</span>
                        </div>
                        <div className="w-full bg-slate-200 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full transition-all duration-500 ${TYPE_META[t].bar}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Top Excluded */}
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-3">الأصناف الأكثر استبعاداً</p>
              {(analytics?.topExcluded ?? []).length === 0 ? (
                <p className="text-xs text-slate-400">لا توجد بيانات</p>
              ) : (
                <div className="space-y-1.5">
                  {(analytics?.topExcluded ?? []).map((item, i) => {
                    const pct = Math.max(8, (item.count / topExclMax) * 100);
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-xs text-slate-600 w-20 truncate text-right">{item.name}</span>
                        <div className="flex-1 bg-red-100 rounded-full h-4 overflow-hidden">
                          <div className="h-full bg-red-400 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-bold text-red-600 w-5 text-left">{item.count}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>

      {/* ── Recent Orders ── */}
      <div className="card">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="font-bold text-slate-800">آخر أوامر التشغيل</h3>
          <Link href="/orders" className="text-emerald-600 text-sm font-semibold hover:text-emerald-700">عرض الكل ←</Link>
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
                {recentOrders.map(order => (
                  <tr key={order.id} className="hover:bg-slate-50">
                    <td className="table-cell font-medium">{formatDate(order.date)}</td>
                    <td className="table-cell"><MealTypeBadge type={order.meal_type} /></td>
                    <td className="table-cell">
                      <Link href={`/reports?orderId=${order.id}`} className="text-emerald-600 hover:text-emerald-700 text-sm font-semibold">
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

      {/* ── Quick Links ── */}
      <div className="grid grid-cols-2 gap-4">
        <QuickLink href="/beneficiaries" label="إضافة مستفيد"    sub="إدارة قائمة المستفيدين"  color="blue"   icon={<UsersIcon size={5} />} />
        <QuickLink href="/orders"        label="إنشاء أمر تشغيل" sub="إدارة الوجبات اليومية"   color="violet" icon={<OrdersIcon size={5} />} />
      </div>

    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ href, label, value, color, icon }: {
  href: string; label: string; value: number;
  color: 'blue' | 'emerald' | 'violet' | 'rose'; icon: React.ReactNode;
}) {
  const colors = {
    blue:    { card: 'bg-blue-50 border-blue-100 text-blue-700',     icon: 'bg-blue-100'    },
    emerald: { card: 'bg-emerald-50 border-emerald-100 text-emerald-700', icon: 'bg-emerald-100' },
    violet:  { card: 'bg-violet-50 border-violet-100 text-violet-700',  icon: 'bg-violet-100'  },
    rose:    { card: 'bg-rose-50 border-rose-100 text-rose-700',      icon: 'bg-rose-100'    },
  }[color];
  return (
    <Link href={href}>
      <div className={`card p-5 hover:shadow-md transition-shadow cursor-pointer border ${colors.card}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium opacity-70">{label}</p>
            <p className="text-3xl font-bold mt-1">{value.toLocaleString('ar')}</p>
          </div>
          <div className={`w-11 h-11 ${colors.icon} rounded-xl flex items-center justify-center flex-shrink-0`}>
            {icon}
          </div>
        </div>
      </div>
    </Link>
  );
}

function MiniStat({ label, value, sub, loading, color }: {
  label: string; value: string | number; sub?: string; loading?: boolean; color: string;
}) {
  return (
    <div className="px-5 py-4 text-center" dir="rtl">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      {loading ? (
        <div className="animate-pulse h-6 w-16 bg-slate-200 rounded mx-auto" />
      ) : (
        <>
          <p className={`text-lg font-bold ${color}`}>{value}</p>
          {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
        </>
      )}
    </div>
  );
}

function QuickLink({ href, label, sub, color, icon }: {
  href: string; label: string; sub: string; color: 'blue' | 'violet'; icon: React.ReactNode;
}) {
  const iconBg = color === 'blue' ? 'bg-blue-100 text-blue-600' : 'bg-violet-100 text-violet-600';
  return (
    <Link href={href}>
      <div className="card p-4 hover:shadow-md transition-shadow cursor-pointer flex items-center gap-4">
        <div className={`w-10 h-10 ${iconBg} rounded-lg flex items-center justify-center flex-shrink-0`}>
          {icon}
        </div>
        <div>
          <p className="font-semibold text-slate-800 text-sm">{label}</p>
          <p className="text-xs text-slate-500">{sub}</p>
        </div>
      </div>
    </Link>
  );
}

function MealTypeBadge({ type }: { type: string }) {
  const m = TYPE_META[type];
  return (
    <span className={`badge ${m?.badge ?? 'bg-slate-100 text-slate-700'}`}>
      {MEAL_TYPE_LABELS[type as keyof typeof MEAL_TYPE_LABELS] ?? type}
    </span>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────
function UsersIcon({ size = 6 }: { size?: number }) {
  return (
    <svg className={`w-${size} h-${size}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}
function MealsIcon({ size = 6 }: { size?: number }) {
  return (
    <svg className={`w-${size} h-${size}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  );
}
function OrdersIcon({ size = 6 }: { size?: number }) {
  return (
    <svg className={`w-${size} h-${size}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}
function ExclIcon({ size = 6 }: { size?: number }) {
  return (
    <svg className={`w-${size} h-${size}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
    </svg>
  );
}
