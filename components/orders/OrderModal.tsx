'use client';

import { useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase-client';
import { logActivity } from '@/lib/activity-log';
import type { DailyOrder, Meal, MealType, OrderItem } from '@/lib/types';
import { MEAL_TYPE_LABELS } from '@/lib/types';

interface SelectedItem {
  meal_id: string;
  display_name: string;
  extra_quantity: number;
}

interface Props {
  meals: Meal[];
  totalBeneficiaries: number;
  exclusionCounts: Record<string, number>;
  editingOrder?: DailyOrder | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function OrderModal({ meals, totalBeneficiaries, exclusionCounts, editingOrder, onClose, onSaved }: Props) {
  const isEdit = !!editingOrder;

  const initSelected = (): SelectedItem[] => {
    if (!editingOrder?.order_items) return [];
    return (editingOrder.order_items as OrderItem[]).map(item => ({
      meal_id: item.meal_id,
      display_name: item.display_name ?? item.meals?.name ?? '',
      extra_quantity: item.extra_quantity ?? 0,
    }));
  };

  const [date, setDate] = useState(editingOrder?.date ?? new Date().toISOString().split('T')[0]);
  const [mealType, setMealType] = useState<MealType>(editingOrder?.meal_type ?? 'lunch');
  const [weekOfMonth, setWeekOfMonth] = useState<number | ''>(editingOrder?.week_of_month ?? '');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<SelectedItem[]>(initSelected);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showFixed, setShowFixed] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('orderPrintShowFixed') !== '0' : true
  );
  const supabase = useMemo(() => createClient(), []);

  const mainMeals = useMemo(() => meals.filter(m => m.type === mealType && !m.is_snack), [meals, mealType]);
  const snackMeals = useMemo(() => meals.filter(m => m.type === mealType && m.is_snack), [meals, mealType]);

  const filterMeals = (list: Meal[]) =>
    search.trim()
      ? list.filter(m => m.name.includes(search.trim()) || (m.english_name ?? '').toLowerCase().includes(search.toLowerCase()))
      : list;

  const selectedIds = selected.map(s => s.meal_id);

  const toggleMeal = (meal: Meal) => {
    if (selectedIds.includes(meal.id)) {
      setSelected(prev => prev.filter(s => s.meal_id !== meal.id));
      if (editingId === meal.id) setEditingId(null);
    } else {
      setSelected(prev => [...prev, { meal_id: meal.id, display_name: meal.name, extra_quantity: 0 }]);
    }
  };

  const handleTypeChange = (t: MealType) => {
    setMealType(t);
    setSelected([]);
    setSearch('');
  };

  const updateDisplayName = (meal_id: string, value: string) =>
    setSelected(prev => prev.map(s => s.meal_id === meal_id ? { ...s, display_name: value } : s));

  const beneficiaryCount = (meal_id: string) =>
    Math.max(0, totalBeneficiaries - (exclusionCounts[meal_id] ?? 0));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selected.length === 0) { setError('يرجى اختيار صنف واحد على الأقل'); return; }
    setSaving(true);
    setError('');

    if (!isEdit) {
      const { data: existing } = await supabase
        .from('daily_orders').select('id').eq('date', date).eq('meal_type', mealType).maybeSingle();
      if (existing) { setError('يوجد أمر تشغيل لهذا التاريخ ونوع الوجبة مسبقاً'); setSaving(false); return; }
    }

    const items = selected.map(s => ({
      meal_id: s.meal_id,
      display_name: s.display_name !== meals.find(m => m.id === s.meal_id)?.name ? s.display_name : null,
      extra_quantity: s.extra_quantity,
    }));

    const { data: rpcData, error: rpcErr } = await supabase.rpc('replace_order_items', {
      p_order_id: isEdit && editingOrder ? editingOrder.id : null,
      p_date: date,
      p_meal_type: mealType,
      p_week_of_month: weekOfMonth === '' ? null : weekOfMonth,
      p_items: items,
    });
    if (rpcErr) { setError(rpcErr.message); setSaving(false); return; }

    const orderId = isEdit && editingOrder ? editingOrder.id : (typeof rpcData === 'string' ? rpcData : null);
    await logActivity({
      action: isEdit ? 'update' : 'create',
      entity_type: 'order',
      entity_id: orderId,
      entity_name: `أمر تشغيل ${MEAL_TYPE_LABELS[mealType]} — ${date}`,
      details: {
        date,
        meal_type: mealType,
        week_of_month: weekOfMonth === '' ? null : weekOfMonth,
        items_count: items.length,
        items: selected.map(s => ({
          name: s.display_name,
          extra: s.extra_quantity,
        })),
      },
    });

    onSaved();
  };

  const MealChip = ({ meal, isSnack }: { meal: Meal; isSnack: boolean }) => {
    const active = selectedIds.includes(meal.id);
    const base = isSnack
      ? active ? 'bg-amber-500 text-white border-amber-500' : 'bg-white border-amber-200 text-amber-700 hover:bg-amber-50'
      : active ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50';
    return (
      <button
        type="button"
        onClick={() => toggleMeal(meal)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium transition-all ${base}`}
      >
        {active && (
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        )}
        {meal.name}
      </button>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[92vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <h2 className="text-lg font-bold text-slate-800">
            {isEdit ? 'تعديل أمر التشغيل' : 'إنشاء أمر تشغيل جديد'}
          </h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-lg">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="p-6 space-y-5 overflow-y-auto flex-1">

            {/* Date + type + week */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label">التاريخ *</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input-field" required />
              </div>
              <div>
                <label className="label">نوع الوجبة *</label>
                <select value={mealType} onChange={e => handleTypeChange(e.target.value as MealType)} className="input-field">
                  {Object.entries(MEAL_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="label">الأسبوع</label>
                <select
                  value={weekOfMonth}
                  onChange={e => setWeekOfMonth(e.target.value === '' ? '' : Number(e.target.value))}
                  className="input-field"
                >
                  <option value="">— بدون —</option>
                  <option value={1}>الأسبوع الأول</option>
                  <option value={2}>الأسبوع الثاني</option>
                  <option value={3}>الأسبوع الثالث</option>
                  <option value={4}>الأسبوع الرابع</option>
                </select>
              </div>
            </div>

            {/* Meal picker */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="label mb-0">اختر الأصناف</label>
                {selected.length > 0 && (
                  <span className="text-xs text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded-full">{selected.length} محدد</span>
                )}
              </div>

              <div className="relative">
                <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="ابحث عن صنف..."
                  className="input-field pr-10 py-2 text-sm"
                />
              </div>

              {mainMeals.length === 0 && snackMeals.length === 0 ? (
                <div className="border border-dashed border-slate-200 rounded-xl p-6 text-center text-slate-400 text-sm">
                  <p>لا توجد أصناف لوجبة {MEAL_TYPE_LABELS[mealType]}</p>
                  <p className="mt-1 text-xs">أضف أصناف من صفحة الأصناف أولاً</p>
                </div>
              ) : (
                <div className="border border-slate-200 rounded-xl p-4 space-y-4 max-h-52 overflow-y-auto">
                  {filterMeals(mainMeals).length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wide">أصناف {MEAL_TYPE_LABELS[mealType]}</p>
                      <div className="flex flex-wrap gap-2">
                        {filterMeals(mainMeals).map(m => <MealChip key={m.id} meal={m} isSnack={false} />)}
                      </div>
                    </div>
                  )}
                  {filterMeals(snackMeals).length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wide">سناكات {MEAL_TYPE_LABELS[mealType]}</p>
                      <div className="flex flex-wrap gap-2">
                        {filterMeals(snackMeals).map(m => <MealChip key={m.id} meal={m} isSnack={true} />)}
                      </div>
                    </div>
                  )}
                  {filterMeals(mainMeals).length === 0 && filterMeals(snackMeals).length === 0 && (
                    <p className="text-sm text-slate-400 text-center py-2">لا توجد نتائج للبحث</p>
                  )}
                </div>
              )}
            </div>

            {/* Selected items */}
            {selected.length > 0 && (
              <div className="space-y-2">
                <p className="label mb-0">تفاصيل الأصناف المختارة</p>
                <div className="space-y-2">
                  {selected.map(item => {
                    const meal = meals.find(m => m.id === item.meal_id);
                    if (!meal) return null;
                    const count = beneficiaryCount(item.meal_id);
                    const total = count + item.extra_quantity;
                    const isEditing = editingId === item.meal_id;
                    return (
                      <div key={item.meal_id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                        {/* Name section */}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-slate-400 mb-0.5">{meal.name}</p>
                          {isEditing ? (
                            <input
                              autoFocus
                              type="text"
                              value={item.display_name}
                              onChange={e => updateDisplayName(item.meal_id, e.target.value)}
                              onBlur={() => setEditingId(null)}
                              onKeyDown={e => e.key === 'Enter' && setEditingId(null)}
                              className="w-full text-sm font-semibold text-slate-800 bg-white border border-emerald-400 rounded-lg px-2 py-1 focus:outline-none"
                            />
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-semibold text-slate-800 truncate">{item.display_name}</span>
                              <button
                                type="button"
                                onClick={() => setEditingId(item.meal_id)}
                                className="p-0.5 text-slate-400 hover:text-blue-600 shrink-0"
                                title="تعديل الاسم"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Editable final quantity */}
                        <div className="shrink-0 text-center">
                          <div className="text-xs text-slate-500 mb-1">الكمية</div>
                          <input
                            type="number"
                            min={0}
                            value={total}
                            onChange={e => {
                              const n = parseInt(e.target.value);
                              if (!isNaN(n)) setSelected(prev => prev.map(s => s.meal_id === item.meal_id ? { ...s, extra_quantity: n - count } : s));
                            }}
                            className="w-16 text-center text-base font-bold text-emerald-700 border border-slate-200 rounded-lg py-1 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-200"
                          />
                        </div>

                        {/* Remove */}
                        <button type="button" onClick={() => toggleMeal(meal)}
                          className="shrink-0 w-7 h-7 flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Fixed items toggle */}
            <label className="flex items-center gap-2.5 cursor-pointer select-none py-2 px-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors">
              <input
                type="checkbox"
                checked={showFixed}
                onChange={e => {
                  setShowFixed(e.target.checked);
                  localStorage.setItem('orderPrintShowFixed', e.target.checked ? '1' : '0');
                }}
                className="w-4 h-4 accent-violet-600 cursor-pointer"
              />
              <span className="text-sm text-slate-700 font-medium">إظهار الأصناف الثابتة في أمر التشغيل</span>
            </label>

            {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}
          </div>

          {/* Footer */}
          <div className="flex gap-3 px-6 py-4 border-t border-slate-100 shrink-0">
            <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
              {saving ? (isEdit ? 'جاري الحفظ...' : 'جاري الإنشاء...') : (isEdit ? 'حفظ التعديلات' : 'إنشاء أمر التشغيل')}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">إلغاء</button>
          </div>
        </form>
      </div>
    </div>
  );
}
