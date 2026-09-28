'use client';

import { useState, useRef } from 'react';
import type { Meal } from '@/lib/types';

/**
 * محرّر المحظورات مقسّماً على الوجبات (فطور/غداء/عشاء + سناكاتها) — لكل صنف
 * محظور بديل اختياري. مشترك بين صفحة المستفيد وصفحة النظام الغذائي.
 */

export interface ExclusionEntry {
  meal_id: string;
  alternative_meal_id: string;
}

// ─── Meal type exclusion section ────────────────────────────────────────────
type SectionColorKey = 'amber' | 'amber-snack' | 'emerald' | 'emerald-snack' | 'blue' | 'blue-snack';

const SECTION_STYLES: Record<SectionColorKey, { header: string; badge: string; chip: string; addBtn: string; dot: string }> = {
  'amber':        { header: 'bg-amber-50 border-amber-200',      badge: 'bg-amber-100 text-amber-700',    chip: 'bg-amber-50 border-amber-200 text-amber-800',    addBtn: 'text-amber-600 hover:bg-amber-100 border-amber-300',    dot: 'bg-amber-400' },
  'amber-snack':  { header: 'bg-orange-50 border-orange-200',    badge: 'bg-orange-100 text-orange-700',  chip: 'bg-orange-50 border-orange-200 text-orange-800',  addBtn: 'text-orange-500 hover:bg-orange-100 border-orange-300', dot: 'bg-orange-300' },
  'emerald':      { header: 'bg-emerald-50 border-emerald-200',  badge: 'bg-emerald-100 text-emerald-700',chip: 'bg-emerald-50 border-emerald-200 text-emerald-800',addBtn: 'text-emerald-600 hover:bg-emerald-100 border-emerald-300',dot: 'bg-emerald-400' },
  'emerald-snack':{ header: 'bg-teal-50 border-teal-200',        badge: 'bg-teal-100 text-teal-700',      chip: 'bg-teal-50 border-teal-200 text-teal-800',        addBtn: 'text-teal-500 hover:bg-teal-100 border-teal-300',      dot: 'bg-teal-300' },
  'blue':         { header: 'bg-blue-50 border-blue-200',        badge: 'bg-blue-100 text-blue-700',      chip: 'bg-blue-50 border-blue-200 text-blue-800',        addBtn: 'text-blue-600 hover:bg-blue-100 border-blue-300',      dot: 'bg-blue-400' },
  'blue-snack':   { header: 'bg-indigo-50 border-indigo-200',    badge: 'bg-indigo-100 text-indigo-700',  chip: 'bg-indigo-50 border-indigo-200 text-indigo-800',  addBtn: 'text-indigo-500 hover:bg-indigo-100 border-indigo-300', dot: 'bg-indigo-300' },
};

export function MealTypeSection({
  label, color, items, sectionMeals, excludedIds, allMeals,
  onAdd, onRemove, onSetAlt, mealById, isSnack,
}: {
  label: string; color: SectionColorKey; isSnack?: boolean;
  items: ExclusionEntry[]; sectionMeals: Meal[]; excludedIds: string[]; allMeals: Meal[];
  onAdd: (m: Meal) => void; onRemove: (id: string) => void;
  onSetAlt: (mealId: string, altId: string) => void;
  mealById: (id: string) => Meal | undefined;
}) {
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const availableMeals = sectionMeals.filter(m => !excludedIds.includes(m.id));
  const filteredMeals = availableMeals.filter(m =>
    m.name.includes(query) || (m.english_name ?? '').toLowerCase().includes(query.toLowerCase())
  );

  const openPicker = () => { setPicking(true); setQuery(''); setTimeout(() => inputRef.current?.focus(), 50); };
  const closePicker = () => { setPicking(false); setQuery(''); };

  const s = SECTION_STYLES[color];

  return (
    <div className={isSnack ? 'mr-5 border-r-2 border-r-slate-200' : ''}>
      <div className={`border rounded-xl ${s.header}`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-2 border-b ${s.header}`}>
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${s.dot} ${isSnack ? 'opacity-60' : ''}`} />
          <span className={`font-semibold text-slate-700 ${isSnack ? 'text-xs' : 'text-sm'}`}>{label}</span>
          {items.length > 0 && (
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.badge}`}>
              {items.length} ممنوع
            </span>
          )}
        </div>
        {!picking && availableMeals.length > 0 && (
          <button
            type="button"
            onClick={openPicker}
            className={`flex items-center gap-1 px-3 py-1.5 border border-dashed rounded-lg text-xs font-medium transition-colors ${s.addBtn}`}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            إضافة
          </button>
        )}
        {picking && (
          <button type="button" onClick={closePicker} className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1 rounded">
            إغلاق
          </button>
        )}
      </div>

      {/* Selected chips */}
      {items.length > 0 && (
        <div className="px-4 pt-3 pb-2 flex flex-wrap gap-2">
          {items.map(ex => {
            const meal = mealById(ex.meal_id);
            if (!meal) return null;
            const candidates = allMeals.filter(m => m.type === meal.type && m.is_snack === meal.is_snack && m.id !== meal.id);
            return (
              <div key={ex.meal_id} className={`flex items-center gap-1.5 border rounded-lg px-2.5 py-1.5 text-xs font-medium bg-white ${s.chip}`}>
                <button type="button" onClick={() => onRemove(ex.meal_id)}
                  className="text-slate-300 hover:text-red-500 transition-colors leading-none font-bold">✕</button>
                <span className="line-through opacity-50">{meal.name}</span>
                {candidates.length > 0 && (
                  <>
                    <span className="text-slate-300 text-base leading-none">→</span>
                    <select
                      value={ex.alternative_meal_id}
                      onChange={e => onSetAlt(ex.meal_id, e.target.value)}
                      className="text-xs bg-white border border-slate-200 rounded px-1.5 py-0.5 text-slate-600 focus:outline-none max-w-[110px]"
                    >
                      <option value="">بلا بديل</option>
                      {candidates.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {items.length === 0 && !picking && (
        <div className="px-4 py-3 text-center text-xs text-slate-400">
          {availableMeals.length === 0 ? 'لا توجد أصناف في هذه الوجبة' : 'لا يوجد محظورات'}
        </div>
      )}

      {/* Inline picker panel */}
      {picking && (
        <div className="border-t border-slate-200 bg-white px-4 pt-3 pb-3">
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="ابحث عن صنف..."
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-300 mb-3"
          />
          {filteredMeals.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-2">لا توجد نتائج</p>
          ) : (
            <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto">
              {filteredMeals.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => { onAdd(m); closePicker(); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors bg-white hover:bg-opacity-80 ${s.chip} hover:shadow-sm`}
                >
                  {m.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
    </div>
  );
}


const SECTIONS: { key: string; label: string; color: SectionColorKey; type: Meal['type']; snack: boolean }[] = [
  { key: 'breakfast',      label: 'الفطور',        color: 'amber',         type: 'breakfast', snack: false },
  { key: 'breakfastSnack', label: 'سناكات الفطور', color: 'amber-snack',   type: 'breakfast', snack: true },
  { key: 'lunch',          label: 'الغداء',        color: 'emerald',       type: 'lunch',     snack: false },
  { key: 'lunchSnack',     label: 'سناكات الغداء', color: 'emerald-snack', type: 'lunch',     snack: true },
  { key: 'dinner',         label: 'العشاء',        color: 'blue',          type: 'dinner',    snack: false },
  { key: 'dinnerSnack',    label: 'سناكات العشاء', color: 'blue-snack',    type: 'dinner',    snack: true },
];

export default function ExclusionSectionsEditor({ meals, items, onAdd, onRemove, onSetAlt }: {
  meals: Meal[];
  items: ExclusionEntry[];
  onAdd: (m: Meal) => void;
  onRemove: (mealId: string) => void;
  onSetAlt: (mealId: string, altId: string) => void;
}) {
  const byId = new Map(meals.map(m => [m.id, m]));
  const mealById = (id: string) => byId.get(id);
  const excludedIds = items.map(e => e.meal_id);
  return (
    <>
      {SECTIONS.map(sec => (
        <MealTypeSection
          key={sec.key}
          label={sec.label}
          color={sec.color}
          isSnack={sec.snack || undefined}
          items={items.filter(ex => {
            const m = mealById(ex.meal_id);
            return m?.type === sec.type && !!m.is_snack === sec.snack;
          })}
          sectionMeals={meals.filter(m => m.type === sec.type && !!m.is_snack === sec.snack)}
          excludedIds={excludedIds}
          allMeals={meals}
          onAdd={onAdd}
          onRemove={onRemove}
          onSetAlt={onSetAlt}
          mealById={mealById}
        />
      ))}
    </>
  );
}
