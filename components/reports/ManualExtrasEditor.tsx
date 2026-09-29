'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase-client';
import { fetchAllRows } from '@/lib/fetch-all';
import { todayISO } from '@/lib/date-utils';
import type { Meal, MealType } from '@/lib/types';
import { MEAL_TYPE_LABELS } from '@/lib/types';
import { datesInRange, manualActiveDays, type ManualExtra } from '@/lib/fixed-extras-period';

/** 2026-09-01 → 01/09/2026 */
const dmy = (iso: string) => iso.split('-').reverse().join('/');

/**
 * أصناف يضيفها المستخدم بعدد يومي وفترة (من تاريخ — إلى تاريخ أو مستمر).
 * تُجمع في الحصر مع الإضافات المحسوبة من المستفيدين: العدد × أيام فترتها
 * الواقعة داخل فترة الحصر.
 */
export default function ManualExtrasEditor({
  items, mealTypes, reportFrom, reportTo, notice, onAdd, onUpdate, onRemove, onClear,
}: {
  items: ManualExtra[];
  /** الوجبات المختارة في الحصر — الإضافة اليدوية تُسند لإحداها */
  mealTypes: MealType[];
  /** فترة الحصر الحالية — لعرض كم يوماً سيُحسب من كل صنف */
  reportFrom: string;
  reportTo: string;
  /** تنبيه يظهر تحت القسم (خطأ حفظ أو تخزين مؤقت) */
  notice?: string;
  onAdd: (x: ManualExtra) => void;
  onUpdate: (id: string, patch: Partial<ManualExtra>) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  const [meals, setMeals] = useState<Meal[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Meal | null>(null);
  const [qty, setQty] = useState('1');
  const [mealType, setMealType] = useState<MealType | ''>('');
  const [start, setStart] = useState(() => todayISO());
  const [ongoing, setOngoing] = useState(true);
  const [end, setEnd] = useState('');
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
  const reportDates = useMemo(
    () => (reportFrom && reportTo && reportFrom <= reportTo ? datesInRange(reportFrom, reportTo) : []),
    [reportFrom, reportTo],
  );

  const choose = (m: Meal) => {
    setPicked(m);
    setQuery(m.name);
    setOpen(false);
    // الوجبة الافتراضية = نوع الصنف لو كان من الوجبات المختارة
    setMealType(mealTypes.includes(m.type) ? m.type : mealTypes[0] ?? '');
  };

  const qtyNum = Number(qty);
  const endOk = ongoing || (!!end && end >= start);
  const canAdd = !!picked && !!mealType && Number.isInteger(qtyNum) && qtyNum > 0 && !!start && endOk;

  const add = () => {
    if (!canAdd || !picked || !mealType) return;
    onAdd({ meal_id: picked.id, meal_type: mealType, quantity: qtyNum, start_date: start, end_date: ongoing ? null : end });
    setPicked(null); setQuery(''); setQty('1'); setMealType('');
  };

  return (
    <div className="border border-sky-200 bg-sky-50/40 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <label className="label mb-0">
          أصناف مضافة يدوياً <span className="text-slate-400 font-normal">(محفوظة — تبقى حتى تعدّلها أو تحذفها)</span>
        </label>
        {items.length > 0 && (
          <button
            type="button"
            onClick={() => { if (confirm('حذف كل الأصناف المضافة يدوياً؟')) onClear(); }}
            className="text-xs text-slate-400 hover:text-red-600 underline"
          >
            مسح الكل
          </button>
        )}
      </div>

      {/* ── إضافة صنف ── */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_110px_140px] gap-2 items-end">
          <div ref={boxRef} className="relative">
            <span className="text-xs text-slate-500">الصنف</span>
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
            <span className="text-xs text-slate-500">العدد يومياً</span>
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
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <span className="text-xs text-slate-500">يبدأ من</span>
            <input type="date" value={start} onChange={e => setStart(e.target.value)} className="input-field" />
          </div>
          <div>
            <span className="text-xs text-slate-500">ينتهي في</span>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer select-none whitespace-nowrap">
                <input type="checkbox" checked={ongoing} onChange={e => setOngoing(e.target.checked)} className="accent-sky-600" />
                مستمر
              </label>
              {!ongoing && (
                <input type="date" value={end} min={start} onChange={e => setEnd(e.target.value)} className="input-field" />
              )}
            </div>
          </div>
          <div className="flex-1" />
          <button type="button" onClick={add} disabled={!canAdd} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
            + إضافة
          </button>
        </div>
        {!ongoing && end && end < start && <p className="text-xs text-red-500">تاريخ النهاية قبل تاريخ البداية</p>}
      </div>

      {/* ── القائمة المحفوظة ── */}
      {items.length > 0 && (
        <div className="space-y-1.5">
          {items.map(x => {
            const m = mealById.get(x.meal_id);
            const outside = !mealTypes.includes(x.meal_type);
            const days = manualActiveDays(x, reportDates);
            const counted = !outside && days > 0;
            return (
              <div key={x.id}
                className={`flex items-center gap-3 flex-wrap bg-white border rounded-lg px-3 py-2 ${counted ? 'border-slate-200' : 'border-amber-200'}`}>
                <div className="flex-1 min-w-[140px]">
                  <p className="text-sm font-medium text-slate-700 truncate">{m?.name ?? 'صنف محذوف'}</p>
                  <p className="text-xs text-slate-500">
                    {MEAL_TYPE_LABELS[x.meal_type]}
                    {' · '}
                    {counted
                      ? <span className="text-sky-700">يُحسب {days} يوم × {x.quantity} = {days * x.quantity} في الحصر الحالي</span>
                      : <span className="text-amber-600">{outside ? 'الوجبة غير مختارة — لن يُحسب' : 'فترته خارج فترة الحصر — لن يُحسب'}</span>}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <span>من</span>
                  <DateInput value={x.start_date} max={x.end_date ?? undefined}
                    onCommit={v => x.id && onUpdate(x.id, { start_date: v })} />
                  <span>إلى</span>
                  {x.end_date === null ? (
                    <button type="button" title="حدّد تاريخ نهاية"
                      onClick={() => x.id && onUpdate(x.id, { end_date: todayISO() >= x.start_date ? todayISO() : x.start_date })}
                      className="px-2 py-1 rounded-md bg-sky-50 border border-sky-200 text-sky-700 font-semibold hover:bg-sky-100">
                      مستمر
                    </button>
                  ) : (
                    <>
                      <DateInput value={x.end_date} min={x.start_date}
                        onCommit={v => x.id && onUpdate(x.id, { end_date: v })} />
                      <button type="button" title="اجعله مستمراً بلا نهاية"
                        onClick={() => x.id && onUpdate(x.id, { end_date: null })}
                        className="text-sky-600 hover:underline">∞</button>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-1 text-xs text-slate-500">
                  <QtyInput value={x.quantity} onCommit={v => x.id && onUpdate(x.id, { quantity: v })} />
                  <span>يومياً</span>
                </div>
                <button type="button" onClick={() => x.id && onRemove(x.id)}
                  className="text-slate-300 hover:text-red-500 font-bold px-1" aria-label="حذف">✕</button>
              </div>
            );
          })}
        </div>
      )}
      {notice && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{notice}</p>}
    </div>
  );
}

/** خانة عدد تُحفظ عند الخروج منها أو Enter — لا مع كل ضغطة (كل حفظ كتابة في القاعدة) */
function QtyInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => {
    const v = Math.floor(Number(draft));
    if (v > 0 && v !== value) onCommit(v);
    else setDraft(String(value));
  };
  return (
    <input
      type="number" min={1} step={1}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
      className="w-16 px-2 py-1 border border-slate-200 rounded-md text-center text-sm"
      aria-label="العدد يومياً"
    />
  );
}

/** تاريخ يُحفظ عند تغييره إن كان صالحاً ضمن الحدود */
function DateInput({ value, min, max, onCommit }: { value: string; min?: string; max?: string; onCommit: (v: string) => void }) {
  return (
    <input
      type="date"
      value={value}
      min={min}
      max={max}
      title={dmy(value)}
      onChange={e => {
        const v = e.target.value;
        if (!v || v === value) return;
        if ((min && v < min) || (max && v > max)) return;
        onCommit(v);
      }}
      className="px-1.5 py-1 border border-slate-200 rounded-md text-xs"
    />
  );
}
