'use client';

/**
 * اختيار أمر التشغيل — خاص بصفحة ستيكرات الغداء والعشاء وحدها.
 *
 * عمود للغداء وعمود للعشاء (الفطور له صفحته المستقلّة فلا عمود له هنا).
 * مكتوب داخل هذا المجلد عمداً ولا يُشارَك مع صفحة الفطور — أي تعديل هنا يبقى
 * محبوساً في هذه الصفحة ولا يمسّ غيرها.
 *
 * والقائمة مبنية يدوياً لا بعنصر <select> أصلي، لأن الأصلي يفتح بعرض الشاشة
 * على اللابتوب وبعض المتصفحات تقصّ نصّه فيختفي الكلام.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DailyOrder, EntityType, MealType } from '@/lib/types';
import { MEAL_TYPE_LABELS, ENTITY_TYPE_LABELS_PLURAL } from '@/lib/types';
import { formatDate, formatDateFull } from '@/lib/date-utils';

/** وجبات هذه الصفحة. */
const LD_MEALS: MealType[] = ['lunch', 'dinner'];

const MEAL_ICON: Record<string, string> = { lunch: '🍽️', dinner: '🌙' };

/** لون ثابت لكل وجبة — يتكرّر في العنوان والحقل والسطر المختار. */
const THEME: Record<string, {
  head: string; idle: string; active: string; ring: string; stripe: string; rowOn: string; dot: string;
}> = {
  lunch: {
    head:   'text-emerald-700',
    idle:   'border-emerald-200 hover:border-emerald-300 hover:bg-emerald-50',
    active: 'border-emerald-400 bg-emerald-50 text-emerald-700',
    ring:   'ring-emerald-400',
    stripe: 'bg-emerald-500',
    rowOn:  'bg-emerald-50',
    dot:    'bg-emerald-500',
  },
  dinner: {
    head:   'text-indigo-700',
    idle:   'border-indigo-200 hover:border-indigo-300 hover:bg-indigo-50',
    active: 'border-indigo-400 bg-indigo-50 text-indigo-700',
    ring:   'ring-indigo-400',
    stripe: 'bg-indigo-500',
    rowOn:  'bg-indigo-50',
    dot:    'bg-indigo-500',
  },
};

/** فوق هذا العدد يظهر حقل بحث داخل اللوحة — تحته البحث حشو. */
const SEARCH_THRESHOLD = 8;

const entityOf = (o: DailyOrder): EntityType =>
  o.entity_type === 'companion' ? 'companion' : 'beneficiary';

// ── قائمة وجبة واحدة ──────────────────────────────────────────────────────────
function MealColumn({ meal, orders, value, onChange, open, setOpen, align }: {
  meal: MealType;
  orders: DailyOrder[];
  value: string;
  onChange: (id: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  /** اللوحة تتمدّد يساراً افتراضياً؛ آخر عمود يتمدّد يميناً حتى لا يخرج عن الشاشة. */
  align: 'start' | 'end';
}) {
  const th = THEME[meal];
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => orders.find(o => o.id === value) ?? null, [orders, value]);
  const showSearch = orders.length > SEARCH_THRESHOLD;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter(o =>
      `${formatDateFull(o.date)} ${o.date} ${ENTITY_TYPE_LABELS_PLURAL[entityOf(o)]}`
        .toLowerCase().includes(q));
  }, [orders, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, setOpen]);

  // عند الفتح: صفّر البحث وابدأ من المختار
  useEffect(() => {
    if (!open) return;
    setQuery('');
    const idx = orders.findIndex(o => o.id === value);
    setActiveIdx(idx >= 0 ? idx : 0);
    const raf = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open]);

  const pick = (id: string) => { onChange(id); setOpen(false); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Home') { e.preventDefault(); setActiveIdx(0); }
    else if (e.key === 'End') { e.preventDefault(); setActiveIdx(filtered.length - 1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const o = filtered[activeIdx];
      if (o) pick(o.id);
    }
  };

  const empty = orders.length === 0;

  return (
    <div ref={rootRef} className="relative min-w-0" onKeyDown={onKeyDown}>
      {/* عنوان العمود */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={`w-2 h-2 rounded-full shrink-0 ${th.dot}`} />
        <span className={`text-sm font-bold ${th.head}`}>
          {MEAL_ICON[meal]} {MEAL_TYPE_LABELS[meal]}
        </span>
        <span className="text-[11px] text-slate-400">({orders.length})</span>
      </div>

      {/* الحقل */}
      <button
        type="button"
        disabled={empty}
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`w-full min-w-0 flex items-center gap-2 px-3 py-2.5 rounded-lg border-2 bg-white text-right transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          selected ? th.active : th.idle
        } ${open ? `ring-2 ${th.ring}` : ''}`}
      >
        <span className={`flex-1 min-w-0 truncate text-sm font-semibold ${selected ? '' : 'text-slate-400'}`}>
          {empty ? 'لا توجد أوامر' : selected ? formatDate(selected.date) : '— اختر —'}
        </span>
        {!empty && (
          <svg className={`w-4 h-4 shrink-0 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {/* الفئة تحت الحقل — تأكيد بلا ازدحام داخله */}
      {selected && (
        <p className="mt-1 text-[11px] text-slate-500 truncate">
          {ENTITY_TYPE_LABELS_PLURAL[entityOf(selected)]}
        </p>
      )}

      {/* اللوحة */}
      {open && !empty && (
        <div
          className={`absolute z-40 mt-1.5 w-full min-w-[15rem] rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden ${
            align === 'end' ? 'left-0' : 'right-0'
          }`}
        >
          {showSearch && (
            <div className="p-2 border-b border-slate-100 bg-slate-50">
              <input
                ref={searchRef}
                value={query}
                onChange={e => { setQuery(e.target.value); setActiveIdx(0); }}
                placeholder="ابحث بالتاريخ…"
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:border-emerald-400"
              />
            </div>
          )}

          <div ref={listRef} className="max-h-[17rem] overflow-y-auto overscroll-contain">
            {filtered.map((o, idx) => {
              const isSel = o.id === value;
              const isActive = idx === activeIdx;
              return (
                <button
                  key={o.id}
                  type="button"
                  data-idx={idx}
                  role="option"
                  aria-selected={isSel}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => pick(o.id)}
                  className={`w-full text-right flex items-center gap-2 pl-2.5 pr-0 py-2 border-b border-slate-50 transition-colors ${
                    isSel ? th.rowOn : isActive ? 'bg-slate-50' : 'bg-white'
                  }`}
                >
                  <span className={`w-1 self-stretch rounded-full shrink-0 ${th.stripe}`} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs font-semibold text-slate-800 truncate">
                      {formatDateFull(o.date)}
                    </span>
                    <span className="block text-[10px] text-slate-500 truncate">
                      {ENTITY_TYPE_LABELS_PLURAL[entityOf(o)]}
                    </span>
                  </span>
                  {isSel && (
                    <svg className="w-3.5 h-3.5 shrink-0 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-slate-400">لا نتائج للبحث</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── المكوّن الرئيسي ────────────────────────────────────────────────────────────
export default function LdOrderPicker({ orders, value, onChange, loading = false }: {
  orders: DailyOrder[];
  value: string;
  onChange: (orderId: string) => void;
  loading?: boolean;
}) {
  // قائمة واحدة مفتوحة في كل لحظة — حتى ما تتراكب اللوحات فوق بعض
  const [openMeal, setOpenMeal] = useState<MealType | null>(null);

  const byMeal = useMemo(() => {
    const m: Record<string, DailyOrder[]> = { lunch: [], dinner: [] };
    orders.forEach(o => { if (m[o.meal_type]) m[o.meal_type].push(o); });
    return m;
  }, [orders]);

  const selected = useMemo(() => orders.find(o => o.id === value) ?? null, [orders, value]);

  if (loading) {
    return (
      <div className="space-y-2.5">
        <label className="label">اختر أمر التشغيل (غداء / عشاء)</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {LD_MEALS.map(meal => (
            <div key={meal} className="h-[4.5rem] rounded-lg bg-slate-50 border border-slate-200 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label className="label mb-0">اختر أمر التشغيل (غداء / عشاء)</label>
        {selected && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="text-[11px] text-slate-400 hover:text-red-500 transition-colors"
          >
            مسح الاختيار
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {LD_MEALS.map((meal, i) => (
          <MealColumn
            key={meal}
            meal={meal}
            orders={byMeal[meal]}
            value={value}
            onChange={onChange}
            open={openMeal === meal}
            setOpen={o => setOpenMeal(o ? meal : null)}
            align={i === LD_MEALS.length - 1 ? 'end' : 'start'}
          />
        ))}
      </div>
    </div>
  );
}
