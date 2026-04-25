'use client';

import Link from 'next/link';
import { MEAL_TYPE_LABELS } from '@/lib/types';

export const TYPE_META: Record<string, { label: string; bar: string; badge: string; text: string }> = {
  breakfast: { label: 'فطور',  bar: 'bg-amber-400',   badge: 'bg-amber-100 text-amber-700',    text: 'text-amber-700'   },
  lunch:     { label: 'غداء',  bar: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700', text: 'text-emerald-700' },
  dinner:    { label: 'عشاء',  bar: 'bg-violet-500',  badge: 'bg-violet-100 text-violet-700',   text: 'text-violet-700'  },
  snack:     { label: 'سناك',  bar: 'bg-orange-400',  badge: 'bg-orange-100 text-orange-700',   text: 'text-orange-700'  },
};

export function StatCard({ href, label, value, color, icon }: {
  href: string; label: string; value: number;
  color: 'blue' | 'emerald' | 'violet' | 'rose'; icon: React.ReactNode;
}) {
  const colors = {
    blue:    { card: 'bg-blue-50 border-blue-100 text-blue-700',         icon: 'bg-blue-100'    },
    emerald: { card: 'bg-emerald-50 border-emerald-100 text-emerald-700', icon: 'bg-emerald-100' },
    violet:  { card: 'bg-violet-50 border-violet-100 text-violet-700',    icon: 'bg-violet-100'  },
    rose:    { card: 'bg-rose-50 border-rose-100 text-rose-700',          icon: 'bg-rose-100'    },
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

export function MiniStat({ label, value, sub, loading, color }: {
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

export function QuickLink({ href, label, sub, color, icon }: {
  href: string; label: string; sub: string; color: 'blue' | 'violet' | 'emerald'; icon: React.ReactNode;
}) {
  const iconBg = {
    blue: 'bg-blue-100 text-blue-600',
    violet: 'bg-violet-100 text-violet-600',
    emerald: 'bg-emerald-100 text-emerald-600',
  }[color];
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

export function MealTypeBadge({ type }: { type: string }) {
  const m = TYPE_META[type];
  return (
    <span className={`badge ${m?.badge ?? 'bg-slate-100 text-slate-700'}`}>
      {MEAL_TYPE_LABELS[type as keyof typeof MEAL_TYPE_LABELS] ?? type}
    </span>
  );
}

export function UsersIcon({ size = 6 }: { size?: number }) {
  return (
    <svg className={`w-${size} h-${size}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

export function MealsIcon({ size = 6 }: { size?: number }) {
  return (
    <svg className={`w-${size} h-${size}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  );
}

export function OrdersIcon({ size = 6 }: { size?: number }) {
  return (
    <svg className={`w-${size} h-${size}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

export function ExclIcon({ size = 6 }: { size?: number }) {
  return (
    <svg className={`w-${size} h-${size}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
    </svg>
  );
}
