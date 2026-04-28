'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase-client';
import { logActivity } from '@/lib/activity-log';
import { useCurrentUser } from '@/lib/use-current-user';
import { can } from '@/lib/permissions';
import type { Meal, MealType, ItemCategory, MenuItem, EntityType } from '@/lib/types';
import { ENTITY_TYPE_LABELS_PLURAL, ENTITY_BADGE_STYLES } from '@/lib/types';
import {
  WEEK_NUMBERS,
  WEEK_TITLES,
  MENU_DAYS,
  MEAL_SECTIONS,
  MAIN_ROWS_PER_MEAL,
  SNACK_ROWS_PER_MEAL,
  buildSlotMap,
  slotKey,
  type WeekNumber,
} from '@/lib/menu-utils';

interface CellEditState {
  week: WeekNumber;
  day: number;
  meal_type: MealType;
  isSnack: boolean; // true if this slot is the "snack" sub-row, false if main
  rowIndex: number; // 0-based index within the section
}

const CATEGORY_THEME: Record<ItemCategory, { icon: string; bg: string; text: string; ring: string }> = {
  hot:   { icon: '🔥', bg: 'bg-red-100',  text: 'text-red-700',   ring: 'ring-red-300' },
  cold:  { icon: '❄️', bg: 'bg-sky-100',  text: 'text-sky-700',   ring: 'ring-sky-300' },
  snack: { icon: '🍿', bg: 'bg-amber-100', text: 'text-amber-700', ring: 'ring-amber-300' },
};

export default function MenuView() {
  const supabase = useMemo(() => createClient(), []);
  const { user: currentUser } = useCurrentUser();
  const isAdmin = currentUser?.is_admin === true;
  const canEdit = can(currentUser, 'menu', 'edit');
  // الـtab بين منيو المستفيدين ومنيو المرافقين — يبقى بين الجلسات.
  const [entityType, setEntityType] = useState<EntityType>(() => {
    if (typeof window === 'undefined') return 'beneficiary';
    return (window.localStorage.getItem('menuEntityType') as EntityType | null) ?? 'beneficiary';
  });
  const [allItems, setAllItems] = useState<MenuItem[]>([]);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [activeWeek, setActiveWeek] = useState<WeekNumber>(1);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CellEditState | null>(null);
  const [importStatus, setImportStatus] = useState<'idle' | 'importing' | 'done' | 'error'>('idle');
  const [importMsg, setImportMsg] = useState('');
  const [search, setSearch] = useState('');
  const importRef = useRef<HTMLInputElement>(null);

  const switchEntity = useCallback((next: EntityType) => {
    setEntityType(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('menuEntityType', next);
    }
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    // نحاول الفلترة بـentity_type أولاً، ولو العمود ما موجود (الـmigration ما اتشغّل)
    // نرجع لجميع الصفوف. للمرافقين نظهر تنبيه.
    const tryFetchItems = async (withEntity: boolean, withMealCategory: boolean) => {
      const mealCols = `id, name, english_name, type, is_snack${withEntity ? ', entity_type' : ''}${withMealCategory ? ', category' : ''}`;
      const q = supabase
        .from('menu_items')
        .select(`id, week_number, day_of_week, meal_type, meal_id, category, position, multiplier${withEntity ? ', entity_type' : ''}, created_at, meals(${mealCols})`);
      return withEntity ? q.eq('entity_type', entityType) : q;
    };
    const tryFetchMeals = async (withEntity: boolean, withCategory: boolean) => {
      const cols = `id, name, english_name, type, is_snack${withEntity ? ', entity_type' : ''}${withCategory ? ', category' : ''}, created_at`;
      const q = supabase.from('meals').select(cols).order('name');
      return withEntity ? q.eq('entity_type', entityType) : q;
    };

    let itemsRes = await tryFetchItems(true, true);
    let mealsRes = await tryFetchMeals(true, true);

    // إذا meals.category ما موجود (الـmigration ما اتشغّل) أعد المحاولة بدونه
    if (itemsRes.error && /category|column/i.test(itemsRes.error.message)) {
      itemsRes = await tryFetchItems(true, false);
    }
    if (mealsRes.error && /category|column/i.test(mealsRes.error.message)) {
      mealsRes = await tryFetchMeals(true, false);
    }

    const entityMissing =
      (itemsRes.error && /entity_type|column/i.test(itemsRes.error.message)) ||
      (mealsRes.error && /entity_type|column/i.test(mealsRes.error.message));

    if (entityMissing) {
      if (entityType === 'companion') {
        alert(
          'صفحة قائمة المرافقين تحتاج تشغيل ملف الترقية:\n' +
          'supabase/companions-meals-migration.sql'
        );
        setAllItems([]);
        setMeals([]);
        setLoading(false);
        return;
      }
      [itemsRes, mealsRes] = await Promise.all([tryFetchItems(false, true), tryFetchMeals(false, true)]);
      if (itemsRes.error && /category|column/i.test(itemsRes.error.message)) {
        itemsRes = await tryFetchItems(false, false);
      }
      if (mealsRes.error && /category|column/i.test(mealsRes.error.message)) {
        mealsRes = await tryFetchMeals(false, false);
      }
    }

    if (itemsRes.data) setAllItems(itemsRes.data as unknown as MenuItem[]);
    if (mealsRes.data) setMeals(mealsRes.data as unknown as Meal[]);
    setLoading(false);
  }, [supabase, entityType]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const slotMap = useMemo(() => buildSlotMap(allItems), [allItems]);

  // For a given (week, day, meal_type) slot, return arrays of mains and snacks.
  const slotMainsAndSnacks = (week: WeekNumber, day: number, mealType: MealType) => {
    const items = slotMap.get(slotKey(week, day, mealType)) ?? [];
    const mains = items.filter(i => i.category !== 'snack');
    const snacks = items.filter(i => i.category === 'snack');
    return { mains, snacks };
  };

  const handleSetCell = async (
    week: WeekNumber, day: number, mealType: MealType,
    rowIndex: number, isSnack: boolean, mealId: string | null,
  ) => {
    // Find existing item at this position within the (mains or snacks) sub-list
    const { mains, snacks } = slotMainsAndSnacks(week, day, mealType);
    const list = isSnack ? snacks : mains;
    const existing = list[rowIndex] ?? null;

    if (mealId === null) {
      // Clear this position
      if (existing) {
        await supabase.from('menu_items').delete().eq('id', existing.id);
        void logActivity({
          action: 'delete',
          entity_type: 'meal',
          entity_id: existing.id,
          entity_name: `قائمة الطعام — ${WEEK_TITLES[week]} ${MENU_DAYS.find(d => d.value === day)?.label}`,
          details: { source: 'menu_clear' },
        });
      }
      await fetchData();
      return;
    }

    // If the meal is already in this slot at a different position, just delete the old position to avoid duplicate.
    const existingDuplicate = (slotMap.get(slotKey(week, day, mealType)) ?? []).find(i => i.meal_id === mealId);
    if (existingDuplicate && existing && existingDuplicate.id !== existing.id) {
      // Remove existing at this row first
      await supabase.from('menu_items').delete().eq('id', existing.id);
    }

    if (existing) {
      // Update row in place: change meal_id (keep category)
      await supabase
        .from('menu_items')
        .update({ meal_id: mealId })
        .eq('id', existing.id);
    } else {
      // Insert new — derive category and position
      const category: ItemCategory = isSnack ? 'snack' : 'hot';
      // position within full slot: snacks always after mains; we use a large offset for snacks
      const allInSlot = slotMap.get(slotKey(week, day, mealType)) ?? [];
      const baseOffset = isSnack ? 100 : 0;
      const position = baseOffset + rowIndex;

      // Avoid unique violation if the same meal already exists in this slot
      const dupSameMeal = allInSlot.find(i => i.meal_id === mealId);
      if (dupSameMeal) {
        await supabase.from('menu_items').delete().eq('id', dupSameMeal.id);
      }

      await supabase
        .from('menu_items')
        .insert({ week_number: week, day_of_week: day, meal_type: mealType, meal_id: mealId, category, position, entity_type: entityType });
    }

    void logActivity({
      action: existing ? 'update' : 'create',
      entity_type: 'meal',
      entity_name: `قائمة الطعام — ${WEEK_TITLES[week]} ${MENU_DAYS.find(d => d.value === day)?.label}`,
      details: { week, day, meal_type: mealType, source: 'menu_edit' },
    });

    await fetchData();
  };

  const handleSetMultiplier = async (item: MenuItem, value: number) => {
    const v = Math.max(1, Math.min(100, Math.floor(value) || 1));
    if (v === item.multiplier) return;
    // Optimistic update so the input stays responsive
    setAllItems(prev => prev.map(i => i.id === item.id ? { ...i, multiplier: v } : i));
    const { error } = await supabase.from('menu_items').update({ multiplier: v }).eq('id', item.id);
    if (error) {
      // Roll back on failure
      setAllItems(prev => prev.map(i => i.id === item.id ? { ...i, multiplier: item.multiplier } : i));
      // Most likely cause: column doesn't exist yet (migration not run)
      if (/multiplier|column/i.test(error.message)) {
        alert('عمود multiplier غير موجود — شغّل menu-multiplier-migration.sql في Supabase SQL Editor');
      }
      return;
    }
    void logActivity({
      action: 'update',
      entity_type: 'meal',
      entity_id: item.id,
      entity_name: `قائمة الطعام — ${WEEK_TITLES[item.week_number as WeekNumber]}`,
      details: { multiplier_to: v, source: 'menu_multiplier' },
    });
  };

  const handleClearWeek = async () => {
    if (!confirm(`حذف كل أصناف ${WEEK_TITLES[activeWeek]} (${ENTITY_TYPE_LABELS_PLURAL[entityType]})؟`)) return;
    // ⚠️ مهم: المسح مقيّد بـentity_type عشان ما نمسح منيو الفئة الأخرى بالخطأ.
    await supabase.from('menu_items').delete().eq('week_number', activeWeek).eq('entity_type', entityType);
    void logActivity({
      action: 'delete',
      entity_type: 'meal',
      entity_name: `قائمة الطعام — ${WEEK_TITLES[activeWeek]} — ${ENTITY_TYPE_LABELS_PLURAL[entityType]} (مسح كامل)`,
      details: { week: activeWeek, for_entity: entityType, source: 'menu_clear_week' },
    });
    await fetchData();
  };

  const handleExport = async () => {
    const { exportMenuXLSX } = await import('./menu-xlsx');
    await exportMenuXLSX(allItems, meals);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImportStatus('importing');
    setImportMsg('');
    try {
      const { importMenuXLSX } = await import('./menu-xlsx');
      const { rows, errors, weeks } = await importMenuXLSX(file, meals);

      if (rows.length === 0 && errors.length === 0) {
        setImportStatus('error');
        setImportMsg('لم يُعثر على أصناف صالحة في الملف');
        return;
      }

      // Replace data for each touched week atomically — scoped to current entity_type
      // عشان استيراد منيو المرافقين ما يمسح منيو المستفيدين والعكس.
      if (weeks.length > 0) {
        await supabase
          .from('menu_items')
          .delete()
          .in('week_number', weeks)
          .eq('entity_type', entityType);
      }
      if (rows.length > 0) {
        // نختم كل صف بـentity_type الحالي قبل الإدراج
        const stamped = rows.map(r => ({ ...r, entity_type: entityType }));
        const { error } = await supabase.from('menu_items').insert(stamped);
        if (error) throw error;
      }

      void logActivity({
        action: 'create',
        entity_type: 'meal',
        entity_name: `استيراد قائمة الطعام (${rows.length} صنف) — ${ENTITY_TYPE_LABELS_PLURAL[entityType]}`,
        details: { count: rows.length, errors_count: errors.length, for_entity: entityType, source: 'menu_xlsx_import' },
      });

      setImportStatus(errors.length > 0 ? 'error' : 'done');
      setImportMsg(
        `تم استيراد ${rows.length} صنف` +
        (errors.length ? ` — ${errors.length} خطأ: ${errors.slice(0, 5).join(' • ')}` : '')
      );
      await fetchData();
      if (errors.length === 0) setTimeout(() => setImportStatus('idle'), 4000);
    } catch (err) {
      setImportStatus('error');
      setImportMsg(`حدث خطأ أثناء الاستيراد: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Cell renderer: shows meal name (with category icon for mains) or "+ إضافة" placeholder
  const Cell = ({
    week, day, mealType, rowIndex, isSnack,
  }: { week: WeekNumber; day: number; mealType: MealType; rowIndex: number; isSnack: boolean }) => {
    const { mains, snacks } = slotMainsAndSnacks(week, day, mealType);
    const list = isSnack ? snacks : mains;
    const item = list[rowIndex] ?? null;

    if (!item) {
      // خلية فاضية: لو ما عند المستخدم صلاحية تعديل المنيو، تظهر فاضية ساكتة
      if (!canEdit) {
        return <div className="w-full h-full min-h-[34px]" />;
      }
      return (
        <button
          type="button"
          onClick={() => setEditing({ week, day, meal_type: mealType, isSnack, rowIndex })}
          className="w-full h-full min-h-[34px] text-slate-300 hover:text-emerald-600 hover:bg-emerald-50/40 text-xs font-medium transition-colors"
        >
          +
        </button>
      );
    }

    // الفئة من meals.category (المصدر الوحيد). للسناك تُعرض بدون تبديل.
    const mealCat = (item.meals as { category?: ItemCategory } | null)?.category;
    const effectiveCat: ItemCategory = mealCat ?? item.category ?? (item.meals?.is_snack ? 'snack' : 'hot');
    const theme = CATEGORY_THEME[effectiveCat];
    const mult = item.multiplier ?? 1;
    const q = search.trim().toLowerCase();
    const itemName = item.meals?.name ?? '';
    const itemEnglish = item.meals?.english_name ?? '';
    const matches = !q || itemName.toLowerCase().includes(q) || itemEnglish.toLowerCase().includes(q);
    const highlightCls = q
      ? matches
        ? 'bg-yellow-100 ring-2 ring-yellow-400'
        : 'opacity-25'
      : '';
    return (
      <div className={`flex items-center gap-1 px-2 py-1.5 group transition-all ${highlightCls}`}>
        {!isSnack && (
          <span
            title="الفئة تُؤخذ من الصنف نفسه — لتعديلها روح صفحة الأصناف"
            className={`shrink-0 text-sm leading-none w-5 h-5 flex items-center justify-center rounded ${theme.bg} ${theme.text}`}
          >
            {theme.icon}
          </span>
        )}
        {canEdit ? (
          <button
            type="button"
            onClick={() => setEditing({ week, day, meal_type: mealType, isSnack, rowIndex })}
            className="flex-1 text-right text-sm font-medium text-slate-800 hover:text-emerald-700 truncate"
            title="اضغط للتغيير"
          >
            {item.meals?.name ?? '—'}
          </button>
        ) : (
          <span
            className="flex-1 text-right text-sm font-medium text-slate-800 truncate"
            title="ما عندك صلاحية تعديل قائمة الطعام"
          >
            {item.meals?.name ?? '—'}
          </span>
        )}
        {canEdit ? (
          <input
            type="number"
            min={1}
            max={100}
            value={mult}
            onChange={e => handleSetMultiplier(item, parseInt(e.target.value) || 1)}
            onClick={e => e.stopPropagation()}
            title="مضاعف الكمية (×N)"
            className={`shrink-0 w-9 text-center text-xs font-bold rounded py-0.5 focus:outline-none focus:ring-1 ${
              mult > 1
                ? 'text-violet-700 bg-violet-50 border border-violet-300 focus:ring-violet-300'
                : 'text-slate-400 bg-transparent border border-transparent hover:border-slate-200 focus:ring-slate-300'
            }`}
          />
        ) : mult > 1 ? (
          <span className="shrink-0 w-9 text-center text-xs font-bold rounded py-0.5 text-violet-700 bg-violet-50 border border-violet-300">
            ×{mult}
          </span>
        ) : null}
        {canEdit && (
          <button
            type="button"
            onClick={() => handleSetCell(week, day, mealType, rowIndex, isSnack, null)}
            className="shrink-0 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 text-xs transition-opacity"
            title="حذف"
          >
            ✕
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">قائمة الطعام</h1>
            <p className="text-slate-500 text-sm mt-0.5">
              منيو ٤ أسابيع — ينعكس تلقائياً على أوامر التشغيل لنفس الفئة عند اختيار الأسبوع واليوم
            </p>
          </div>
          <span className={`badge ${ENTITY_BADGE_STYLES[entityType]}`}>
            {ENTITY_TYPE_LABELS_PLURAL[entityType]}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* الاستيراد والتصدير ومسح الأسبوع — للأدمن فقط */}
          {isAdmin && (
            <>
              <button onClick={handleExport} disabled={loading || allItems.length === 0} className="btn-secondary text-sm">
                تصدير Excel
              </button>
              <button
                onClick={() => importRef.current?.click()}
                disabled={importStatus === 'importing'}
                className="btn-secondary text-sm"
              >
                {importStatus === 'importing' ? 'جاري الاستيراد...' : 'استيراد Excel'}
              </button>
              <input
                ref={importRef}
                type="file"
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={handleImport}
              />
              <button onClick={handleClearWeek} className="btn-secondary text-sm text-red-600 hover:bg-red-50 border-red-200">
                مسح أصناف هذا الأسبوع
              </button>
            </>
          )}
        </div>
      </div>

      {/* Import message */}
      {(importStatus === 'done' || importStatus === 'error') && importMsg && (
        <div className={`px-4 py-2.5 rounded-lg text-sm font-medium ${importStatus === 'done' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
          {importMsg}
        </div>
      )}

      {/* Entity tabs: مستفيدين / مرافقين — كل منيو معزول عن الآخر */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        {(['beneficiary', 'companion'] as EntityType[]).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => switchEntity(t)}
            className={`px-5 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px ${
              entityType === t
                ? (t === 'beneficiary' ? 'border-emerald-500 text-emerald-700' : 'border-indigo-500 text-indigo-700')
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            منيو {ENTITY_TYPE_LABELS_PLURAL[t]}
          </button>
        ))}
      </div>

      {/* Week tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto">
        {WEEK_NUMBERS.map(w => (
          <button
            key={w}
            onClick={() => setActiveWeek(w)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px whitespace-nowrap ${
              activeWeek === w
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {WEEK_TITLES[w]}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="card p-3">
        <div className="relative">
          <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث عن صنف في المنيو…"
            className="input-field pr-9"
            dir="rtl"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm"
              title="مسح"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Menu Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-center">
            <thead>
              <tr className="bg-slate-50">
                {MENU_DAYS.map(d => (
                  <th key={d.value} className="border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700">
                    {d.label}
                  </th>
                ))}
                <th className="border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 w-20">
                  اليوم
                </th>
              </tr>
            </thead>
            <tbody>
              {MEAL_SECTIONS.flatMap(section => {
                const sectionTheme = section.meal_type === 'breakfast'
                  ? 'bg-yellow-50 text-yellow-800'
                  : section.meal_type === 'lunch'
                    ? 'bg-emerald-50 text-emerald-800'
                    : 'bg-rose-50 text-rose-800';

                return [
                  // Main rows (5)
                  ...Array.from({ length: MAIN_ROWS_PER_MEAL }, (_, rowIdx) => (
                    <tr key={`${section.meal_type}-main-${rowIdx}`} className="hover:bg-slate-50/40">
                      {MENU_DAYS.map(d => (
                        <td key={d.value} className="border border-slate-200 align-middle p-0">
                          <Cell week={activeWeek} day={d.value} mealType={section.meal_type} rowIndex={rowIdx} isSnack={false} />
                        </td>
                      ))}
                      {rowIdx === 0 && (
                        <td
                          rowSpan={MAIN_ROWS_PER_MEAL}
                          className={`border border-slate-200 align-middle font-bold text-sm w-20 ${sectionTheme}`}
                          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                        >
                          {section.label}
                        </td>
                      )}
                    </tr>
                  )),
                  // Snack rows (2) — yellow background
                  ...Array.from({ length: SNACK_ROWS_PER_MEAL }, (_, rowIdx) => (
                    <tr key={`${section.meal_type}-snack-${rowIdx}`} className="bg-amber-50/60">
                      {MENU_DAYS.map(d => (
                        <td key={d.value} className="border border-slate-200 align-middle p-0">
                          <Cell week={activeWeek} day={d.value} mealType={section.meal_type} rowIndex={rowIdx} isSnack={true} />
                        </td>
                      ))}
                      {rowIdx === 0 && (
                        <td
                          rowSpan={SNACK_ROWS_PER_MEAL}
                          className="border border-slate-200 align-middle font-bold text-sm w-20 bg-amber-100 text-amber-800"
                          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                        >
                          سناك
                        </td>
                      )}
                    </tr>
                  )),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <CellPickerModal
          editing={editing}
          meals={meals}
          existingMealIds={
            (slotMap.get(slotKey(editing.week, editing.day, editing.meal_type)) ?? [])
              .filter(i => (editing.isSnack ? i.category === 'snack' : i.category !== 'snack'))
              .map((i, idx) => idx === editing.rowIndex ? null : i.meal_id)
              .filter((x): x is string => !!x)
          }
          onClose={() => setEditing(null)}
          onPick={async (mealId) => {
            await handleSetCell(editing.week, editing.day, editing.meal_type, editing.rowIndex, editing.isSnack, mealId);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Cell Picker Modal ──────────────────────────────────────────────────────

function CellPickerModal({
  editing, meals, existingMealIds, onClose, onPick,
}: {
  editing: CellEditState;
  meals: Meal[];
  existingMealIds: string[];
  onClose: () => void;
  onPick: (mealId: string | null) => void;
}) {
  const [search, setSearch] = useState('');

  // Choose meals matching the slot's meal_type. For snack rows, only is_snack=true. For main rows, only is_snack=false.
  const candidates = useMemo(() => meals.filter(m =>
    m.type === editing.meal_type && m.is_snack === editing.isSnack,
  ), [meals, editing]);

  const filtered = candidates.filter(m =>
    !search.trim() ||
    m.name.includes(search.trim()) ||
    (m.english_name ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const dayLabel = MENU_DAYS.find(d => d.value === editing.day)?.label;
  const mealLabel = editing.meal_type === 'breakfast' ? 'الفطور' : editing.meal_type === 'lunch' ? 'الغداء' : 'العشاء';
  const sectionLabel = editing.isSnack ? 'سناك' : mealLabel;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h3 className="font-bold text-slate-800">اختر صنفاً</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {WEEK_TITLES[editing.week]} — {dayLabel} — {sectionLabel}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-lg">✕</button>
        </div>

        <div className="px-6 py-3 border-b border-slate-100">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="ابحث..."
            className="input-field text-sm py-2"
            autoFocus
          />
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {filtered.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">
              {candidates.length === 0
                ? `لا يوجد ${editing.isSnack ? 'سناكات' : 'أصناف'} ${mealLabel} — أضفها من صفحة الأصناف`
                : 'لا نتائج للبحث'}
            </p>
          ) : (
            <div className="space-y-1">
              {filtered.map(m => {
                const inUse = existingMealIds.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onPick(m.id)}
                    className={`w-full text-right px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                      inUse
                        ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                        : 'bg-white border-slate-200 text-slate-800 hover:bg-emerald-50 hover:border-emerald-300'
                    }`}
                    disabled={inUse}
                    title={inUse ? 'مستخدم في هذا اليوم بالفعل' : ''}
                  >
                    <span className="font-medium">{m.name}</span>
                    {m.english_name && <span className="text-xs text-slate-400 mr-2">({m.english_name})</span>}
                    {inUse && <span className="text-xs text-slate-400 mr-2">— مستخدم</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex justify-between">
          <button
            type="button"
            onClick={() => onPick(null)}
            className="px-3 py-1.5 text-xs font-semibold text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50"
          >
            مسح هذه الخانة
          </button>
          <button onClick={onClose} className="btn-secondary text-sm">إلغاء</button>
        </div>
      </div>
    </div>
  );
}
