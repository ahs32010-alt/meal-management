'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { exportXLSX } from '@/lib/xlsx-utils';
import { formatMoney, type CostUnitDef, type RawMaterial, type RecipeCost, type RecipeItem } from '@/lib/costs';
import { MEAL_TYPE_LABELS, type Meal, type MealType } from '@/lib/types';

const RecipeModal = dynamic(() => import('./RecipeModal'), { ssr: false });

interface Props {
  meals: Meal[];
  recipesByMeal: Record<string, RecipeItem[]>;
  recipeCosts: Record<string, RecipeCost>;
  materials: RawMaterial[];
  units: CostUnitDef[];
  canEdit: boolean;
  onChanged: () => Promise<void>;
}

const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner'];

type StatusFilter = 'all' | 'priced' | 'unpriced' | 'issues';

const STATUS_LABELS: Record<StatusFilter, string> = {
  all:      'الكل',
  priced:   'مسعّرة',
  unpriced: 'بدون تسعير',
  issues:   'فيها مشاكل',
};

export default function MealCostsTab({
  meals, recipesByMeal, recipeCosts, materials, units, canEdit, onChanged,
}: Props) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<MealType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [editing, setEditing] = useState<Meal | null>(null);

  const rows = useMemo(() => {
    return meals.map(meal => {
      const items = recipesByMeal[meal.id] ?? [];
      const cost = recipeCosts[meal.id];
      const hasRecipe = items.length > 0;
      return {
        meal,
        items,
        portionCost: cost?.total ?? 0,
        issueCount: cost?.issues.length ?? 0,
        hasRecipe,
      };
    });
  }, [meals, recipesByMeal, recipeCosts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter(r => (typeFilter === 'all' ? true : r.meal.type === typeFilter))
      .filter(r => {
        if (statusFilter === 'priced')   return r.hasRecipe && r.issueCount === 0;
        if (statusFilter === 'unpriced') return !r.hasRecipe;
        if (statusFilter === 'issues')   return r.hasRecipe && r.issueCount > 0;
        return true;
      })
      .filter(r => (q ? r.meal.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.meal.name.localeCompare(b.meal.name, 'ar'));
  }, [rows, search, typeFilter, statusFilter]);

  const pricedCount = rows.filter(r => r.hasRecipe).length;
  const issueCount = rows.filter(r => r.hasRecipe && r.issueCount > 0).length;
  const coverage = rows.length > 0 ? (pricedCount / rows.length) * 100 : 0;

  const handleExport = () => {
    if (filtered.length === 0) return;
    void exportXLSX(
      filtered.map(r => ({
        'الصنف': r.meal.name,
        'الوجبة': MEAL_TYPE_LABELS[r.meal.type],
        'عدد المكوّنات': r.items.length,
        'تكلفة الحصة (ريال)': r.hasRecipe ? Number(r.portionCost.toFixed(4)) : '',
        'الحالة': !r.hasRecipe ? 'بدون تسعير' : r.issueCount > 0 ? 'تسعير ناقص' : 'مسعّر',
      })),
      `meal-costs-${new Date().toISOString().slice(0, 10)}.xlsx`,
      'تسعير الأصناف',
    );
  };

  return (
    <div className="space-y-4">
      {/* ملخّص التغطية — أهم رقم في هذا التبويب */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card px-4 py-3">
          <div className="text-xs text-slate-500 font-semibold">إجمالي الأصناف</div>
          <div className="text-2xl font-extrabold text-slate-800">{rows.length}</div>
        </div>
        <div className="card px-4 py-3">
          <div className="text-xs text-slate-500 font-semibold">مسعّرة</div>
          <div className="text-2xl font-extrabold text-emerald-600">{pricedCount}</div>
        </div>
        <div className="card px-4 py-3">
          <div className="text-xs text-slate-500 font-semibold">بدون تسعير</div>
          <div className="text-2xl font-extrabold text-red-500">{rows.length - pricedCount}</div>
        </div>
        <div className="card px-4 py-3">
          <div className="text-xs text-slate-500 font-semibold">نسبة التغطية</div>
          <div className={`text-2xl font-extrabold ${coverage >= 100 ? 'text-emerald-600' : coverage >= 60 ? 'text-amber-500' : 'text-red-500'}`}>
            {Math.round(coverage)}%
          </div>
        </div>
      </div>

      {(rows.length - pricedCount > 0 || issueCount > 0) && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2.5 rounded-lg text-sm">
          ⚠️ أي صنف بدون تسعير تُحسب تكلفته صفراً في أوامر التشغيل — يعني إجمالي اليوم راح يطلع أقل من الحقيقة.
          {issueCount > 0 && ` (${issueCount} صنف وصفته ناقصة أيضاً)`}
        </div>
      )}

      {/* الفلاتر */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input-field pr-10"
            placeholder="ابحث عن صنف..."
          />
          <svg className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>

        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value as MealType | 'all')}
          className="input-field w-auto"
        >
          <option value="all">كل الوجبات</option>
          {MEAL_TYPES.map(t => (
            <option key={t} value={t}>{MEAL_TYPE_LABELS[t]}</option>
          ))}
        </select>

        <div className="flex rounded-lg border border-slate-200 overflow-hidden">
          {(Object.keys(STATUS_LABELS) as StatusFilter[]).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-2 text-xs font-bold transition-colors ${
                statusFilter === s ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
              }`}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        {filtered.length > 0 && (
          <button onClick={handleExport} className="btn-secondary text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            تصدير
          </button>
        )}
      </div>

      {/* الجدول */}
      <div className="card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm">
            {meals.length === 0 ? 'ما فيه أصناف — أضفها من صفحة الأصناف أولاً' : 'ما فيه نتائج'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">الصنف</th>
                  <th className="table-header">الوجبة</th>
                  <th className="table-header">المكوّنات</th>
                  <th className="table-header">تكلفة الحصة</th>
                  <th className="table-header w-32"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(({ meal, items, portionCost, hasRecipe, issueCount: issues }) => (
                  <tr key={meal.id} className="hover:bg-slate-50">
                    <td className="table-cell">
                      <div className="font-semibold text-slate-800">{meal.name}</div>
                      {meal.is_snack && <span className="badge bg-amber-100 text-amber-700 text-[10px] mt-0.5">🍿 سناك</span>}
                    </td>
                    <td className="table-cell text-slate-600 text-xs">{MEAL_TYPE_LABELS[meal.type]}</td>
                    <td className="table-cell">
                      {hasRecipe ? (
                        <span className="text-slate-700 text-xs">{items.length} مكوّن</span>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="table-cell">
                      {!hasRecipe ? (
                        <span className="badge bg-red-50 text-red-600">بدون تسعير</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-800 tabular-nums" dir="ltr">{formatMoney(portionCost)}</span>
                          <span className="text-[11px] text-slate-400">ريال</span>
                          {issues > 0 && (
                            <span className="badge bg-amber-100 text-amber-700 text-[10px]" title="فيه مكوّنات غير محتسبة">
                              ناقص
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="table-cell">
                      <button
                        onClick={() => setEditing(meal)}
                        className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors ${
                          hasRecipe
                            ? 'border-slate-200 text-slate-600 hover:bg-slate-100'
                            : 'border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                        }`}
                      >
                        {canEdit ? (hasRecipe ? 'تعديل الوصفة' : 'تسعير الصنف') : 'عرض الوصفة'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <RecipeModal
          meal={editing}
          existing={recipesByMeal[editing.id] ?? []}
          materials={materials}
          units={units}
          canEdit={canEdit}
          onDataChanged={onChanged}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void onChanged(); }}
        />
      )}
    </div>
  );
}
