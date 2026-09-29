'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase-client';
import { fetchAllRows } from '@/lib/fetch-all';
import type { Meal, MealType } from '@/lib/types';
import { MEAL_TYPE_LABELS } from '@/lib/types';
import type { ManualExtra } from '@/lib/fixed-extras-period';

/**
 * أصناف يضيفها المستخدم بأعدادها لحصر الإضافات — تُجمع في التقرير مع
 * الإضافات المحسوبة من المستفيدين (نفس الجدول والمجاميع والأسعار).
 */
export default function ManualExtrasEditor({ items, onChange, mealTypes }: {
  items: ManualExtra[];
  onChange: (items: ManualExtra[]) => void;
  /** الوجبات المختارة في الحصر — الإضافة اليدوية تُسند لإحداها */
  mealTypes: MealType[];
}) {
  const [meals, setMeals] = useState<Meal[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Meal | null>(null);
  const [qty, setQty] = useState('1');
  const [mealType, setMealType] = useState<MealType | ''>('');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await fetchAllRows((a, b) =>
        supabase.from('meals').select('id, name, english_name, type, is_snack').order('name').order('id').range(a, b));
      setMeals((data ?? []) as unknown as Meal[]);
    })();
  }, []);

  // إغلاق قائمة البحث عند الضغط خارجها
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const mealById = useMemo(() => new Map(meals.map(m => [m.id, m])), [meals]);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return meals.slice(0, 30);
    return meals.filter(m => m.name.toLowerCase().includes(q) || (m.english_name ?? '').toLowerCase().includes(q)).slice(0, 30);
  }, [meals, query]);

  const choose = (m: Meal) => {
    setPicked(m);
    setQuery(m.name);
    setOpen(false);
    // الوجبة الافتراضية = نوع الصنف لو كان من الوجبات المختارة
    setMealType(mealTypes.includes(m.type) ? m.type : mealTypes[0] ?? '');
  };

  const qtyNum = Number(qty);
  const canAdd = !!picked && !!mealType && Number.isInteger(qtyNum) && qtyNum > 0;

  const add = () => {
    if (!canAdd || !picked || !mealType) return;
    // نفس الصنف ونفس الوجبة → نجمع الكمية بدل صف مكرّر
    const i = items.findIndex(x => x.meal_id === picked.id && x.meal_type === mealType);
    if (i >= 0) onChange(items.map((x, k) => k === i ? { ...x, quantity: x.quantity + qtyNum } : x));
    else onChange([...items, { meal_id: picked.id, meal_type: mealType, quantity: qtyNum }]);
    setPicked(null); setQuery(''); setQty('1'); setMealType('');
  };

  const total = items.reduce((s, x) => s + x.quantity, 0);

  return (
    <div className="border border-sky-200 bg-sky-50/40 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <label className="label mb-0">أصناف مضافة يدوياً <span className="text-slate-400 font-normal">(اختياري)</span></label>
        {items.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="text-xs text-slate-400 hover:text-red-600 underline">
            مسح الكل
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_110px_140px_auto] gap-2 items-end">
        <div ref={boxRef} className="relative">
          <input
            value={query}
            onChange={e => { setQuery(e.target.value); setPicked(null); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (canAdd) add(); else if (results[0]) choose(results[0]); } }}
            placeholder="ابحث عن صنف…"
            className="input-field"
          />
          {open && results.length > 0 && (
            <div className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg">
              {results.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => choose(m)}
                  className="w-full text-right px-3 py-2 text-sm hover:bg-sky-50 flex items-center justify-between gap-2"
                >
                  <span className="truncate">{m.name}</span>
                  <span className="text-xs text-slate-400 flex-shrink-0">{MEAL_TYPE_LABELS[m.type]}{m.is_snack ? ' · سناك' : ''}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <span className="text-xs text-slate-500">العدد</span>
          <input
            type="number" min={1} step={1} inputMode="numeric"
            value={qty}
            onChange={e => setQty(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            className="input-field text-center"
          />
        </div>
        <div>
          <span className="text-xs text-slate-500">الوجبة</span>
          <select value={mealType} onChange={e => setMealType(e.target.value as MealType)} className="input-field" disabled={!picked}>
            {!picked && <option value="">—</option>}
            {mealTypes.map(t => <option key={t} value={t}>{MEAL_TYPE_LABELS[t]}</option>)}
          </select>
        </div>
        <button type="button" onClick={add} disabled={!canAdd} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
          + إضافة
        </button>
      </div>

      {items.length > 0 && (
        <div className="space-y-1.5">
          {items.map((x, i) => {
            const m = mealById.get(x.meal_id);
            const outside = !mealTypes.includes(x.meal_type);
            return (
              <div key={`${x.meal_id}|${x.meal_type}`}
                className={`flex items-center gap-3 bg-white border rounded-lg px-3 py-2 ${outside ? 'border-amber-200 opacity-60' : 'border-slate-200'}`}>
                <span className="flex-1 min-w-0 text-sm font-medium text-slate-700 truncate">{m?.name ?? 'صنف محذوف'}</span>
                <span className="text-xs text-slate-500 flex-shrink-0">
                  {MEAL_TYPE_LABELS[x.meal_type]}
                  {outside && <span className="text-amber-600"> · الوجبة غير مختارة — لن يُحسب</span>}
                </span>
                <input
                  type="number" min={1} step={1}
                  value={x.quantity}
                  onChange={e => {
                    const v = Math.floor(Number(e.target.value));
                    if (v > 0) onChange(items.map((y, k) => k === i ? { ...y, quantity: v } : y));
                  }}
                  className="w-20 px-2 py-1 border border-slate-200 rounded-md text-center text-sm"
                  aria-label="العدد"
                />
                <button type="button" onClick={() => onChange(items.filter((_, k) => k !== i))}
                  className="text-slate-300 hover:text-red-500 font-bold px-1" aria-label="حذف">✕</button>
              </div>
            );
          })}
          <p className="text-xs text-slate-500">
            {items.length} صنف · {total} حبة — تُجمع مع إضافات المستفيدين عند الحساب.
          </p>
        </div>
      )}
    </div>
  );
}
