'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase-client';
import { logActivity } from '@/lib/activity-log';
import type { DailyOrder, Meal, MealType, OrderItem, ItemCategory, MenuItem } from '@/lib/types';
import { MEAL_TYPE_LABELS, CATEGORY_LABELS, CATEGORY_ORDER } from '@/lib/types';
import { MENU_DAYS, WEEK_NUMBERS, WEEK_TITLES, type WeekNumber } from '@/lib/menu-utils';

interface SelectedItem {
  meal_id: string;
  display_name: string;
  extra_quantity: number;
  category: ItemCategory;
  multiplier: number;
}

interface Props {
  meals: Meal[];
  totalBeneficiaries: number;
  exclusionCounts: Record<string, number>;
  editingOrder?: DailyOrder | null;
  onClose: () => void;
  onSaved: () => void;
}

const CATEGORY_THEME: Record<ItemCategory, {
  icon: string;
  bg: string;
  textOn: string;
  bgChip: string;
  border: string;
  badge: string;
  ring: string;
}> = {
  hot:   { icon: '🔥', bg: 'bg-red-500',     textOn: 'text-white', bgChip: 'bg-red-50',     border: 'border-red-200',     badge: 'bg-red-100 text-red-700',     ring: 'ring-red-400' },
  cold:  { icon: '❄️', bg: 'bg-sky-500',     textOn: 'text-white', bgChip: 'bg-sky-50',     border: 'border-sky-200',     badge: 'bg-sky-100 text-sky-700',     ring: 'ring-sky-400' },
  snack: { icon: '🍿', bg: 'bg-amber-500',   textOn: 'text-white', bgChip: 'bg-amber-50',   border: 'border-amber-200',   badge: 'bg-amber-100 text-amber-700',   ring: 'ring-amber-400' },
};

export default function OrderModal({ meals, totalBeneficiaries, exclusionCounts, editingOrder, onClose, onSaved }: Props) {
  const isEdit = !!editingOrder;

  const initSelected = (): SelectedItem[] => {
    if (!editingOrder?.order_items) return [];
    return (editingOrder.order_items as OrderItem[]).map(item => ({
      meal_id: item.meal_id,
      display_name: item.display_name ?? item.meals?.name ?? '',
      extra_quantity: item.extra_quantity ?? 0,
      category: item.category ?? (item.meals?.is_snack ? 'snack' : 'hot'),
      multiplier: item.multiplier ?? 1,
    }));
  };

  const [date, setDate] = useState(editingOrder?.date ?? new Date().toISOString().split('T')[0]);
  const [mealType, setMealType] = useState<MealType>(editingOrder?.meal_type ?? 'lunch');
  const [weekNumber, setWeekNumber] = useState<WeekNumber | ''>(
    (editingOrder?.week_number ?? editingOrder?.week_of_month ?? '') as WeekNumber | ''
  );
  const [dayOfWeek, setDayOfWeek] = useState<number | ''>(
    editingOrder?.day_of_week ?? (editingOrder?.date ? new Date(editingOrder.date).getDay() : '')
  );
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<SelectedItem[]>(initSelected);
  const [activeCategory, setActiveCategory] = useState<ItemCategory>('hot');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showFixed, setShowFixed] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('orderPrintShowFixed') !== '0' : true
  );
  const [autoFilledKey, setAutoFilledKey] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);

  const mainMeals = useMemo(() => meals.filter(m => m.type === mealType && !m.is_snack), [meals, mealType]);
  const snackMeals = useMemo(() => meals.filter(m => m.type === mealType && m.is_snack), [meals, mealType]);

  const filterMeals = (list: Meal[]) =>
    search.trim()
      ? list.filter(m => m.name.includes(search.trim()) || (m.english_name ?? '').toLowerCase().includes(search.toLowerCase()))
      : list;

  const selectedByMealId = useMemo(() => {
    const map = new Map<string, SelectedItem>();
    for (const s of selected) map.set(s.meal_id, s);
    return map;
  }, [selected]);

  const itemsByCategory = (cat: ItemCategory) => selected.filter(s => s.category === cat);

  // Auto-fill from menu when (week, day, meal_type) changes — only for NEW orders
  // (preserves edits to existing orders).
  useEffect(() => {
    if (isEdit) return;
    if (weekNumber === '' || dayOfWeek === '') return;
    const key = `${weekNumber}|${dayOfWeek}|${mealType}`;
    if (key === autoFilledKey) return;

    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('menu_items')
        .select('meal_id, category, position, multiplier, meals(id, name, is_snack)')
        .eq('week_number', weekNumber)
        .eq('day_of_week', dayOfWeek)
        .eq('meal_type', mealType);
      if (cancelled) return;

      const items = (data as unknown as MenuItem[] | null) ?? [];
      // Sort: hot, cold, snack — then position
      const sorted = items.sort((a, b) => {
        const r = (c: ItemCategory) => c === 'hot' ? 0 : c === 'cold' ? 1 : 2;
        if (a.category !== b.category) return r(a.category) - r(b.category);
        return a.position - b.position;
      });

      setSelected(sorted.map(it => ({
        meal_id: it.meal_id,
        display_name: it.meals?.name ?? '',
        extra_quantity: 0,
        category: it.category,
        multiplier: it.multiplier ?? 1,
      })));
      setAutoFilledKey(key);
    })();

    return () => { cancelled = true; };
  }, [isEdit, weekNumber, dayOfWeek, mealType, supabase, autoFilledKey]);

  const handleTypeChange = (t: MealType) => {
    setMealType(t);
    if (!isEdit) setSelected([]);
    setSearch('');
  };

  const refillFromMenu = async () => {
    if (weekNumber === '' || dayOfWeek === '') {
      setError('اختر رقم الأسبوع واليوم أولاً');
      return;
    }
    if (selected.length > 0 && !confirm('سيتم استبدال الأصناف الحالية بأصناف المنيو لهذا اليوم. تأكيد؟')) return;
    const { data } = await supabase
      .from('menu_items')
      .select('meal_id, category, position, meals(id, name, is_snack)')
      .eq('week_number', weekNumber)
      .eq('day_of_week', dayOfWeek)
      .eq('meal_type', mealType);
    const items = (data as unknown as MenuItem[] | null) ?? [];
    const sorted = items.sort((a, b) => {
      const r = (c: ItemCategory) => c === 'hot' ? 0 : c === 'cold' ? 1 : 2;
      if (a.category !== b.category) return r(a.category) - r(b.category);
      return a.position - b.position;
    });
    setSelected(sorted.map(it => ({
      meal_id: it.meal_id,
      display_name: it.meals?.name ?? '',
      extra_quantity: 0,
      category: it.category,
      multiplier: it.multiplier ?? 1,
    })));
  };

  const toggleMeal = (meal: Meal) => {
    setSelected(prev => {
      const existing = prev.find(s => s.meal_id === meal.id);
      if (existing) {
        if (existing.category === activeCategory) {
          if (editingId === meal.id) setEditingId(null);
          return prev.filter(s => s.meal_id !== meal.id);
        }
        return prev.map(s => s.meal_id === meal.id ? { ...s, category: activeCategory } : s);
      }
      return [...prev, { meal_id: meal.id, display_name: meal.name, extra_quantity: 0, category: activeCategory, multiplier: 1 }];
    });
  };

  const removeItem = (meal_id: string) => {
    setSelected(prev => prev.filter(s => s.meal_id !== meal_id));
    if (editingId === meal_id) setEditingId(null);
  };

  const updateDisplayName = (meal_id: string, value: string) =>
    setSelected(prev => prev.map(s => s.meal_id === meal_id ? { ...s, display_name: value } : s));

  const setItemCategory = (meal_id: string, category: ItemCategory) =>
    setSelected(prev => prev.map(s => s.meal_id === meal_id ? { ...s, category } : s));

  const setItemMultiplier = (meal_id: string, multiplier: number) =>
    setSelected(prev => prev.map(s => s.meal_id === meal_id ? { ...s, multiplier: Math.max(1, Math.min(100, multiplier || 1)) } : s));

  const beneficiaryCount = (meal_id: string) =>
    Math.max(0, totalBeneficiaries - (exclusionCounts[meal_id] ?? 0));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selected.length === 0) { setError('يرجى اختيار صنف واحد على الأقل'); return; }
    if (weekNumber === '') { setError('اختر رقم الأسبوع'); return; }
    if (dayOfWeek === '') { setError('اختر اليوم'); return; }
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
      category: s.category,
      multiplier: s.multiplier,
    }));

    const { data: rpcData, error: rpcErr } = await supabase.rpc('replace_order_items', {
      p_order_id: isEdit && editingOrder ? editingOrder.id : null,
      p_date: date,
      p_meal_type: mealType,
      p_week_number: weekNumber,
      p_day_of_week: dayOfWeek,
      p_items: items,
    });
    if (rpcErr) { setError(rpcErr.message); setSaving(false); return; }

    const rpcOrderId = rpcData && typeof rpcData === 'object' && 'order_id' in rpcData
      ? (rpcData as { order_id: string }).order_id
      : null;
    const orderId = isEdit && editingOrder ? editingOrder.id : rpcOrderId;

    if (orderId) {
      try {
        const snapRes = await fetch(`/api/orders/${orderId}/snapshot`, { method: 'POST' });
        if (!snapRes.ok) {
          const j = await snapRes.json().catch(() => ({}));
          if (j?.reason === 'migration_required') {
            alert(
              'تنبيه: تم حفظ أمر التشغيل لكن لم يتم تجميد الإحصاءات.\n\n' +
              'السبب: عمود snapshot غير موجود في قاعدة البيانات.\n\n' +
              'الحل: شغّل ملف supabase/order-snapshot-migration.sql في Supabase SQL Editor.'
            );
          } else if (process.env.NODE_ENV !== 'production') {
            console.warn('Snapshot save failed:', j);
          }
        }
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') console.warn('Snapshot request errored:', err);
      }
    }

    void logActivity({
      action: isEdit ? 'update' : 'create',
      entity_type: 'order',
      entity_id: orderId,
      entity_name: `أمر تشغيل ${MEAL_TYPE_LABELS[mealType]} — ${date}`,
      details: {
        date,
        meal_type: mealType,
        week_number: weekNumber,
        day_of_week: dayOfWeek,
        items_count: items.length,
        items_by_category: {
          hot:   items.filter(i => i.category === 'hot').length,
          cold:  items.filter(i => i.category === 'cold').length,
          snack: items.filter(i => i.category === 'snack').length,
        },
      },
    });

    onSaved();
  };

  const MealChip = ({ meal }: { meal: Meal }) => {
    const sel = selectedByMealId.get(meal.id);
    const inActive = sel?.category === activeCategory;
    const inOther = sel && sel.category !== activeCategory;
    const activeTheme = CATEGORY_THEME[activeCategory];
    const otherTheme = inOther ? CATEGORY_THEME[sel.category] : null;

    let cls = '';
    if (inActive) {
      cls = `${activeTheme.bg} ${activeTheme.textOn} border-transparent shadow-sm`;
    } else if (inOther && otherTheme) {
      cls = `bg-white border-2 ${otherTheme.border} text-slate-700`;
    } else {
      cls = 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50';
    }

    return (
      <button
        type="button"
        onClick={() => toggleMeal(meal)}
        title={inOther && otherTheme ? `حالياً في ${CATEGORY_LABELS[sel.category]} — اضغط للنقل إلى ${CATEGORY_LABELS[activeCategory]}` : undefined}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${cls}`}
      >
        {inActive && (
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        )}
        {inOther && otherTheme && (
          <span className="text-base leading-none" title={CATEGORY_LABELS[sel.category]}>{otherTheme.icon}</span>
        )}
        {meal.name}
      </button>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <h2 className="text-lg font-bold text-slate-800">
            {isEdit ? 'تعديل أمر التشغيل' : 'إنشاء أمر تشغيل جديد'}
          </h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-lg">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="p-6 space-y-5 overflow-y-auto flex-1">

            {/* Week + Day + Meal type */}
            <div>
              <label className="label">الأسبوع واليوم — يحدد المنيو والمستفيدين <span className="text-red-500">*</span></label>
              <div className="grid grid-cols-3 gap-3 mt-1">
                <select value={weekNumber} onChange={e => setWeekNumber(e.target.value === '' ? '' : Number(e.target.value) as WeekNumber)} className="input-field" required>
                  <option value="">— الأسبوع —</option>
                  {WEEK_NUMBERS.map(w => <option key={w} value={w}>{WEEK_TITLES[w]}</option>)}
                </select>
                <select value={dayOfWeek} onChange={e => setDayOfWeek(e.target.value === '' ? '' : Number(e.target.value))} className="input-field" required>
                  <option value="">— اليوم —</option>
                  {MENU_DAYS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
                <select value={mealType} onChange={e => handleTypeChange(e.target.value as MealType)} className="input-field" required>
                  {Object.entries(MEAL_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            </div>

            {/* Date — informational only */}
            <div>
              <label className="label">التاريخ <span className="text-xs text-slate-400 font-normal">(تعريفي فقط — لا يؤثر على المستفيدين)</span></label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input-field" required />
            </div>

            {isEdit && (
              <button
                type="button"
                onClick={refillFromMenu}
                className="text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 hover:bg-emerald-100 transition-colors"
              >
                ↺ إعادة تعبئة من المنيو
              </button>
            )}

            {/* Active category picker */}
            <div className="space-y-2">
              <label className="label mb-0">القسم النشط للاختيار</label>
              <div className="grid grid-cols-3 gap-2">
                {CATEGORY_ORDER.map(cat => {
                  const t = CATEGORY_THEME[cat];
                  const count = itemsByCategory(cat).length;
                  const active = cat === activeCategory;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setActiveCategory(cat)}
                      className={`flex items-center justify-center gap-2 py-3 rounded-xl border-2 font-bold text-sm transition-all ${
                        active
                          ? `${t.bg} ${t.textOn} border-transparent shadow-md`
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <span className="text-lg leading-none">{t.icon}</span>
                      <span>{CATEGORY_LABELS[cat]}</span>
                      {count > 0 && (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          active ? 'bg-white/20 text-white' : t.badge
                        }`}>
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Meal picker */}
            <div className="space-y-3">
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
                </div>
              ) : (
                <div className="border border-slate-200 rounded-xl p-4 space-y-4 max-h-64 overflow-y-auto">
                  {filterMeals(mainMeals).length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wide">
                        أصناف {MEAL_TYPE_LABELS[mealType]}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {filterMeals(mainMeals).map(m => <MealChip key={m.id} meal={m} />)}
                      </div>
                    </div>
                  )}
                  {filterMeals(snackMeals).length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-slate-100">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wide">
                        سناكات {MEAL_TYPE_LABELS[mealType]}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {filterMeals(snackMeals).map(m => <MealChip key={m.id} meal={m} />)}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Selected items */}
            {selected.length > 0 && (
              <div className="space-y-2">
                <p className="label mb-0">تفاصيل الكميات</p>
                <div className="space-y-2">
                  {CATEGORY_ORDER.flatMap(cat => itemsByCategory(cat)).map(item => {
                    const meal = meals.find(m => m.id === item.meal_id);
                    if (!meal) return null;
                    const count = beneficiaryCount(item.meal_id);
                    // total = (people who get it) × multiplier + manual offset
                    const baseAfterMultiplier = count * item.multiplier;
                    const total = baseAfterMultiplier + item.extra_quantity;
                    const isEditing = editingId === item.meal_id;
                    const theme = CATEGORY_THEME[item.category];
                    return (
                      <div key={item.meal_id} className={`flex items-center gap-3 p-3 rounded-xl border ${theme.border} ${theme.bgChip}`}>
                        <span className={`text-xs font-bold px-2 py-1 rounded-md shrink-0 ${theme.badge}`}>
                          {theme.icon} {CATEGORY_LABELS[item.category]}
                        </span>

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

                        <div className="hidden md:flex items-center gap-0.5 shrink-0">
                          {CATEGORY_ORDER.map(cat => {
                            const tt = CATEGORY_THEME[cat];
                            const active = item.category === cat;
                            return (
                              <button
                                key={cat}
                                type="button"
                                onClick={() => setItemCategory(item.meal_id, cat)}
                                title={CATEGORY_LABELS[cat]}
                                className={`w-7 h-7 text-base rounded-md transition-all ${
                                  active ? `${tt.bg} ${tt.textOn} shadow-sm` : 'bg-white text-slate-400 hover:bg-slate-100'
                                }`}
                              >
                                {tt.icon}
                              </button>
                            );
                          })}
                        </div>

                        <div className="shrink-0 text-center" title="مضاعف الكمية لكل مستفيد (مثلاً ٢ للخبز)">
                          <div className="text-xs text-slate-500 mb-1">×</div>
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={item.multiplier}
                            onChange={e => setItemMultiplier(item.meal_id, parseInt(e.target.value) || 1)}
                            className={`w-12 text-center text-sm font-bold rounded-lg py-1 focus:outline-none focus:ring-1 ${
                              item.multiplier > 1
                                ? 'text-violet-700 border border-violet-300 bg-violet-50 focus:border-violet-400 focus:ring-violet-200'
                                : 'text-slate-500 border border-slate-200 focus:border-slate-400 focus:ring-slate-200'
                            }`}
                          />
                        </div>

                        <div className="shrink-0 text-center">
                          <div className="text-xs text-slate-500 mb-1">الكمية</div>
                          <input
                            type="number"
                            min={0}
                            value={total}
                            onChange={e => {
                              const n = parseInt(e.target.value);
                              if (!isNaN(n)) setSelected(prev => prev.map(s => s.meal_id === item.meal_id ? { ...s, extra_quantity: n - baseAfterMultiplier } : s));
                            }}
                            className="w-16 text-center text-base font-bold text-emerald-700 border border-slate-200 rounded-lg py-1 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-200"
                          />
                        </div>

                        <button type="button" onClick={() => removeItem(item.meal_id)}
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
