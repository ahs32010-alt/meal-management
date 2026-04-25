'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase-client';
import { MEAL_TYPE_LABELS } from '@/lib/types';
import type { MealType } from '@/lib/types';
import { formatDate } from '@/lib/date-utils';
import { useCurrentUser } from '@/lib/use-current-user';
import { can } from '@/lib/permissions';
import {
  StatCard,
  MiniStat,
  QuickLink,
  MealTypeBadge,
  UsersIcon,
  MealsIcon,
  OrdersIcon,
  ExclIcon,
  TYPE_META,
} from './widgets';

// ─── Types ───────────────────────────────────────────────────────────────────
type MealTypeFilter = 'all' | MealType;

interface MealUsage {
  meal_id: string;
  name: string;
  type: string;
  is_snack: boolean;
  count: number;
}

interface TypeDistribution { breakfast: number; lunch: number; dinner: number }

interface TopExcluded { name: string; type: string; count: number }

interface OrderSummary {
  id: string;
  date: string;
  meal_type: MealType;
  item_count: number;
}

interface DayBucket { date: string; label: string; count: number }

interface AnalyticsData {
  mealUsage: MealUsage[];
  typeDistribution: TypeDistribution;
  topExcluded: TopExcluded[];
  totalOrdersInPeriod: number;
  weekBuckets: DayBucket[];
}

// ─── Constants ───────────────────────────────────────────────────────────────
const DATE_PRESETS = [
  { label: '7 أيام',    days: 7  },
  { label: '30 يوم',   days: 30 },
  { label: '90 يوم',   days: 90 },
  { label: 'كل الوقت', days: 0  },
] as const;

const DAY_SHORT = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function getPresetRange(days: number) {
  const to = new Date().toISOString().slice(0, 10);
  const from = days === 0
    ? '2000-01-01'
    : new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  return { from, to };
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

// ─── Main Component ───────────────────────────────────────────────────────────
export default function DashboardHome() {
  const { user: currentUser } = useCurrentUser();
  const canView = (page: Parameters<typeof can>[1]) => can(currentUser, page, 'view');
  const canAdd  = (page: Parameters<typeof can>[1]) => can(currentUser, page, 'add');

  const [stats, setStats] = useState({ beneficiaries: 0, meals: 0, orders: 0, exclusions: 0 });
  const [todaysOrders, setTodaysOrders] = useState<OrderSummary[]>([]);
  const [recentOrders, setRecentOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const [datePreset, setDatePreset] = useState<number | 'custom'>(30);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [mealTypeFilter, setMealTypeFilter] = useState<MealTypeFilter>('all');
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const supabase = useMemo(() => createClient(), []);

  // ── Fetch stats + today's orders + recent orders (with item counts) ─────
  const fetchStats = useCallback(async () => {
    const today = todayISO();
    const [bens, meals, orders, excls, todayRes, recentRes] = await Promise.all([
      supabase.from('beneficiaries').select('id', { count: 'exact', head: true }),
      supabase.from('meals').select('id', { count: 'exact', head: true }),
      supabase.from('daily_orders').select('id', { count: 'exact', head: true }),
      supabase.from('exclusions').select('id', { count: 'exact', head: true }),
      supabase.from('daily_orders').select('id, date, meal_type, order_items(id)').eq('date', today),
      supabase.from('daily_orders').select('id, date, meal_type, order_items(id)').order('date', { ascending: false }).limit(6),
    ]);

    setStats({
      beneficiaries: bens.count ?? 0,
      meals: meals.count ?? 0,
      orders: orders.count ?? 0,
      exclusions: excls.count ?? 0,
    });

    const mapRow = (r: any): OrderSummary => ({
      id: r.id,
      date: r.date,
      meal_type: r.meal_type as MealType,
      item_count: Array.isArray(r.order_items) ? r.order_items.length : 0,
    });

    setTodaysOrders((todayRes.data ?? []).map(mapRow));
    setRecentOrders((recentRes.data ?? []).map(mapRow));
    setLastRefresh(new Date());
    setLoading(false);
  }, [supabase]);

  // ── Analytics: meal usage, type distribution, week buckets ───────────────
  const fetchAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      let from: string; let to: string;
      if (datePreset === 'custom') {
        if (!customFrom || !customTo) { setAnalyticsLoading(false); return; }
        from = customFrom; to = customTo;
      } else {
        ({ from, to } = getPresetRange(datePreset));
      }

      const { data: ordersArr } = await supabase
        .from('daily_orders')
        .select('id, date, meal_type')
        .gte('date', from)
        .lte('date', to);

      const allOrders = ordersArr ?? [];
      const orderIds = allOrders.map(o => o.id);

      const typeDistribution: TypeDistribution = { breakfast: 0, lunch: 0, dinner: 0 };
      for (const o of allOrders) {
        if (o.meal_type in typeDistribution) typeDistribution[o.meal_type as keyof TypeDistribution]++;
      }

      // Week buckets: last 7 days
      const weekBuckets: DayBucket[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 864e5);
        const iso = d.toISOString().slice(0, 10);
        weekBuckets.push({
          date: iso,
          label: DAY_SHORT[d.getDay()],
          count: allOrders.filter(o => o.date === iso).length,
        });
      }

      let mealUsage: MealUsage[] = [];
      if (orderIds.length > 0) {
        const { data: itemsData } = await supabase
          .from('order_items')
          .select('order_id, meal_id, meals(id, name, type, is_snack)')
          .in('order_id', orderIds);

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
          .slice(0, 50);
      }

      const { data: exclRaw } = await supabase.from('exclusions').select('meal_id, meals(name, type)');
      const exclMap = new Map<string, { name: string; type: string; count: number }>();
      for (const e of exclRaw ?? []) {
        const m = e.meals as unknown as { name: string; type: string } | null;
        if (!m) continue;
        if (!exclMap.has(e.meal_id)) exclMap.set(e.meal_id, { name: m.name, type: m.type, count: 0 });
        exclMap.get(e.meal_id)!.count++;
      }
      const topExcluded = Array.from(exclMap.values()).sort((a, b) => b.count - a.count).slice(0, 7);

      const filteredOrderCount = mealTypeFilter === 'all'
        ? allOrders.length
        : allOrders.filter(o => o.meal_type === mealTypeFilter).length;

      setAnalytics({ mealUsage, typeDistribution, topExcluded, totalOrdersInPeriod: filteredOrderCount, weekBuckets });
    } finally {
      setAnalyticsLoading(false);
    }
  }, [supabase, datePreset, customFrom, customTo, mealTypeFilter]);

  // Initial load + refetch when filters change
  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  const refreshAll = useCallback(() => {
    fetchStats();
    fetchAnalytics();
  }, [fetchStats, fetchAnalytics]);

  // ── Realtime: refresh on any change to relevant tables ───────────────────
  useEffect(() => {
    const channel = supabase
      .channel('dashboard-refresh')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_orders' }, () => refreshAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => refreshAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meals' }, () => refreshAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'beneficiaries' }, () => fetchStats())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'exclusions' }, () => refreshAll())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, refreshAll, fetchStats]);

  // ── Refresh on window focus (fallback if realtime isn't enabled) ─────────
  useEffect(() => {
    const onFocus = () => refreshAll();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshAll]);

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
  const weekMax = Math.max(1, ...(analytics?.weekBuckets ?? []).map(b => b.count));

  return (
    <div className="p-6 space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">لوحة التحكم</h1>
          <p className="text-slate-500 text-sm mt-1">مرحباً بك في نظام إدارة وجبات المستفيدين لمركز خطوة أمل</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">
            آخر تحديث: {lastRefresh.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
          <button
            onClick={refreshAll}
            disabled={analyticsLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
            title="تحديث"
          >
            <svg className={`w-3.5 h-3.5 ${analyticsLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            تحديث
          </button>
        </div>
      </div>

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {canView('beneficiaries') && (
          <StatCard href="/beneficiaries" label="المستفيدون" value={stats.beneficiaries} color="blue" icon={<UsersIcon />} />
        )}
        {canView('meals') && (
          <StatCard href="/meals" label="الأصناف" value={stats.meals} color="emerald" icon={<MealsIcon />} />
        )}
        {canView('orders') && (
          <StatCard href="/orders" label="أوامر التشغيل" value={stats.orders} color="violet" icon={<OrdersIcon />} />
        )}
        {canView('beneficiaries') && (
          <StatCard href="/beneficiaries" label="إجمالي المحظورات" value={stats.exclusions} color="rose" icon={<ExclIcon />} />
        )}
      </div>

      {/* ── Today's Orders ── */}
      {canView('orders') && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-l from-emerald-50 to-transparent">
            <div>
              <h3 className="font-bold text-slate-800">أوامر تشغيل اليوم</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {todaysOrders.length === 0 ? 'لم يتم إنشاء أي أمر تشغيل لليوم بعد' : `${todaysOrders.length} أمر تشغيل اليوم`}
              </p>
            </div>
            {canAdd('orders') && (
              <Link href="/orders" className="btn-primary text-sm">+ إنشاء أمر جديد</Link>
            )}
          </div>

          {todaysOrders.length === 0 ? (
            <div className="py-10 text-center text-slate-400">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p className="text-sm">ابدأ بإنشاء أمر تشغيل لأحد الوجبات</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-100" dir="rtl">
              {todaysOrders.map(o => (
                <Link
                  key={o.id}
                  href={canView('reports') ? `/reports?orderId=${o.id}` : `/orders`}
                  className="p-5 hover:bg-slate-50 transition-colors flex items-center justify-between gap-3"
                >
                  <div>
                    <MealTypeBadge type={o.meal_type} />
                    <p className="mt-2 text-xs text-slate-500">{o.item_count} صنف محدد</p>
                  </div>
                  <svg className="w-5 h-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Analytics Card ── */}
      {canView('orders') && (
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h3 className="font-bold text-slate-800 text-base">تحليل الأصناف</h3>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
                {DATE_PRESETS.map(p => (
                  <button
                    key={p.days}
                    onClick={() => setDatePreset(p.days)}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                      datePreset === p.days ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >{p.label}</button>
                ))}
                <button
                  onClick={() => {
                    if (datePreset !== 'custom') {
                      // Default custom range: last 30 days
                      const today = new Date().toISOString().slice(0, 10);
                      const thirty = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
                      setCustomFrom(thirty);
                      setCustomTo(today);
                      setDatePreset('custom');
                    }
                  }}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                    datePreset === 'custom' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >فترة مخصصة</button>
              </div>
              <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
                {(['all', 'breakfast', 'lunch', 'dinner'] as MealTypeFilter[]).map(t => (
                  <button
                    key={t}
                    onClick={() => setMealTypeFilter(t)}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                      mealTypeFilter === t ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >{t === 'all' ? 'الكل' : TYPE_META[t].label}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Custom date range inputs */}
          {datePreset === 'custom' && (
            <div className="mt-3 flex items-center gap-3 flex-wrap" dir="rtl">
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-slate-600">من:</label>
                <input
                  type="date"
                  value={customFrom}
                  onChange={e => setCustomFrom(e.target.value)}
                  className="text-xs px-2.5 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-slate-600">إلى:</label>
                <input
                  type="date"
                  value={customTo}
                  onChange={e => setCustomTo(e.target.value)}
                  className="text-xs px-2.5 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </div>
              <span className="text-xs text-slate-400">التاريخ القادم مسموح به (للخطط المستقبلية)</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100" style={{ direction: 'rtl' }}>
          <MiniStat label="أوامر التشغيل في الفترة" value={analytics?.totalOrdersInPeriod ?? 0} loading={analyticsLoading} color="text-violet-700" />
          <MiniStat
            label="أكثر صنف طُلب"
            value={topMeal ? topMeal.name : '—'}
            sub={topMeal ? `${topMeal.count} أمر` : undefined}
            loading={analyticsLoading}
            color={topMeal ? TYPE_META[topMeal.is_snack ? 'snack' : topMeal.type]?.text ?? 'text-slate-700' : 'text-slate-400'}
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

        {/* Week bar chart */}
        <div className="px-5 py-5 border-b border-slate-100" dir="rtl">
          <p className="text-xs font-semibold text-slate-500 mb-3">نشاط آخر 7 أيام</p>
          <div className="flex items-end gap-2 h-28">
            {(analytics?.weekBuckets ?? []).map(b => {
              const pct = Math.max(4, (b.count / weekMax) * 100);
              const isToday = b.date === todayISO();
              return (
                <div key={b.date} className="flex-1 flex flex-col items-center gap-1.5">
                  <div className="text-xs font-bold text-slate-600">{b.count || ''}</div>
                  <div className="w-full bg-slate-100 rounded-t-md relative" style={{ height: '70%' }}>
                    <div
                      className={`absolute bottom-0 left-0 right-0 rounded-t-md transition-all duration-500 ${isToday ? 'bg-emerald-500' : 'bg-emerald-300'}`}
                      style={{ height: `${pct}%` }}
                    />
                  </div>
                  <div className={`text-[10px] ${isToday ? 'font-bold text-emerald-700' : 'text-slate-400'}`}>{b.label}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3">
          <div className="md:col-span-2 p-5 border-l border-slate-100">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-semibold text-slate-500">
                الأصناف الأكثر ظهوراً في الأوامر
                {analyticsLoading && <span className="mr-2 text-slate-400 font-normal">جاري التحميل...</span>}
              </p>
              {!analyticsLoading && (analytics?.mealUsage.length ?? 0) > 6 && (
                <span className="text-[10px] text-slate-400 font-medium">
                  يعرض {analytics?.mealUsage.length} صنف — مرّر للأسفل
                </span>
              )}
            </div>

            {!analyticsLoading && analytics?.mealUsage.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-sm">لا توجد بيانات في هذه الفترة</div>
            ) : (
              <div className="space-y-2.5 overflow-y-auto pl-1" style={{ maxHeight: 260 }}>
                {(analyticsLoading ? Array(6).fill(null) : analytics?.mealUsage ?? []).map((meal, i) => {
                  if (!meal) return (
                    <div key={i} className="flex items-center gap-3 animate-pulse">
                      <div className="w-24 h-3 bg-slate-200 rounded" />
                      <div className="flex-1 h-6 bg-slate-100 rounded-full" />
                      <div className="w-6 h-3 bg-slate-200 rounded" />
                    </div>
                  );
                  const colorKey = meal.is_snack ? 'snack' : meal.type;
                  const pct = Math.max(4, (meal.count / maxUsage) * 100);
                  const mealsLink = canView('meals') ? `/meals?highlight=${meal.meal_id}` : '#';
                  return (
                    <Link key={meal.meal_id} href={mealsLink} className="flex items-center gap-3 hover:bg-slate-50 -mx-2 px-2 py-1 rounded-lg transition-colors" dir="rtl">
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
                      <span className={`text-xs font-bold w-8 text-left flex-shrink-0 ${TYPE_META[colorKey]?.text ?? 'text-slate-600'}`}>
                        {meal.count}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}

            <div className="flex items-center gap-4 mt-5 pt-4 border-t border-slate-100 flex-wrap" dir="rtl">
              {Object.entries(TYPE_META).map(([key, m]) => (
                <span key={key} className="flex items-center gap-1.5 text-xs text-slate-500">
                  <span className={`w-3 h-3 rounded-sm ${m.bar}`} />
                  {m.label}
                </span>
              ))}
            </div>
          </div>

          <div className="p-5 space-y-6 bg-slate-50/50" dir="rtl">
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-3">توزيع الوجبات</p>
              {totalTypeOrders === 0 ? (
                <p className="text-xs text-slate-400">لا توجد بيانات</p>
              ) : (
                <div className="space-y-2">
                  {(['breakfast', 'lunch', 'dinner'] as const).map(t => {
                    const count = analytics?.typeDistribution[t] ?? 0;
                    const pct = totalTypeOrders > 0 ? Math.round((count / totalTypeOrders) * 100) : 0;
                    return (
                      <div key={t}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-medium text-slate-700">{TYPE_META[t].label}</span>
                          <span className="text-slate-500">{count} أمر ({pct}%)</span>
                        </div>
                        <div className="w-full bg-slate-200 rounded-full h-2">
                          <div className={`h-2 rounded-full transition-all duration-500 ${TYPE_META[t].bar}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

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
      )}

      {/* ── Recent Orders ── */}
      {canView('orders') && (
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
                    <th className="table-header">عدد الأصناف</th>
                    <th className="table-header">الإجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map(order => (
                    <tr key={order.id} className="hover:bg-slate-50">
                      <td className="table-cell font-medium">{formatDate(order.date)}</td>
                      <td className="table-cell"><MealTypeBadge type={order.meal_type} /></td>
                      <td className="table-cell">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-xs font-bold">
                          {order.item_count} صنف
                        </span>
                      </td>
                      <td className="table-cell">
                        <div className="flex items-center gap-3">
                          {canView('reports') && (
                            <Link href={`/reports?orderId=${order.id}`} className="text-emerald-600 hover:text-emerald-700 text-sm font-semibold">
                              عرض التقرير
                            </Link>
                          )}
                          {canView('orders') && (
                            <Link href={`/orders?orderId=${order.id}`} className="text-slate-500 hover:text-slate-700 text-sm font-semibold">
                              فتح الأمر
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Quick Links ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {canAdd('beneficiaries') && (
          <QuickLink href="/beneficiaries" label="إضافة مستفيد" sub="إدارة قائمة المستفيدين" color="blue" icon={<UsersIcon size={5} />} />
        )}
        {canAdd('meals') && (
          <QuickLink href="/meals" label="إضافة صنف" sub="إدارة قائمة الأصناف" color="emerald" icon={<MealsIcon size={5} />} />
        )}
        {canAdd('orders') && (
          <QuickLink href="/orders" label="إنشاء أمر تشغيل" sub="إدارة الوجبات اليومية" color="violet" icon={<OrdersIcon size={5} />} />
        )}
      </div>
    </div>
  );
}

