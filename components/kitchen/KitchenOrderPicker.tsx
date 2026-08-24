'use client';

/**
 * اختيار أمر التشغيل — أول ما يراه المشغّل.
 *
 * ثلاثة أزرار ضخمة لا أكثر: فطور، غداء، عشاء. مميّزة بالأيقونة واللون لا
 * بالكلمة، لأن من يستعملها لا يقرأ. واليوم افتراضياً — وهو ما يُطبخ الآن.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase-client';
import { formatDateFull, todayISO } from '@/lib/date-utils';
import { MEAL_TYPE_LABELS, type MealType } from '@/lib/types';

interface OrderRow {
  id: string;
  date: string;
  meal_type: MealType;
}

/** رموز بصرية تُميَّز بلا قراءة: شمس مشرقة، شمس عالية، هلال. */
const MEAL_LOOK: Record<MealType, { icon: string; ring: string; bg: string }> = {
  breakfast: { icon: '🌅', ring: 'border-amber-500', bg: 'bg-amber-500/10' },
  lunch: { icon: '☀️', ring: 'border-emerald-500', bg: 'bg-emerald-500/10' },
  dinner: { icon: '🌙', ring: 'border-sky-500', bg: 'bg-sky-500/10' },
};

const ORDERED: MealType[] = ['breakfast', 'lunch', 'dinner'];

export default function KitchenOrderPicker() {
  const router = useRouter();
  const [date, setDate] = useState(() => todayISO());
  const [orders, setOrders] = useState<OrderRow[] | null>(null);

  const load = useCallback(async (day: string) => {
    setOrders(null);
    const { data } = await supabase
      .from('daily_orders')
      .select('id, date, meal_type')
      .eq('date', day);
    setOrders((data ?? []) as OrderRow[]);
  }, []);

  useEffect(() => {
    void load(date);
  }, [date, load]);

  const shiftDay = (days: number) => {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + days);
    setDate(d.toLocaleDateString('en-CA'));
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4">
      {/* اليوم — سهمان كبيران، بلا تقويم يحتاج قراءة */}
      <div className="flex items-center gap-2 mb-6">
        <button
          type="button"
          onClick={() => shiftDay(-1)}
          aria-label="اليوم السابق"
          className="w-14 h-14 rounded-2xl bg-slate-800 border-2 border-slate-700 grid place-items-center active:bg-slate-700"
        >
          <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <div className="flex-1 text-center">
          <div className="font-bold text-lg">{formatDateFull(date)}</div>
          {date === todayISO() && <div className="text-xs text-emerald-400 font-semibold">اليوم</div>}
        </div>

        <button
          type="button"
          onClick={() => shiftDay(1)}
          aria-label="اليوم التالي"
          className="w-14 h-14 rounded-2xl bg-slate-800 border-2 border-slate-700 grid place-items-center active:bg-slate-700"
        >
          <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {orders === null ? (
        <div className="text-center text-slate-400 py-12">جارٍ التحميل…</div>
      ) : (
        <div className="space-y-3">
          {ORDERED.map((type) => {
            const order = orders.find((o) => o.meal_type === type);
            const look = MEAL_LOOK[type];
            return (
              <button
                key={type}
                type="button"
                disabled={!order}
                onClick={() => order && router.push(`/kitchen/${order.id}`)}
                className={`w-full h-28 rounded-3xl border-2 flex items-center gap-4 px-5 text-start transition-opacity ${
                  order ? `${look.bg} ${look.ring} active:opacity-70` : 'bg-slate-800/40 border-slate-800 opacity-40'
                }`}
              >
                <span className="text-5xl" aria-hidden="true">{look.icon}</span>
                <span className="flex-1">
                  <span className="block text-2xl font-bold">{MEAL_TYPE_LABELS[type]}</span>
                  {!order && <span className="block text-sm text-slate-500">لا يوجد أمر</span>}
                </span>
                {order && (
                  <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
