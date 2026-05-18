'use client';

import { useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase-client';
import { logActivity } from '@/lib/activity-log';
import type { Meal, MealType, ItemCategory, EntityType } from '@/lib/types';
import { MEAL_TYPE_LABELS, ENTITY_TYPE_LABELS_PLURAL, ENTITY_BADGE_STYLES } from '@/lib/types';
import { MENU_DAYS, WEEK_NUMBERS, WEEK_TITLES, type WeekNumber } from '@/lib/menu-utils';

// ترتيب أيام الأسبوع في المنيو: سبت، أحد، إثنين، ثلاثاء، أربعاء، خميس، جمعة
const DAY_ORDER = MENU_DAYS.map(d => d.value); // [6, 0, 1, 2, 3, 4, 5]

function slotIndex(week: number, day: number) {
  return (week - 1) * 7 + DAY_ORDER.indexOf(day);
}

function slotAt(index: number): { week: WeekNumber; day: number } {
  return {
    week: (Math.floor(index / 7) + 1) as WeekNumber,
    day: DAY_ORDER[index % 7],
  };
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

interface Props {
  meals: Meal[];
  entityType: EntityType;
  onClose: () => void;
  onSaved: () => void;
}

interface ProgressState {
  done: number;
  total: number;
  created: number;
  skipped: number;
}

export default function BulkOrderModal({ meals, entityType, onClose, onSaved }: Props) {
  const [fromWeek, setFromWeek] = useState<WeekNumber | ''>('');
  const [fromDay, setFromDay] = useState<number | ''>('');
  const [toWeek, setToWeek] = useState<WeekNumber | ''>('');
  const [toDay, setToDay] = useState<number | ''>('');
  const [mealType, setMealType] = useState<MealType>('lunch');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [error, setError] = useState('');
  const [finished, setFinished] = useState(false);

  const slots = useMemo(() => {
    if (fromWeek === '' || fromDay === '' || toWeek === '' || toDay === '') return [];
    const start = slotIndex(fromWeek as WeekNumber, fromDay as number);
    const end = slotIndex(toWeek as WeekNumber, toDay as number);
    if (end < start) return [];
    return Array.from({ length: end - start + 1 }, (_, i) => ({
      ...slotAt(start + i),
      date: addDays(startDate, i),
    }));
  }, [fromWeek, fromDay, toWeek, toDay, startDate]);

  const endDate = slots.length > 0 ? slots[slots.length - 1].date : null;

  const rangeValid =
    fromWeek !== '' && fromDay !== '' && toWeek !== '' && toDay !== '' &&
    slotIndex(fromWeek as WeekNumber, fromDay as number) <= slotIndex(toWeek as WeekNumber, toDay as number);

  const handleCreate = async () => {
    if (slots.length === 0 || !startDate) return;
    setCreating(true);
    setError('');
    setProgress({ done: 0, total: slots.length, created: 0, skipped: 0 });

    // جلب كل عناصر المنيو للأسابيع المطلوبة دفعة واحدة
    const neededWeeks = [...new Set(slots.map(s => s.week))];
    const baseSelect = 'meal_id, week_number, day_of_week, meal_type, category, position, multiplier, extra_quantity, meals(id, name, is_snack)';

    const tryFetchMenu = async (withEntity: boolean) => {
      const q = supabase
        .from('menu_items')
        .select(baseSelect)
        .in('week_number', neededWeeks)
        .eq('meal_type', mealType);
      return withEntity ? q.eq('entity_type', entityType) : q;
    };

    let menuRes = await tryFetchMenu(true);
    if (menuRes.error && /entity_type|column/i.test(menuRes.error.message)) {
      menuRes = await tryFetchMenu(false);
    }

    // خريطة: `${week}|${day}` ← عناصر المنيو
    type RawItem = {
      meal_id: string;
      week_number: number;
      day_of_week: number;
      meal_type: string;
      category: ItemCategory;
      position: number;
      multiplier: number;
      extra_quantity?: number;
      meals?: { id: string; name: string; is_snack?: boolean } | null;
    };
    const menuItems = (menuRes.data ?? []) as unknown as RawItem[];
    const slotMap = new Map<string, RawItem[]>();
    for (const item of menuItems) {
      const key = `${item.week_number}|${item.day_of_week}`;
      const list = slotMap.get(key) ?? [];
      list.push(item);
      slotMap.set(key, list);
    }

    let useLegacyRpc = false;
    let created = 0;
    let skipped = 0;

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const key = `${slot.week}|${slot.day}`;
      const items = slotMap.get(key) ?? [];

      if (items.length === 0) {
        skipped++;
        setProgress(p => p ? { ...p, done: i + 1, skipped: p.skipped + 1 } : null);
        continue;
      }

      const orderItems = items.map(it => {
        const fullMeal = meals.find(m => m.id === it.meal_id);
        const cat: ItemCategory =
          (fullMeal?.category as ItemCategory | undefined) ??
          (it.category as ItemCategory | undefined) ??
          (fullMeal?.is_snack || it.meals?.is_snack ? 'snack' : 'hot');
        return {
          meal_id: it.meal_id,
          display_name: null as string | null,
          extra_quantity: it.extra_quantity ?? 0,
          category: cat,
          multiplier: it.multiplier ?? 1,
        };
      });

      const baseParams = {
        p_order_id: null,
        p_date: slot.date,
        p_meal_type: mealType,
        p_week_number: slot.week,
        p_day_of_week: slot.day,
        p_items: orderItems,
      };

      let result = useLegacyRpc
        ? await supabase.rpc('replace_order_items', baseParams)
        : await supabase.rpc('replace_order_items', { ...baseParams, p_entity_type: entityType });

      if (!useLegacyRpc && result.error && /p_entity_type|argument|function .* does not exist|does not exist/i.test(result.error.message)) {
        if (entityType === 'companion') {
          setError('لا يمكن إنشاء أوامر للمرافقين قبل تشغيل ملف الترقية: supabase/companions-migration.sql');
          setCreating(false);
          return;
        }
        useLegacyRpc = true;
        result = await supabase.rpc('replace_order_items', baseParams);
      }

      if (result.error) {
        skipped++;
        setProgress(p => p ? { ...p, done: i + 1, skipped: p.skipped + 1 } : null);
      } else {
        const orderId = (result.data as { order_id?: string } | null)?.order_id;
        if (orderId) {
          await fetch(`/api/orders/${orderId}/snapshot`, { method: 'POST' }).catch(() => {});
        }
        created++;
        setProgress(p => p ? { ...p, done: i + 1, created: p.created + 1 } : null);
      }
    }

    void logActivity({
      action: 'create',
      entity_type: 'order',
      entity_id: null,
      entity_name: `إنشاء بكج أوامر تشغيل — ${MEAL_TYPE_LABELS[mealType]} (${created} أمر)`,
      details: { entity_type: entityType, meal_type: mealType, created, skipped, start_date: startDate, end_date: endDate },
    });

    setCreating(false);
    setFinished(true);
    if (created > 0) onSaved();
  };

  const progressPct = progress ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-slate-800">إنشاء بكج أوامر تشغيل</h2>
            <span className={`badge ${ENTITY_BADGE_STYLES[entityType]}`}>
              {ENTITY_TYPE_LABELS_PLURAL[entityType]}
            </span>
          </div>
          {!creating && (
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-lg">✕</button>
          )}
        </div>

        <div className="p-6 space-y-5">

          {/* إذا انتهى الإنشاء */}
          {finished && progress && (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-3 py-4">
                <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center text-3xl">
                  ✓
                </div>
                <p className="text-lg font-bold text-slate-800">اكتمل الإنشاء</p>
                <div className="flex gap-4 text-center">
                  <div className="px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-xl">
                    <p className="text-2xl font-bold text-emerald-700">{progress.created}</p>
                    <p className="text-xs text-emerald-600 mt-0.5">أمر تم إنشاؤه</p>
                  </div>
                  {progress.skipped > 0 && (
                    <div className="px-4 py-2 bg-amber-50 border border-amber-200 rounded-xl">
                      <p className="text-2xl font-bold text-amber-700">{progress.skipped}</p>
                      <p className="text-xs text-amber-600 mt-0.5">تم تجاوزه</p>
                    </div>
                  )}
                </div>
                {progress.skipped > 0 && (
                  <p className="text-xs text-slate-400 text-center">
                    الأوامر المتجاوزة: موجودة مسبقاً أو لا يوجد منيو لها
                  </p>
                )}
              </div>
              <button onClick={onClose} className="btn-primary w-full justify-center">إغلاق</button>
            </div>
          )}

          {/* أثناء الإنشاء */}
          {creating && progress && (
            <div className="space-y-4 py-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600 font-medium">جاري إنشاء أوامر التشغيل...</span>
                <span className="text-slate-500">{progress.done} / {progress.total}</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-emerald-500 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="flex gap-3 text-sm">
                <span className="text-emerald-700 font-semibold">{progress.created} تم إنشاؤه</span>
                {progress.skipped > 0 && (
                  <span className="text-amber-600">{progress.skipped} تم تجاوزه</span>
                )}
              </div>
            </div>
          )}

          {/* الفورم */}
          {!creating && !finished && (
            <>
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                  {error}
                </div>
              )}

              {/* نوع الوجبة */}
              <div>
                <label className="label">نوع الوجبة <span className="text-red-500">*</span></label>
                <select value={mealType} onChange={e => setMealType(e.target.value as MealType)} className="input-field mt-1">
                  {Object.entries(MEAL_TYPE_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>

              {/* من */}
              <div>
                <label className="label">من <span className="text-red-500">*</span></label>
                <div className="grid grid-cols-2 gap-3 mt-1">
                  <select
                    value={fromWeek}
                    onChange={e => setFromWeek(e.target.value === '' ? '' : Number(e.target.value) as WeekNumber)}
                    className="input-field"
                  >
                    <option value="">— الأسبوع —</option>
                    {WEEK_NUMBERS.map(w => <option key={w} value={w}>{WEEK_TITLES[w]}</option>)}
                  </select>
                  <select
                    value={fromDay}
                    onChange={e => setFromDay(e.target.value === '' ? '' : Number(e.target.value))}
                    className="input-field"
                  >
                    <option value="">— اليوم —</option>
                    {MENU_DAYS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select>
                </div>
              </div>

              {/* إلى */}
              <div>
                <label className="label">إلى <span className="text-red-500">*</span></label>
                <div className="grid grid-cols-2 gap-3 mt-1">
                  <select
                    value={toWeek}
                    onChange={e => setToWeek(e.target.value === '' ? '' : Number(e.target.value) as WeekNumber)}
                    className="input-field"
                  >
                    <option value="">— الأسبوع —</option>
                    {WEEK_NUMBERS.map(w => <option key={w} value={w}>{WEEK_TITLES[w]}</option>)}
                  </select>
                  <select
                    value={toDay}
                    onChange={e => setToDay(e.target.value === '' ? '' : Number(e.target.value))}
                    className="input-field"
                  >
                    <option value="">— اليوم —</option>
                    {MENU_DAYS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select>
                </div>
                {fromWeek !== '' && fromDay !== '' && toWeek !== '' && toDay !== '' && !rangeValid && (
                  <p className="text-xs text-red-500 mt-1">تاريخ البداية يجب أن يكون قبل تاريخ النهاية</p>
                )}
              </div>

              {/* تاريخ البداية الفعلي */}
              <div>
                <label className="label">
                  تاريخ بداية الأوامر <span className="text-red-500">*</span>
                  <span className="text-xs text-slate-400 font-normal mr-1">(التاريخ الفعلي لأول يوم)</span>
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="input-field mt-1"
                />
              </div>

              {/* معاينة */}
              {slots.length > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm">
                  <p className="font-semibold text-emerald-800">
                    سيتم إنشاء <span className="text-emerald-700">{slots.length}</span> أمر تشغيل
                  </p>
                  <p className="text-emerald-600 mt-0.5 text-xs">
                    من {startDate} إلى {endDate} — {MEAL_TYPE_LABELS[mealType]}
                  </p>
                </div>
              )}

              {/* أزرار */}
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={slots.length === 0 || !startDate || !rangeValid}
                  className="btn-primary flex-1 justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  إنشاء {slots.length > 0 ? `${slots.length} أوامر` : 'الأوامر'}
                </button>
                <button type="button" onClick={onClose} className="btn-secondary">إلغاء</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
