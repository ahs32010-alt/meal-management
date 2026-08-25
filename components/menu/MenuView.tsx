'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase-client';
import { fetchInactiveBeneficiaryIds } from '@/lib/inactive-beneficiaries';
import { fetchAllRows } from '@/lib/fetch-all';
import { logActivity } from '@/lib/activity-log';
import { changeDetails } from '@/lib/activity-diff';
import { useCurrentUser } from '@/lib/use-current-user';
import { can, needsApproval } from '@/lib/permissions';
import { enqueueGenericCreate, enqueueGenericUpdate, enqueueGenericDelete } from '@/lib/pending-actions';
import { useMyPending } from '@/lib/use-my-pending';
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
  splitSlot,
  normalizeSlot,
  effectiveCategory,
  mainPosition,
  snackPosition,
  positionRowIndex,
  isSnackPosition,
  type WeekNumber,
} from '@/lib/menu-utils';
import { applyMenuImport } from '@/lib/menu-import';
import ImportModeDialog, { type ImportMode } from '@/components/shared/ImportModeDialog';

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

// ─── Cell ───────────────────────────────────────────────────────────────────
// Defined OUTSIDE MenuView so its function reference is stable across re-renders.
// If defined inline, React unmounts/remounts it on every parent state change,
// losing input focus and any in-progress typed value.

interface CellProps {
  item: MenuItem | null;
  pendingCreate: { mealId: string; multiplier: number } | null;
  mealsById: Map<string, Meal>;
  benTotal: number;
  benExclusions: Record<string, number>;
  /** هل اكتملت قراءة المستفيدين والمحظورات؟ العدد المكتوب يُحفظ كفرق عن العدد
   *  المحسوب، فلو حُفظ قبل وصول البيانات يصير الفرق خاطئاً ويقفز العدد لاحقاً. */
  benReady: boolean;
  search: string;
  canEdit: boolean;
  isSnack: boolean;
  hasPendingDelete: boolean;
  hasPendingUpdate: boolean;
  onEdit: () => void;
  onClear: () => void;
  onSetMultiplier: (item: MenuItem, value: number) => void;
  onSetExtraQty: (item: MenuItem, value: number) => void;
}

function Cell({
  item, pendingCreate, mealsById, benTotal, benExclusions, benReady,
  search, canEdit, isSnack,
  hasPendingDelete, hasPendingUpdate,
  onEdit, onClear, onSetMultiplier, onSetExtraQty,
}: CellProps) {
  const [countDraft, setCountDraft] = useState<string | null>(null);

  if (!item) {
    if (pendingCreate) {
      const pcMeal = mealsById.get(pendingCreate.mealId);
      const pcCat: ItemCategory = pcMeal?.category ?? (isSnack ? 'snack' : 'hot');
      const pcTheme = CATEGORY_THEME[pcCat];
      const pcMult = pendingCreate.multiplier;
      return (
        <div className="flex items-center gap-1 px-2 py-1.5" title="بانتظار موافقة الأدمن">
          {!isSnack && (
            <span className={`shrink-0 text-sm leading-none w-5 h-5 flex items-center justify-center rounded ${pcTheme.bg} ${pcTheme.text} opacity-60`}>
              {pcTheme.icon}
            </span>
          )}
          <span className="flex-1 text-right text-sm font-medium text-slate-400 truncate">{pcMeal?.name ?? '—'}</span>
          <span className="shrink-0 text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1 leading-tight">⏳</span>
          {pcMult > 1 && (
            <span className="shrink-0 w-9 text-center text-xs font-bold rounded py-0.5 text-violet-400 bg-violet-50/50 border border-violet-200">×{pcMult}</span>
          )}
        </div>
      );
    }
    if (!canEdit) return <div className="w-full h-full min-h-[34px]" />;
    return (
      <button
        type="button"
        onClick={onEdit}
        className="w-full h-full min-h-[34px] text-slate-300 hover:text-emerald-600 hover:bg-emerald-50/40 text-xs font-medium transition-colors"
      >
        +
      </button>
    );
  }

  const theme = CATEGORY_THEME[effectiveCategory(item)];
  const mult = item.multiplier ?? 1;
  const extraQty = item.extra_quantity ?? 0;
  const directCount = Math.max(0, benTotal - (benExclusions[item.meal_id] ?? 0));
  const totalCount = directCount * mult + extraQty;
  const hasBenData = benTotal > 0;
  const q = search.trim().toLowerCase();
  const matches = !q || (item.meals?.name ?? '').toLowerCase().includes(q) || (item.meals?.english_name ?? '').toLowerCase().includes(q);
  const highlightCls = q ? (matches ? 'bg-yellow-100 ring-2 ring-yellow-400' : 'opacity-25') : '';

  const multInput = canEdit ? (
    <input
      type="number"
      min={1}
      max={100}
      value={mult}
      onChange={e => onSetMultiplier(item, parseInt(e.target.value) || 1)}
      onClick={e => e.stopPropagation()}
      title="مضاعف الكمية (×N)"
      className={`shrink-0 w-9 text-center text-xs font-bold rounded py-0.5 focus:outline-none focus:ring-1 ${
        mult > 1
          ? 'text-violet-700 bg-violet-50 border border-violet-300 focus:ring-violet-300'
          : 'text-slate-400 bg-transparent border border-transparent hover:border-slate-200 focus:ring-slate-300'
      }`}
    />
  ) : mult > 1 ? (
    <span className="shrink-0 w-9 text-center text-xs font-bold rounded py-0.5 text-violet-700 bg-violet-50 border border-violet-300">×{mult}</span>
  ) : null;

  return (
    <div className={`flex items-center gap-1 px-2 py-1.5 group transition-all ${highlightCls} ${
      hasPendingDelete ? 'pending-delete' : hasPendingUpdate ? 'pending-update' : ''
    }`}>
      {!isSnack && (
        <span
          title="الفئة تُؤخذ من الصنف نفسه — لتعديلها روح صفحة الأصناف"
          className={`shrink-0 text-sm leading-none w-5 h-5 flex items-center justify-center rounded ${theme.bg} ${theme.text}`}
        >
          {theme.icon}
        </span>
      )}
      {canEdit ? (
        <button type="button" onClick={onEdit} className="flex-1 text-right text-sm font-medium text-slate-800 hover:text-emerald-700 truncate" title="اضغط للتغيير">
          {item.meals?.name ?? '—'}
        </button>
      ) : (
        <span className="flex-1 text-right text-sm font-medium text-slate-800 truncate" title="ما عندك صلاحية تعديل قائمة الطعام">
          {item.meals?.name ?? '—'}
        </span>
      )}
      {canEdit ? (
        <>
          <input
            type="number"
            value={countDraft ?? String(totalCount)}
            readOnly={!benReady}
            onFocus={e => { if (benReady) { setCountDraft(String(totalCount)); e.target.select(); } }}
            onChange={e => { if (benReady) setCountDraft(e.target.value); }}
            onBlur={() => {
              if (countDraft !== null) {
                const desired = parseInt(countDraft);
                // العدد يُخزَّن كفرق عن (المستفيدون − المحظورون) × المضاعف، فلا
                // نحسبه إلا وأعداد المستفيدين مقروءة بالكامل.
                if (benReady && !isNaN(desired) && desired !== totalCount)
                  onSetExtraQty(item, desired - directCount * mult);
                setCountDraft(null);
              }
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') { setCountDraft(null); e.currentTarget.blur(); }
            }}
            onClick={e => e.stopPropagation()}
            title={!benReady
              ? 'جاري قراءة أعداد المستفيدين — انتظر قبل تعديل العدد'
              : hasBenData
                ? `${directCount} × ${mult}${extraQty !== 0 ? ` + ${extraQty}` : ''} = ${totalCount}\nاضغط Enter للحفظ`
                : 'اكتب الكمية واضغط Enter'}
            className={`shrink-0 w-14 text-center text-xs font-bold rounded py-0.5 border focus:outline-none focus:ring-1 ${
              benReady
                ? 'text-emerald-700 bg-emerald-50 border-emerald-300 focus:ring-emerald-400'
                : 'text-slate-400 bg-slate-50 border-slate-200 cursor-wait'
            }`}
          />
          {multInput}
        </>
      ) : hasBenData ? (
        <>
          <span className="shrink-0 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
            {totalCount}
          </span>
          {multInput}
        </>
      ) : (
        multInput
      )}
      {canEdit && (
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 text-xs transition-opacity"
          title="حذف"
        >
          ✕
        </button>
      )}
    </div>
  );
}

export default function MenuView() {
  const { user: currentUser } = useCurrentUser();
  const isAdmin = currentUser?.is_admin === true;
  const canEdit = can(currentUser, 'menu', 'edit');
  const editNeedsApproval = needsApproval(currentUser, 'menu', 'edit');
  const myPending = useMyPending('menu_item');
  // الـtab بين منيو المستفيدين ومنيو المرافقين — يبقى بين الجلسات.
  const [entityType, setEntityType] = useState<EntityType>(() => {
    if (typeof window === 'undefined') return 'beneficiary';
    return (window.localStorage.getItem('menuEntityType') as EntityType | null) ?? 'beneficiary';
  });
  const [allItems, setAllItems] = useState<MenuItem[]>([]);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [benTotal, setBenTotal] = useState(0);
  const [benExclusions, setBenExclusions] = useState<Record<string, number>>({});
  const [benReady, setBenReady] = useState(false);
  const [countsWarning, setCountsWarning] = useState('');
  const [activeWeek, setActiveWeek] = useState<WeekNumber>(1);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CellEditState | null>(null);
  const [importStatus, setImportStatus] = useState<'idle' | 'importing' | 'done' | 'error'>('idle');
  const [importMsg, setImportMsg] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [search, setSearch] = useState('');
  /**
   * صفوف إضافية يطلبها المستخدم لقسم معيّن — المفتاح `${meal_type}|m` للأساسي
   * و`|s` للسناك. الشبكة تتوسّع تلقائياً لتسع الأصناف الموجودة (وإلا اختفى ما
   * زاد عن الحد الثابت)، وهذي زيادة يدوية فوقها لتعبئة صنف جديد.
   */
  const [extraRows, setExtraRows] = useState<Record<string, number>>({});
  const addRow = (key: string) => setExtraRows(prev => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
  const importRef = useRef<HTMLInputElement>(null);

  const switchEntity = useCallback((next: EntityType) => {
    setEntityType(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('menuEntityType', next);
    }
  }, []);

  /**
   * إصلاح ذاتي صامت لصفوف قديمة أرقامها متضاربة (بقايا استيراد بمنطق قديم):
   * نُثبّت `category` على فئة الصنف ونجعل `position` متسلسلاً بلا فجوات ولا
   * تكرار. الترتيب الناتج مطابق تماماً للمعروض حالياً — فما يتحرّك شيء على
   * الشاشة — لكنه يمنع تبادل صفين لهما نفس الـposition في التحميلات القادمة.
   * يُجمَّع في أقل عدد استعلامات ممكن (٣٦ مجموعة كحد أقصى).
   */
  const repairMenuPositions = useCallback(async (items: MenuItem[]) => {
    const groups = new Map<string, { category: ItemCategory; position: number; ids: string[] }>();
    for (const [, slotItems] of buildSlotMap(items)) {
      for (const { item, category, position } of normalizeSlot(slotItems)) {
        if (item.position === position && item.category === category) continue;
        const k = `${category}|${position}`;
        const g = groups.get(k);
        if (g) g.ids.push(item.id); else groups.set(k, { category, position, ids: [item.id] });
      }
    }
    if (groups.size === 0) return;

    for (const { category, position, ids } of groups.values()) {
      const { error } = await supabase.from('menu_items').update({ category, position }).in('id', ids);
      if (error) return; // بلا ضجيج — العرض صحيح أصلاً بفضل الترتيب الثابت
    }

    const fix = new Map<string, { category: ItemCategory; position: number }>();
    for (const { category, position, ids } of groups.values()) {
      for (const id of ids) fix.set(id, { category, position });
    }
    setAllItems(prev => prev.map(i => {
      const f = fix.get(i.id);
      return f ? { ...i, ...f } : i;
    }));
    void logActivity({
      action: 'update',
      entity_type: 'meal',
      entity_name: `قائمة الطعام — توحيد ترتيب ${fix.size} صنف`,
      details: { repaired: fix.size, source: 'menu_position_repair' },
    });
  }, [supabase]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    // أعداد الفئة السابقة ما تصلح للفئة الجديدة — نصفّرها حتى تصل الأعداد الصحيحة
    setBenReady(false);
    setCountsWarning('');
    // نحاول الفلترة بـentity_type أولاً، ولو العمود ما موجود (الـmigration ما اتشغّل)
    // نرجع لجميع الصفوف. للمرافقين نظهر تنبيه.
    // قراءة على دفعات — جدول menu_items يكبر مع كل أسبوع/فئة وقد يتجاوز سقف
    // الـ١٠٠٠ صف فتختفي أصناف من الشبكة بدون أي رسالة خطأ.
    const tryFetchItems = async (withEntity: boolean, withMealCategory: boolean, withExtraQty: boolean = true) => {
      const mealCols = `id, name, english_name, type, is_snack${withEntity ? ', entity_type' : ''}${withMealCategory ? ', category' : ''}`;
      return fetchAllRows((from, to) => {
        const q = supabase
          .from('menu_items')
          .select(`id, week_number, day_of_week, meal_type, meal_id, category, position, multiplier${withExtraQty ? ', extra_quantity' : ''}${withEntity ? ', entity_type' : ''}, created_at, meals(${mealCols})`)
          .order('id')
          .range(from, to);
        return withEntity ? q.eq('entity_type', entityType) : q;
      });
    };
    const tryFetchMeals = async (withEntity: boolean, withCategory: boolean) => {
      const cols = `id, name, english_name, type, is_snack${withEntity ? ', entity_type' : ''}${withCategory ? ', category' : ''}, created_at`;
      const q = supabase.from('meals').select(cols).order('name');
      return withEntity ? q.eq('entity_type', entityType) : q;
    };

    let itemsRes = await tryFetchItems(true, true, true);
    let mealsRes = await tryFetchMeals(true, true);

    // إذا extra_quantity ما موجود (الـmigration ما اتشغّل) أعد المحاولة بدونه
    if (itemsRes.error && /extra_quantity|column/i.test(itemsRes.error.message)) {
      itemsRes = await tryFetchItems(true, true, false);
    }
    // إذا meals.category ما موجود (الـmigration ما اتشغّل) أعد المحاولة بدونه
    if (itemsRes.error && /category|column/i.test(itemsRes.error.message)) {
      itemsRes = await tryFetchItems(true, false, false);
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

    const loadedItems = itemsRes.data ? (itemsRes.data as unknown as MenuItem[]) : null;
    if (loadedItems) setAllItems(loadedItems);
    if (mealsRes.data) setMeals(mealsRes.data as unknown as Meal[]);

    // جلب إجمالي المستفيدين والمحظورات لعرض الأعداد الفعلية في الخلايا
    try {
      // ⚠️ exclusions جدول كبير (تعدّى ١٠٠٠ صف) — بدون قراءة على دفعات يقصّه
      // PostgREST بصمت فتظهر أعداد أكبر من الحقيقة في خلايا المنيو.
      const [bensRes, exclRes, inactiveSet] = await Promise.all([
        fetchAllRows<{ id: string; entity_type?: string }>((from, to) =>
          supabase.from('beneficiaries').select('id, entity_type').order('id').range(from, to)),
        fetchAllRows<{ beneficiary_id?: string; meal_id: string; beneficiaries?: { entity_type?: string } | { entity_type?: string }[] }>((from, to) =>
          supabase
            .from('exclusions')
            .select('beneficiary_id, meal_id, beneficiaries!inner(entity_type)')
            .order('id')
            .range(from, to)),
        fetchInactiveBeneficiaryIds(supabase),
      ]);
      if (bensRes.error || !bensRes.data || exclRes.error || !exclRes.data) {
        // ما نعرض أعداداً نصف مقروءة ولا نسمح بتعديلها — الصمت هنا كان يعني
        // أرقاماً خاطئة تُحفظ على أنها «كمية إضافية» وتظل تزيد وتنقص بعدها.
        setCountsWarning('تعذّرت قراءة أعداد المستفيدين/المحظورات — الأعداد المعروضة غير مؤكدة، وتعديل العدد معطّل حتى تُقرأ.');
      } else {
        setBenTotal(
          bensRes.data.filter(b => (b.entity_type ?? 'beneficiary') === entityType && !inactiveSet.has(b.id)).length
        );
        const counts: Record<string, number> = {};
        for (const ex of exclRes.data) {
          if (ex.beneficiary_id && inactiveSet.has(ex.beneficiary_id)) continue;
          const ben = Array.isArray(ex.beneficiaries) ? ex.beneficiaries[0] : ex.beneficiaries;
          if ((ben?.entity_type ?? 'beneficiary') !== entityType) continue;
          counts[ex.meal_id] = (counts[ex.meal_id] ?? 0) + 1;
        }
        setBenExclusions(counts);
        setBenReady(true);
      }
    } catch {
      setCountsWarning('تعذّرت قراءة أعداد المستفيدين/المحظورات — الأعداد المعروضة غير مؤكدة، وتعديل العدد معطّل حتى تُقرأ.');
    }

    setLoading(false);

    // إصلاح ذاتي صامت لصفوف قديمة أرقامها متضاربة (بقايا استيراد بمنطق قديم):
    // نُثبّت الفئة على فئة الصنف ونجعل الـposition متسلسلاً بلا فجوات. الترتيب
    // الناتج مطابق للمعروض حالياً، فما يتحرّك شيء على الشاشة — لكنه يمنع تبادل
    // الصفوف عشوائياً في التحميلات القادمة.
    if (loadedItems && isAdmin) void repairMenuPositions(loadedItems);
  }, [supabase, entityType, isAdmin, repairMenuPositions]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const slotMap = useMemo(() => buildSlotMap(allItems), [allItems]);

  // خريطة الأصناف المعلّقة (إضافات بانتظار الموافقة) لخلايا فارغة في المنيو.
  // المفتاح: week|day|meal_type|sub|rowIndex (sub: 's' للسناك، 'm' للأساسي)
  // كل خانة فارغة تتفقد لو فيها طلب pending وترسم اسم الصنف بخط رمادي.
  const pendingCreateBySlot = useMemo(() => {
    const m = new Map<string, { mealId: string; multiplier: number }>();
    for (const pa of myPending.getCreates()) {
      const p = pa.payload as Record<string, unknown> | null;
      if (!p) continue;
      if (p.entity_type && p.entity_type !== entityType) continue;
      const week = Number(p.week_number);
      const day = Number(p.day_of_week);
      const mealType = p.meal_type as MealType | undefined;
      const position = Number(p.position ?? 0);
      const mealId = p.meal_id as string | undefined;
      if (!mealId || !mealType || !week || Number.isNaN(day)) continue;
      // الفئة أوثق من الـposition لطلبات قديمة كُتبت باصطلاح مختلف
      const isSnack = p.category === 'snack' || isSnackPosition(position);
      const rowIndex = positionRowIndex(position);
      const key = `${week}|${day}|${mealType}|${isSnack ? 's' : 'm'}|${rowIndex}`;
      m.set(key, { mealId, multiplier: Number(p.multiplier ?? 1) });
    }
    return m;
  }, [myPending, entityType]);

  const mealsById = useMemo(() => {
    const m = new Map<string, Meal>();
    for (const meal of meals) m.set(meal.id, meal);
    return m;
  }, [meals]);

  // For a given (week, day, meal_type) slot, return arrays of mains and snacks.
  // الفصل يعتمد فئة الصنف نفسه (المصدر الموحّد) بترتيب ثابت — لا على النسخة
  // المخزّنة في menu_items التي قد تتقادم فيقفز الصنف بين الأساسي والسناك.
  const slotMainsAndSnacks = (week: WeekNumber, day: number, mealType: MealType) =>
    splitSlot(slotMap.get(slotKey(week, day, mealType)) ?? []);

  /**
   * الفئة والترتيب لصف يُكتب الآن — مصدر واحد لكل مسارات الكتابة (تحرير مباشر
   * أو طلب موافقة). الفئة تُؤخذ من الصنف نفسه، والـposition يتبع اصطلاح
   * lib/menu-utils (أساسي 0.. / سناك 100..) فما تختلط الأرقام مع الاستيراد.
   */
  const newCellPlacement = (mealId: string, isSnack: boolean, appendIndex: number) => {
    const meal = mealsById.get(mealId) ?? null;
    const category = effectiveCategory({ category: isSnack ? 'snack' : 'hot', meals: meal });
    return {
      category,
      position: isSnack ? snackPosition(appendIndex) : mainPosition(appendIndex),
    };
  };

  const handleSetCell = async (
    week: WeekNumber, day: number, mealType: MealType,
    rowIndex: number, isSnack: boolean, mealId: string | null,
  ) => {
    // Find existing item at this position within the (mains or snacks) sub-list
    const { mains, snacks } = slotMainsAndSnacks(week, day, mealType);
    const list = isSnack ? snacks : mains;
    const existing = list[rowIndex] ?? null;
    const slotLabel = `${WEEK_TITLES[week]} - ${MENU_DAYS.find(d => d.value === day)?.label} - ${mealType}${isSnack ? ' (سناك)' : ''}`;

    if (mealId === null) {
      // Clear this position
      if (existing) {
        if (editNeedsApproval && currentUser) {
          const r = await enqueueGenericDelete(supabase, currentUser, 'menu_item', existing.id, slotLabel);
          if (!r.ok) alert(`⚠ ${r.error}`);
          return;
        }
        await supabase.from('menu_items').delete().eq('id', existing.id);
        void logActivity({
          action: 'delete',
          entity_type: 'meal',
          entity_id: existing.id,
          entity_name: `قائمة الطعام — ${WEEK_TITLES[week]} ${MENU_DAYS.find(d => d.value === day)?.label}`,
          details: {
            // الصنف المشال هو كل مضمون العملية — بدونه السجل يقول «مُسح شيء ما»
            ...changeDetails(
              { meal: mealsById.get(existing.meal_id)?.name ?? null },
              { meal: null },
              ['meal'],
            ),
            week, day, meal_type: mealType, source: 'menu_clear',
          },
        });
      }
      await fetchData();
      return;
    }

    // إرسال طلب موافقة بدل التطبيق المباشر — بدون alert نجاح
    // عشان تعبئة الجدول سلسة، والمؤشر البصري (خط رمادي/شارة) كافٍ.
    if (editNeedsApproval && currentUser) {
      if (existing) {
        const r = await enqueueGenericUpdate(supabase, currentUser, 'menu_item', existing.id, slotLabel, { meal_id: mealId });
        if (!r.ok) alert(`⚠ ${r.error}`);
      } else {
        const { category, position } = newCellPlacement(mealId, isSnack, list.length);
        // entity_name فريد لكل صف عشان dedup ما يستبدل صف بآخر —
        // المستخدم يقدر يعبّي عدّة صفوف لنفس الخانة.
        const createLabel = `${slotLabel} #${rowIndex + 1}`;
        const payload = { week_number: week, day_of_week: day, meal_type: mealType, meal_id: mealId, category, position, entity_type: entityType, multiplier: 1 };
        const r = await enqueueGenericCreate(supabase, currentUser, 'menu_item', createLabel, payload);
        if (!r.ok) alert(`⚠ ${r.error}`);
      }
      return;
    }

    // If the meal is already in this slot at a different position, just delete the old position to avoid duplicate.
    const existingDuplicate = (slotMap.get(slotKey(week, day, mealType)) ?? []).find(i => i.meal_id === mealId);
    if (existingDuplicate && existing && existingDuplicate.id !== existing.id) {
      // Remove existing at this row first
      await supabase.from('menu_items').delete().eq('id', existing.id);
    }

    if (existing) {
      // تبديل الصنف في نفس الصف — والفئة تُحدَّث معه، وإلا بقيت فئة الصنف
      // القديم مخزّنة فيقفز الصف بين القسم الأساسي وقسم السناك لاحقاً.
      const { category } = newCellPlacement(mealId, isSnack, 0);
      await supabase
        .from('menu_items')
        .update({ meal_id: mealId, category })
        .eq('id', existing.id);
    } else {
      // صف جديد — يُضاف في نهاية قسمه تماماً كما يظهر في الشبكة
      const allInSlot = slotMap.get(slotKey(week, day, mealType)) ?? [];
      const { category, position } = newCellPlacement(mealId, isSnack, list.length);

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
      entity_id: existing?.id ?? null,
      entity_name: `قائمة الطعام — ${WEEK_TITLES[week]} ${MENU_DAYS.find(d => d.value === day)?.label}`,
      details: {
        // التبديل يُسجَّل «الصنف القديم ← الجديد»، والتعبئة الأولى تُسجَّل صنفاً مُدخلاً
        ...changeDetails(
          { meal: existing ? (mealsById.get(existing.meal_id)?.name ?? null) : null },
          { meal: mealsById.get(mealId)?.name ?? null },
          ['meal'],
        ),
        week, day, meal_type: mealType,
        row: rowIndex + 1,
        section: isSnack ? 'سناك' : 'أساسي',
        source: 'menu_edit',
      },
    });

    await fetchData();
  };

  const handleSetMultiplier = async (item: MenuItem, value: number) => {
    const v = Math.max(1, Math.min(100, Math.floor(value) || 1));
    if (v === item.multiplier) return;
    // إرسال طلب موافقة بدل التطبيق المباشر — بدون alert نجاح
    if (editNeedsApproval && currentUser) {
      const r = await enqueueGenericUpdate(supabase, currentUser, 'menu_item', item.id, `مضاعف "${item.meals?.name ?? ''}"`, { multiplier: v });
      if (!r.ok) alert(`⚠ ${r.error}`);
      return;
    }
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
      details: {
        ...changeDetails({ multiplier: item.multiplier }, { multiplier: v }, ['multiplier']),
        meal: item.meals?.name ?? null,
        source: 'menu_multiplier',
      },
    });
  };

  const handleSetExtraQty = async (item: MenuItem, value: number) => {
    const v = Math.floor(value) || 0;
    if (v === (item.extra_quantity ?? 0)) return;
    setAllItems(prev => prev.map(i => i.id === item.id ? { ...i, extra_quantity: v } : i));
    const { error } = await supabase.from('menu_items').update({ extra_quantity: v }).eq('id', item.id);
    if (error) {
      setAllItems(prev => prev.map(i => i.id === item.id ? { ...i, extra_quantity: item.extra_quantity ?? 0 } : i));
      if (/extra_quantity|column/i.test(error.message)) {
        alert('عمود extra_quantity غير موجود — شغّل menu-extra-qty-migration.sql في Supabase SQL Editor');
      }
      return;
    }
    void logActivity({
      action: 'update',
      entity_type: 'meal',
      entity_id: item.id,
      entity_name: `قائمة الطعام — ${WEEK_TITLES[item.week_number as WeekNumber]}`,
      details: {
        ...changeDetails(
          { extra_quantity: item.extra_quantity ?? 0 },
          { extra_quantity: v },
          ['extra_quantity'],
        ),
        meal: item.meals?.name ?? null,
        source: 'menu_extra_qty',
      },
    });
  };

  const handleClearWeek = async () => {
    if (!confirm(`حذف كل أصناف ${WEEK_TITLES[activeWeek]} (${ENTITY_TYPE_LABELS_PLURAL[entityType]})؟`)) return;
    // ⚠️ مهم: المسح مقيّد بـentity_type عشان ما نمسح منيو الفئة الأخرى بالخطأ.
    const clearedItems = allItems.filter(
      i => i.week_number === activeWeek && (i.entity_type ?? 'beneficiary') === entityType
    );
    await supabase.from('menu_items').delete().eq('week_number', activeWeek).eq('entity_type', entityType);
    void logActivity({
      action: 'delete',
      entity_type: 'meal',
      entity_name: `قائمة الطعام — ${WEEK_TITLES[activeWeek]} — ${ENTITY_TYPE_LABELS_PLURAL[entityType]} (مسح كامل)`,
      details: {
        week: activeWeek,
        for_entity: entityType,
        // عدد الأصناف المسحوبة يُحسب قبل إعادة القراءة — بعدها الشبكة فاضية
        deleted: clearedItems.length,
        removed_menu_meals: clearedItems
          .map(i => mealsById.get(i.meal_id)?.name ?? 'صنف محذوف')
          .sort((a, b) => a.localeCompare(b, 'ar')),
        source: 'menu_clear_week',
      },
    });
    await fetchData();
  };

  const handleExport = async () => {
    const { exportMenuXLSX } = await import('./menu-xlsx');
    await exportMenuXLSX(allItems, meals);
  };

  // اختيار الملف لا ينفّذ الاستيراد مباشرة — بل يفتح حوار اختيار الطريقة (إضافة/استبدال).
  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setPendingFile(file);
  };

  const handleImport = async (file: File, mode: ImportMode) => {
    setImportStatus('importing');
    setImportMsg('');
    try {
      if (meals.length === 0) {
        setImportStatus('error');
        setImportMsg('قاعدة الأصناف لم تُقرأ بعد — أعد تحميل الصفحة ثم جرّب مرة أخرى');
        return;
      }

      const { importMenuXLSX } = await import('./menu-xlsx');
      const { rows, errors, weeks } = await importMenuXLSX(file, meals);

      // لا نكتب أي شيء ما دام في الملف مشكلة واحدة. سابقاً كان الاستيراد يمشي
      // جزئياً: يمسح الأسبوع كاملاً ثم يُدرج الصفوف التي انقرأت فقط — فكل صنف
      // تعذّرت قراءته يختفي من المنيو نهائياً بلا رجعة.
      if (errors.length > 0) {
        setImportStatus('error');
        setImportMsg(
          `لم يُنفَّذ أي تعديل — صحّح الملف أولاً (${errors.length} مشكلة): ` +
          errors.slice(0, 6).join(' • ') + (errors.length > 6 ? ' …' : '')
        );
        return;
      }
      if (rows.length === 0) {
        setImportStatus('error');
        setImportMsg('لم يُعثر على أصناف صالحة في الملف');
        return;
      }

      // تطبيق كـ«فرق» بدل مسح الأسبوع وإعادة إدراجه: نكتب المتغيّر فقط، وفي وضع
      // الاستبدال نحذف — بالمعرّف — ما لم يعد له وجود في الملف. النتيجة أن تنزيل
      // الملف ورفعه بدون تعديل عملية محايدة تماماً.
      // حوار المنيو يعرض «إضافة» و«استبدال» فقط — أي وضع آخر يُعامل كإضافة
      const res = await applyMenuImport(supabase, rows, weeks, entityType, mode === 'replace' ? 'replace' : 'append');

      void logActivity({
        action: 'update',
        entity_type: 'meal',
        entity_name: `استيراد قائمة الطعام (${rows.length} صنف) — ${ENTITY_TYPE_LABELS_PLURAL[entityType]}`,
        details: {
          count: rows.length, weeks, mode, for_entity: entityType,
          inserted: res.inserted, updated: res.updated, deleted: res.deleted, unchanged: res.unchanged,
          source: 'menu_xlsx_import',
        },
      });

      setImportStatus('done');
      setImportMsg(
        res.inserted + res.updated + res.deleted === 0
          ? `الملف مطابق للمنيو الحالي — ما تغيّر شيء (${res.unchanged} صنف)`
          : `تم الاستيراد: ${res.inserted} إضافة، ${res.updated} تعديل، ${res.deleted} حذف، ${res.unchanged} بلا تغيير`
      );
      await fetchData();
      setTimeout(() => setImportStatus('idle'), 6000);
    } catch (err) {
      setImportStatus('error');
      setImportMsg(`حدث خطأ أثناء الاستيراد: ${err instanceof Error ? err.message : String(err)}`);
    }
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
                onChange={handleFilePick}
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

      {/* تنبيه: الأعداد غير مؤكدة — أفضل من عرض رقم ناقص بصمت */}
      {countsWarning && (
        <div className="px-4 py-2.5 rounded-lg text-sm font-medium bg-amber-50 text-amber-800 border border-amber-200">
          ⚠️ {countsWarning}
        </div>
      )}

      {/* اختيار طريقة استيراد المنيو */}
      <ImportModeDialog
        isOpen={pendingFile !== null}
        description="كيف تريد التعامل مع المنيو الحالي للأسابيع الموجودة في الملف؟"
        replaceWarning="أي صنف موجود حالياً في أسابيع الملف ولا يظهر فيه سيُحذف. الأصناف المطابقة تبقى كما هي."
        onChoose={(mode) => {
          const file = pendingFile;
          setPendingFile(null);
          if (file) void handleImport(file, mode);
        }}
        onCancel={() => setPendingFile(null)}
      />

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

                // الشبكة تتّسع لأكبر خانة في القسم: الحد الثابت كان يخفي أي صنف
                // زائد عنه بلا أي أثر على الشاشة.
                const perDay = MENU_DAYS.map(d => slotMainsAndSnacks(activeWeek, d.value, section.meal_type));
                const mainKey  = `${section.meal_type}|m`;
                const snackKey = `${section.meal_type}|s`;
                const mainRows = Math.max(MAIN_ROWS_PER_MEAL, ...perDay.map(p => p.mains.length))
                  + (extraRows[mainKey] ?? 0);
                const snackRows = Math.max(SNACK_ROWS_PER_MEAL, ...perDay.map(p => p.snacks.length))
                  + (extraRows[snackKey] ?? 0);

                return [
                  // الصفوف الأساسية
                  ...Array.from({ length: mainRows }, (_, rowIdx) => (
                    <tr key={`${section.meal_type}-main-${rowIdx}`} className="hover:bg-slate-50/40">
                      {MENU_DAYS.map((d, dayIdx) => {
                        const cellItem = perDay[dayIdx].mains[rowIdx] ?? null;
                        const pKey = `${activeWeek}|${d.value}|${section.meal_type}|m|${rowIdx}`;
                        return (
                          <td key={d.value} className="border border-slate-200 align-middle p-0">
                            <Cell
                              key={cellItem?.id ?? 'empty'}
                              item={cellItem}
                              pendingCreate={pendingCreateBySlot.get(pKey) ?? null}
                              mealsById={mealsById}
                              benTotal={benTotal}
                              benExclusions={benExclusions}
                              benReady={benReady}
                              search={search}
                              canEdit={canEdit}
                              isSnack={false}
                              hasPendingDelete={cellItem ? myPending.hasDelete(cellItem.id) : false}
                              hasPendingUpdate={cellItem ? myPending.hasUpdate(cellItem.id) : false}
                              onEdit={() => setEditing({ week: activeWeek, day: d.value, meal_type: section.meal_type, isSnack: false, rowIndex: rowIdx })}
                              onClear={() => handleSetCell(activeWeek, d.value, section.meal_type, rowIdx, false, null)}
                              onSetMultiplier={handleSetMultiplier}
                              onSetExtraQty={handleSetExtraQty}
                            />
                          </td>
                        );
                      })}
                      {rowIdx === 0 && (
                        <td
                          rowSpan={mainRows + (canEdit ? 1 : 0)}
                          className={`border border-slate-200 align-middle font-bold text-sm w-20 ${sectionTheme}`}
                          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                        >
                          {section.label}
                        </td>
                      )}
                    </tr>
                  )),
                  // صف «إضافة صف» للقسم الأساسي
                  ...(canEdit ? [(
                    <tr key={`${section.meal_type}-main-add`} className="bg-slate-50/60">
                      <td colSpan={MENU_DAYS.length} className="border border-slate-200 p-0">
                        <button
                          type="button"
                          onClick={() => addRow(mainKey)}
                          title={`أضف صفاً جديداً لقسم ${section.label} — لكل الأيام`}
                          className="w-full py-1 text-[11px] font-semibold text-slate-400 hover:text-emerald-600 hover:bg-emerald-50/50 transition-colors"
                        >
                          + إضافة صف
                        </button>
                      </td>
                    </tr>
                  )] : []),
                  // صفوف السناك — خلفية كهرمانية
                  ...Array.from({ length: snackRows }, (_, rowIdx) => (
                    <tr key={`${section.meal_type}-snack-${rowIdx}`} className="bg-amber-50/60">
                      {MENU_DAYS.map((d, dayIdx) => {
                        const cellItem = perDay[dayIdx].snacks[rowIdx] ?? null;
                        const pKey = `${activeWeek}|${d.value}|${section.meal_type}|s|${rowIdx}`;
                        return (
                          <td key={d.value} className="border border-slate-200 align-middle p-0">
                            <Cell
                              key={cellItem?.id ?? 'empty'}
                              item={cellItem}
                              pendingCreate={pendingCreateBySlot.get(pKey) ?? null}
                              mealsById={mealsById}
                              benTotal={benTotal}
                              benExclusions={benExclusions}
                              benReady={benReady}
                              search={search}
                              canEdit={canEdit}
                              isSnack={true}
                              hasPendingDelete={cellItem ? myPending.hasDelete(cellItem.id) : false}
                              hasPendingUpdate={cellItem ? myPending.hasUpdate(cellItem.id) : false}
                              onEdit={() => setEditing({ week: activeWeek, day: d.value, meal_type: section.meal_type, isSnack: true, rowIndex: rowIdx })}
                              onClear={() => handleSetCell(activeWeek, d.value, section.meal_type, rowIdx, true, null)}
                              onSetMultiplier={handleSetMultiplier}
                              onSetExtraQty={handleSetExtraQty}
                            />
                          </td>
                        );
                      })}
                      {rowIdx === 0 && (
                        <td
                          rowSpan={snackRows + (canEdit ? 1 : 0)}
                          className="border border-slate-200 align-middle font-bold text-sm w-20 bg-amber-100 text-amber-800"
                          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                        >
                          سناك
                        </td>
                      )}
                    </tr>
                  )),
                  ...(canEdit ? [(
                    <tr key={`${section.meal_type}-snack-add`} className="bg-amber-50/40">
                      <td colSpan={MENU_DAYS.length} className="border border-slate-200 p-0">
                        <button
                          type="button"
                          onClick={() => addRow(snackKey)}
                          title={`أضف صف سناك جديداً لقسم ${section.label} — لكل الأيام`}
                          className="w-full py-1 text-[11px] font-semibold text-amber-500/70 hover:text-amber-700 hover:bg-amber-100/60 transition-colors"
                        >
                          + إضافة صف سناك
                        </button>
                      </td>
                    </tr>
                  )] : []),
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
            // نفس تقسيم الشبكة بالضبط، وإلا اختلف «مستخدم» عمّا يراه المستخدم
            (() => {
              const { mains, snacks } = slotMainsAndSnacks(editing.week, editing.day, editing.meal_type);
              return (editing.isSnack ? snacks : mains)
                .map((i, idx) => idx === editing.rowIndex ? null : i.meal_id)
                .filter((x): x is string => !!x);
            })()
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
