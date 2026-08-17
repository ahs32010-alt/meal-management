'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase-client';
import { logActivity } from '@/lib/activity-log';
import { exportXLSX } from '@/lib/xlsx-utils';
import {
  formatMoney,
  mealMargin,
  parsePositiveNumber,
  round,
  type CostUnitDef,
  type MealPrice,
  type RawMaterial,
  type RecipeCost,
  type RecipeItem,
} from '@/lib/costs';
import { MEAL_TYPE_LABELS, type Meal, type MealType } from '@/lib/types';

const RecipeModal = dynamic(() => import('./RecipeModal'), { ssr: false });

interface Props {
  meals: Meal[];
  recipesByMeal: Record<string, RecipeItem[]>;
  recipeCosts: Record<string, RecipeCost>;
  pricesByMeal: Record<string, MealPrice>;
  materials: RawMaterial[];
  units: CostUnitDef[];
  canEdit: boolean;
  onChanged: () => Promise<void>;
}

const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner'];

type StatusFilter = 'all' | 'priced' | 'unpriced' | 'issues' | 'loss' | 'nosale';

const STATUS_LABELS: Record<StatusFilter, string> = {
  all:      'الكل',
  priced:   'مسعّرة',
  unpriced: 'بلا تكلفة',
  issues:   'فيها مشاكل',
  nosale:   'بلا سعر بيع',
  loss:     'خسارة',
};

/** لون الهامش: أحمر خسارة، برتقالي منخفض، أخضر جيد */
function marginTone(pct: number | null): string {
  if (pct === null) return 'text-slate-300';
  if (pct < 0)  return 'text-red-600';
  if (pct < 20) return 'text-amber-600';
  return 'text-emerald-600';
}

export default function MealCostsTab({
  meals, recipesByMeal, recipeCosts, pricesByMeal, materials, units, canEdit, onChanged,
}: Props) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<MealType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [editing, setEditing] = useState<Meal | null>(null);

  // تحرير سعر البيع مباشرة في الجدول — أسرع من فتح نافذة لكل صنف
  const [priceEdit, setPriceEdit] = useState<{ mealId: string; text: string } | null>(null);
  const [savingPrice, setSavingPrice] = useState(false);
  const [error, setError] = useState('');

  const rows = useMemo(() => {
    return meals.map(meal => {
      const items = recipesByMeal[meal.id] ?? [];
      const cost = recipeCosts[meal.id];
      const hasRecipe = items.length > 0;
      const portionCost = hasRecipe ? (cost?.total ?? 0) : 0;
      const price = pricesByMeal[meal.id]?.selling_price ?? null;
      return {
        meal,
        items,
        portionCost,
        issueCount: cost?.issues.length ?? 0,
        hasRecipe,
        margin: mealMargin(portionCost, price),
      };
    });
  }, [meals, recipesByMeal, recipeCosts, pricesByMeal]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter(r => (typeFilter === 'all' ? true : r.meal.type === typeFilter))
      .filter(r => {
        if (statusFilter === 'priced')   return r.hasRecipe && r.issueCount === 0;
        if (statusFilter === 'unpriced') return !r.hasRecipe;
        if (statusFilter === 'issues')   return r.hasRecipe && r.issueCount > 0;
        if (statusFilter === 'nosale')   return r.margin.status === 'unpriced';
        if (statusFilter === 'loss')     return r.margin.status === 'loss';
        return true;
      })
      .filter(r => (q ? r.meal.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.meal.name.localeCompare(b.meal.name, 'ar'));
  }, [rows, search, typeFilter, statusFilter]);

  const pricedCount = rows.filter(r => r.hasRecipe).length;
  const issueCount  = rows.filter(r => r.hasRecipe && r.issueCount > 0).length;
  const lossCount   = rows.filter(r => r.margin.status === 'loss').length;
  const withSale    = rows.filter(r => r.margin.status !== 'unpriced');
  const coverage    = rows.length > 0 ? (pricedCount / rows.length) * 100 : 0;

  /**
   * متوسط الهامش مرجّح: نجمع الأرباح ونقسمها على مجموع أسعار البيع بدل متوسط
   * النسب. متوسط النسب يعطي وزناً متساوياً لصنف بريالين وصنف بمئة ريال.
   */
  const avgMargin = useMemo(() => {
    const rev = withSale.reduce((s, r) => s + (r.margin.price ?? 0), 0);
    const profit = withSale.reduce((s, r) => s + (r.margin.profit ?? 0), 0);
    return rev > 0 ? (profit / rev) * 100 : null;
  }, [withSale]);

  const savePrice = async (mealId: string, mealName: string, text: string) => {
    const trimmed = text.trim();
    setError('');

    // فارغ = إزالة سعر البيع
    if (trimmed === '') {
      setSavingPrice(true);
      const { error: err } = await supabase.from('meal_pricing').delete().eq('meal_id', mealId);
      setSavingPrice(false);
      if (err) { setError(err.message); return; }
      void logActivity({
        action: 'delete', entity_type: 'meal_price', entity_id: mealId, entity_name: mealName,
      });
      setPriceEdit(null);
      await onChanged();
      return;
    }

    const price = parsePositiveNumber(trimmed);
    if (price === null) { setError(`سعر غير صالح لـ«${mealName}» — أدخل رقماً موجباً`); return; }

    setSavingPrice(true);
    const { error: err } = await supabase
      .from('meal_pricing')
      .upsert({ meal_id: mealId, selling_price: price }, { onConflict: 'meal_id' });
    setSavingPrice(false);
    if (err) { setError(err.message); return; }

    void logActivity({
      action: 'update', entity_type: 'meal_price', entity_id: mealId, entity_name: mealName,
      details: { selling_price: price },
    });
    setPriceEdit(null);
    await onChanged();
  };

  const handleExport = () => {
    if (filtered.length === 0) return;
    void exportXLSX(
      filtered.map(r => ({
        'الصنف': r.meal.name,
        'الوجبة': MEAL_TYPE_LABELS[r.meal.type],
        'عدد المكوّنات': r.items.length,
        'تكلفة الحصة': r.hasRecipe ? round(r.portionCost, 4) : '',
        'سعر البيع': r.margin.price ?? '',
        'الربح للحصة': r.margin.profit !== null ? round(r.margin.profit, 4) : '',
        'هامش الربح %': r.margin.marginPct !== null ? round(r.margin.marginPct, 2) : '',
        'نسبة التكلفة %': r.margin.foodCostPct !== null ? round(r.margin.foodCostPct, 2) : '',
        'الحالة': !r.hasRecipe ? 'بلا تكلفة' : r.issueCount > 0 ? 'تسعير ناقص' : 'مسعّر',
      })),
      `اسعار-وتكاليف-الاصناف-${new Date().toISOString().slice(0, 10)}.xlsx`,
      'الأسعار والتكاليف',
    );
  };

  return (
    <div className="space-y-4">
      {/* الملخّص */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="card px-4 py-3">
          <div className="text-xs text-slate-500 font-semibold">إجمالي الأصناف</div>
          <div className="text-2xl font-extrabold text-slate-800">{rows.length}</div>
        </div>
        <div className="card px-4 py-3">
          <div className="text-xs text-slate-500 font-semibold">لها تكلفة</div>
          <div className="text-2xl font-extrabold text-emerald-600">{pricedCount}</div>
        </div>
        <div className="card px-4 py-3">
          <div className="text-xs text-slate-500 font-semibold">لها سعر بيع</div>
          <div className="text-2xl font-extrabold text-slate-800">{withSale.length}</div>
        </div>
        <div className="card px-4 py-3">
          <div className="text-xs text-slate-500 font-semibold">متوسط الهامش</div>
          <div className={`text-2xl font-extrabold ${marginTone(avgMargin)}`}>
            {avgMargin === null ? '—' : `${Math.round(avgMargin)}%`}
          </div>
        </div>
        <div className="card px-4 py-3">
          <div className="text-xs text-slate-500 font-semibold">أصناف خاسرة</div>
          <div className={`text-2xl font-extrabold ${lossCount > 0 ? 'text-red-600' : 'text-slate-300'}`}>
            {lossCount}
          </div>
        </div>
      </div>

      {lossCount > 0 && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2.5 rounded-lg text-sm">
          🔴 {lossCount} صنف تكلفته أعلى من سعر بيعه — اضغط «خسارة» في الفلاتر لعرضها.
        </div>
      )}

      {(rows.length - pricedCount > 0 || issueCount > 0) && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2.5 rounded-lg text-sm">
          ⚠️ الصنف بلا تكلفة تُحسب تكلفته صفراً في أوامر التشغيل، وهامشه يظهر كأنه 100% وهو غير حقيقي.
          {issueCount > 0 && ` (${issueCount} صنف وصفته ناقصة أيضاً)`}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-start justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 shrink-0">✕</button>
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

        <div className="flex rounded-lg border border-slate-200 overflow-hidden flex-wrap">
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
                  <th className="table-header">تكلفة الحصة</th>
                  <th className="table-header">سعر البيع</th>
                  <th className="table-header">الربح</th>
                  <th className="table-header">الهامش</th>
                  <th className="table-header w-32"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(({ meal, items, portionCost, hasRecipe, issueCount: issues, margin }) => {
                  const isEditing = priceEdit?.mealId === meal.id;
                  return (
                    <tr key={meal.id} className="hover:bg-slate-50">
                      <td className="table-cell">
                        <div className="font-semibold text-slate-800">{meal.name}</div>
                        <div className="text-[11px] text-slate-400">
                          {MEAL_TYPE_LABELS[meal.type]}
                          {meal.is_snack && ' · 🍿 سناك'}
                          {hasRecipe && ` · ${items.length} مكوّن`}
                        </div>
                      </td>

                      {/* التكلفة */}
                      <td className="table-cell">
                        {!hasRecipe ? (
                          <span className="badge bg-red-50 text-red-600">بلا تكلفة</span>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-slate-800 tabular-nums" dir="ltr">{formatMoney(portionCost)}</span>
                            {issues > 0 && (
                              <span className="badge bg-amber-100 text-amber-700 text-[10px]" title="فيه مكوّنات غير محتسبة">ناقص</span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* سعر البيع — تحرير سريع */}
                      <td className="table-cell">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              inputMode="decimal"
                              autoFocus
                              value={priceEdit.text}
                              onChange={e => setPriceEdit({ mealId: meal.id, text: e.target.value })}
                              onKeyDown={e => {
                                if (e.key === 'Enter') void savePrice(meal.id, meal.name, priceEdit.text);
                                if (e.key === 'Escape') setPriceEdit(null);
                              }}
                              dir="ltr"
                              placeholder="0"
                              className="input-field py-1.5 px-2 text-sm text-center w-24"
                            />
                            <button
                              onClick={() => void savePrice(meal.id, meal.name, priceEdit.text)}
                              disabled={savingPrice}
                              title="حفظ (Enter)"
                              className="w-7 h-7 flex items-center justify-center text-emerald-600 hover:bg-emerald-50 rounded-lg disabled:opacity-40"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                              </svg>
                            </button>
                            <button
                              onClick={() => setPriceEdit(null)}
                              title="إلغاء (Esc)"
                              className="w-7 h-7 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-lg"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => canEdit && setPriceEdit({
                              mealId: meal.id,
                              text: margin.price !== null ? String(margin.price) : '',
                            })}
                            disabled={!canEdit}
                            title={canEdit ? 'اضغط لتعديل سعر البيع' : undefined}
                            className={`text-right px-2 py-1 rounded-lg -mr-2 ${canEdit ? 'hover:bg-emerald-50' : ''}`}
                          >
                            {margin.price === null ? (
                              <span className="text-slate-300 text-xs">{canEdit ? '+ أضف سعراً' : '—'}</span>
                            ) : (
                              <span className="font-bold text-slate-800 tabular-nums" dir="ltr">{formatMoney(margin.price)}</span>
                            )}
                          </button>
                        )}
                      </td>

                      {/* الربح */}
                      <td className="table-cell">
                        {margin.profit === null ? (
                          <span className="text-slate-300 text-xs">—</span>
                        ) : (
                          <span className={`font-bold tabular-nums ${margin.profit < 0 ? 'text-red-600' : 'text-slate-800'}`} dir="ltr">
                            {formatMoney(margin.profit)}
                          </span>
                        )}
                      </td>

                      {/* الهامش */}
                      <td className="table-cell">
                        {margin.marginPct === null ? (
                          <span className="text-slate-300 text-xs">—</span>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className={`font-bold tabular-nums ${marginTone(margin.marginPct)}`} dir="ltr">
                              {round(margin.marginPct, 1)}%
                            </span>
                            {margin.status === 'no_cost' && (
                              <span className="badge bg-amber-100 text-amber-700 text-[10px]" title="ما له وصفة — الهامش يبدو كاملاً وهو غير حقيقي">
                                غير حقيقي
                              </span>
                            )}
                            {margin.status === 'loss' && (
                              <span className="badge bg-red-100 text-red-700 text-[10px]">خسارة</span>
                            )}
                            {margin.foodCostPct !== null && margin.status === 'ok' && (
                              <span className="text-[10px] text-slate-400" title="نسبة تكلفة الطعام">
                                تكلفة {Math.round(margin.foodCostPct)}%
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
                  );
                })}
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
          sellingPrice={pricesByMeal[editing.id]?.selling_price ?? null}
          canEdit={canEdit}
          onDataChanged={onChanged}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void onChanged(); }}
        />
      )}
    </div>
  );
}
