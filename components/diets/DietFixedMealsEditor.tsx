'use client';

import { useState } from 'react';
import type { DietSystemFixedMeal, Meal, MealType } from '@/lib/types';
import { MEAL_TYPE_LABELS, DAY_LABELS, DAYS_ORDER } from '@/lib/types';

const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner'];

/** صنف ثابت في النظام بصيغة التحرير — صف واحد لكل (صنف، وجبة) بأيامه */
export type DietFixedDraft = {
  meal_id: string;
  meal_type: MealType;
  days: number[];
  quantity: number;
  is_alternative: boolean;
};

/** صفوف القاعدة (صف لكل يوم) → مسودات مجمّعة بالصنف والوجبة */
export function draftsFromRows(rows: DietSystemFixedMeal[]): DietFixedDraft[] {
  const map = new Map<string, DietFixedDraft>();
  for (const r of rows) {
    const key = `${r.meal_id}_${r.meal_type}`;
    const cur = map.get(key);
    if (cur) {
      if (!cur.days.includes(r.day_of_week)) cur.days.push(r.day_of_week);
    } else {
      map.set(key, {
        meal_id: r.meal_id,
        meal_type: r.meal_type,
        days: [r.day_of_week],
        quantity: r.quantity ?? 1,
        is_alternative: r.is_alternative === true,
      });
    }
  }
  return [...map.values()];
}

/** المسودات → صفوف القاعدة (المسودة بلا أيام لا تُكتب) */
export function rowsFromDrafts(drafts: DietFixedDraft[]): DietSystemFixedMeal[] {
  return drafts.flatMap(d => d.days.map(day => ({
    day_of_week: day,
    meal_type: d.meal_type,
    meal_id: d.meal_id,
    quantity: d.quantity,
    is_alternative: d.is_alternative,
  })));
}

export const fixedRowKey = (r: { day_of_week: number; meal_type: string; meal_id: string }) =>
  `${r.day_of_week}|${r.meal_type}|${r.meal_id}`;

/**
 * تبويب «الأصناف الثابتة» في نافذة النظام الغذائي — نفس شكل تبويب «الثابتة
 * الأسبوعية» في صفحة المستفيد: صنف + وجبة + أيام + كمية + علامة «صنف بديل».
 */
export default function DietFixedMealsEditor({ meals, drafts, onChange }: {
  meals: Meal[];
  drafts: DietFixedDraft[];
  onChange: (next: DietFixedDraft[]) => void;
}) {
  const [mealType, setMealType] = useState<MealType>('breakfast');
  const [isSnack, setIsSnack] = useState(false);
  const mealById = new Map(meals.map(m => [m.id, m]));

  const taken = new Set(drafts.filter(d => d.meal_type === mealType).map(d => d.meal_id));
  const options = meals.filter(m => m.type === mealType && m.is_snack === isSnack && !taken.has(m.id));

  const update = (d: DietFixedDraft, patch: Partial<DietFixedDraft>) =>
    onChange(drafts.map(x => (x.meal_id === d.meal_id && x.meal_type === d.meal_type ? { ...x, ...patch } : x)));
  const toggleDay = (d: DietFixedDraft, day: number) =>
    update(d, { days: d.days.includes(day) ? d.days.filter(x => x !== day) : [...d.days, day] });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
        <span className="text-xs text-slate-500">إضافة صنف ثابت:</span>
        <select value={mealType} onChange={e => setMealType(e.target.value as MealType)}
          className="text-xs border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-400">
          {MEAL_TYPES.map(t => <option key={t} value={t}>{MEAL_TYPE_LABELS[t]}</option>)}
        </select>
        <div className="flex items-center gap-0.5 bg-white border border-slate-200 rounded-lg p-0.5">
          <button type="button" onClick={() => setIsSnack(false)}
            className={`text-xs font-semibold px-2.5 py-1 rounded-md transition-colors ${!isSnack ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            صنف
          </button>
          <button type="button" onClick={() => setIsSnack(true)}
            className={`text-xs font-semibold px-2.5 py-1 rounded-md transition-colors ${isSnack ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            سناك
          </button>
        </div>
        <select
          value=""
          onChange={e => {
            const id = e.target.value;
            if (!id) return;
            // كل الأيام افتراضياً — الأشيع في النظام؛ تُشال الأيام من الأزرار تحت
            onChange([...drafts, { meal_id: id, meal_type: mealType, days: [...DAYS_ORDER], quantity: 1, is_alternative: false }]);
          }}
          className="text-xs border border-slate-200 rounded-lg px-2 py-1 min-w-[12rem] focus:outline-none focus:ring-1 focus:ring-emerald-400"
        >
          <option value="">{isSnack ? 'اختر سناك…' : 'اختر صنف…'}</option>
          {options.map(m => (
            <option key={m.id} value={m.id}>
              {m.name}{m.entity_type === 'companion' ? ' (مرافقين)' : ''}
            </option>
          ))}
        </select>
      </div>

      {drafts.length === 0 ? (
        <div className="border border-dashed border-slate-200 rounded-xl py-10 text-center text-slate-400 text-sm">
          لا توجد أصناف ثابتة في هذا النظام
        </div>
      ) : (
        <div className="space-y-3">
          {drafts.map(d => {
            const meal = mealById.get(d.meal_id);
            return (
              <div key={`${d.meal_id}_${d.meal_type}`} className="border border-slate-200 rounded-xl">
                <div className="flex items-center justify-between gap-2 flex-wrap px-4 py-2.5 bg-slate-50 border-b border-slate-100 rounded-t-xl">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-800">{meal?.name ?? 'صنف محذوف'}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${meal?.is_snack ? 'text-purple-700 bg-purple-50' : 'text-emerald-700 bg-emerald-50'}`}>
                      {meal?.is_snack ? `سناك ${MEAL_TYPE_LABELS[d.meal_type]}` : MEAL_TYPE_LABELS[d.meal_type]}
                    </span>
                    <button type="button" onClick={() => update(d, { is_alternative: !d.is_alternative })}
                      title="الصنف البديل يُحتسب مع الأصناف البديلة في أمر التشغيل بدل الأصناف اليومية الثابتة"
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full border transition-colors ${d.is_alternative
                        ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm'
                        : 'bg-white border-dashed border-slate-300 text-slate-400 hover:border-emerald-400 hover:text-emerald-600'}`}>
                      {d.is_alternative ? '✓ صنف بديل' : 'صنف بديل'}
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">{d.days.length} يوم</span>
                    <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-1.5 py-0.5">
                      <button type="button" onClick={() => update(d, { quantity: Math.max(1, d.quantity - 1) })}
                        className="w-4 h-4 flex items-center justify-center rounded text-slate-500 hover:bg-slate-100 text-sm font-bold leading-none">−</button>
                      <span className="text-xs font-bold text-slate-700 min-w-[1.25rem] text-center">{d.quantity}</span>
                      <button type="button" onClick={() => update(d, { quantity: Math.min(99, d.quantity + 1) })}
                        className="w-4 h-4 flex items-center justify-center rounded text-slate-500 hover:bg-slate-100 text-sm font-bold leading-none">+</button>
                    </div>
                    <button type="button" onClick={() => update(d, { days: d.days.length === 7 ? [] : [...DAYS_ORDER] })}
                      className="text-xs text-emerald-600 hover:text-emerald-800 font-semibold px-2 py-0.5 rounded hover:bg-emerald-50 transition-colors">
                      {d.days.length === 7 ? 'إلغاء الكل' : 'كل الأيام'}
                    </button>
                    <button type="button" onClick={() => onChange(drafts.filter(x => x !== d))}
                      className="text-slate-300 hover:text-red-500 transition-colors" title="حذف الصنف من النظام">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 px-4 py-3">
                  {DAYS_ORDER.map(day => (
                    <button key={day} type="button" onClick={() => toggleDay(d, day)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${d.days.includes(day)
                        ? 'bg-emerald-500 text-white shadow-sm'
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                      {DAY_LABELS[day]}
                    </button>
                  ))}
                </div>
                {d.days.length === 0 && (
                  <p className="px-4 pb-3 text-[11px] text-amber-600">بلا أيام — لن يُحفظ هذا الصنف. اختر يوماً واحداً على الأقل.</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
