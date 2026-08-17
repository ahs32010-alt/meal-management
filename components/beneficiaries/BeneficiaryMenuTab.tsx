'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase-client';
import { fetchAllRows } from '@/lib/fetch-all';
import type { Meal, MealType, ItemCategory, MenuItem, EntityType } from '@/lib/types';
import {
  WEEK_NUMBERS, WEEK_TITLES, MENU_DAYS, MEAL_SECTIONS,
  MAIN_ROWS_PER_MEAL, SNACK_ROWS_PER_MEAL,
  buildSlotMap, type WeekNumber,
} from '@/lib/menu-utils';
import {
  buildPersonalMenuSlot,
  tallyPersonalMenuRows,
  slotsContainingMeal,
  type PersonalMenuExclusion,
  type PersonalMenuFixed,
  type PersonalMenuOverride,
  type PersonalMenuRow,
} from '@/lib/beneficiary-menu';

/**
 * تبويب «المنيو المخصّص» داخل نافذة المستفيد — عرض **وتحرير**.
 *
 * الشكل مطابق لشبكة صفحة قائمة الطعام (أعمدة الأيام × صفوف الوجبات + صفوف
 * السناك)، والمحتوى مخصّص لهذا المستفيد: محظوراته مستبدلة ببدائله.
 *
 * التحرير لا يكتب في القاعدة من هنا — كل أمر يعدّل **حالة النافذة** نفسها التي
 * تعدّلها تبويبات «المحظورات» و«الثابتة الأسبوعية»، فالانعكاس بين التبويبات
 * لحظي وفي الاتجاهين، والكتابة تصير مرة واحدة بزر «حفظ التعديلات».
 *
 * أين يسكن كل تعديل:
 *   • «كل الأيام»     → exclusions (تبويب المحظورات)
 *   • «كل نفس اليوم»  → beneficiary_fixed_meals (تبويب الثابتة الأسبوعية)
 *   • «هذا اليوم فقط» → beneficiary_menu_overrides (خاص بهذا التبويب)
 */

/**
 * أوامر التحرير — كلها تكتب في حالة النافذة نفسها (لا في القاعدة)، فالانعكاس
 * على تبويبي «المحظورات» و«الثابتة الأسبوعية» لحظي في الاتجاهين، والحفظ يصير
 * مرة واحدة بزر «حفظ التعديلات».
 */
export interface MenuTabActions {
  setGlobalExclusion: (baseMealId: string, altMealId: string | null) => void;
  clearGlobalExclusion: (baseMealId: string) => void;
  setSlotOverride: (ov: PersonalMenuOverride & { meal_type: MealType }) => void;
  clearSlotOverride: (slot: { week_number: number; day_of_week: number; meal_type: MealType }, mealId: string) => void;
  addWeeklyFixed: (meal: Meal, mealType: MealType, day: number, quantity: number, isAlternative: boolean) => void;
  removeWeeklyFixedDay: (mealId: string, mealType: MealType, day: number) => void;
  setWeeklyFixedQuantity: (mealId: string, mealType: MealType, quantity: number) => void;
}

interface Props {
  entityType: EntityType;
  /** قاعدة أصناف نفس الفئة — نفس القائمة التي تستعملها بقية التبويبات */
  meals: Meal[];
  exclusions: PersonalMenuExclusion[];
  fixed: PersonalMenuFixed[];
  /** قرارات الخانات كما هي في حالة النافذة الآن */
  overrides?: PersonalMenuOverride[];
  /** هل اكتملت قراءة القرارات من القاعدة؟ */
  overridesReady?: boolean;
  /** الجدول غير موجود (الترقية ما اتشغّلت) → قرارات الخانة معطّلة، والعام يعمل */
  overridesTableMissing?: boolean;
  /** غيابها = عرض فقط (نفس السلوك السابق) */
  actions?: MenuTabActions;
  /** اسم المستفيد — للعنوان فقط */
  beneficiaryName?: string;
}

// نفس أيقونات وألوان فئات صفحة قائمة الطعام
const CATEGORY_THEME: Record<ItemCategory, { icon: string; bg: string; text: string }> = {
  hot:   { icon: '🔥', bg: 'bg-red-100',   text: 'text-red-700' },
  cold:  { icon: '❄️', bg: 'bg-sky-100',   text: 'text-sky-700' },
  snack: { icon: '🍿', bg: 'bg-amber-100', text: 'text-amber-700' },
};

function todayDayOfWeek(): number {
  return new Date().getDay();
}

// ─── خانة واحدة في الشبكة — بنفس مقاسات خلايا صفحة قائمة الطعام ──────────────
function Cell({ row, onEdit }: { row: PersonalMenuRow | null; onEdit?: () => void }) {
  if (!row) {
    if (!onEdit) return <div className="w-full h-full min-h-[34px]" />;
    return (
      <button
        type="button"
        onClick={onEdit}
        title="أضف صنفاً لهذا المستفيد في هذه الخانة"
        className="w-full h-full min-h-[34px] text-slate-300 hover:text-emerald-600 hover:bg-emerald-50/40 text-xs font-medium transition-colors"
      >
        +
      </button>
    );
  }

  const theme = CATEGORY_THEME[row.category];
  // غلاف واحد لكل الحالات: يصير زراً قابلاً للنقر عند تفعيل التحرير
  const wrap = (inner: React.ReactNode, cls: string, title: string) => onEdit ? (
    <button type="button" onClick={onEdit} title={`${title}${title ? ' — ' : ''}اضغط للتعديل`}
      className={`w-full text-right ${cls} hover:ring-2 hover:ring-inset hover:ring-emerald-300 transition-shadow`}>
      {inner}
    </button>
  ) : (
    <div className={cls} title={title}>{inner}</div>
  );
  const icon = (
    <span className={`shrink-0 text-sm leading-none w-5 h-5 flex items-center justify-center rounded ${theme.bg} ${theme.text}`}>
      {theme.icon}
    </span>
  );

  // محظور بلا بديل → الخانة فاضية، واسم الصنف الأساسي بخط أحمر
  if (row.kind === 'removed') {
    return wrap(
      <div className="flex items-center gap-1 px-2 py-1.5">
        {icon}
        <span className="flex-1 text-right text-sm font-semibold text-red-600 truncate">
          {row.originalMeal?.name ?? '—'}
        </span>
        <span className="shrink-0 text-[9px] font-bold text-red-600 bg-white border border-red-200 rounded px-1 leading-tight">
          بلا بديل
        </span>
      </div>,
      'bg-red-50/50 min-h-[34px]',
      `${row.originalMeal?.name ?? ''} — مرفوع بلا بديل، ما ياكل شيء بدله`,
    );
  }

  if (row.kind === 'replaced') {
    return wrap(
      <div className="flex items-center gap-1 px-2 py-1">
        {icon}
        <span className="flex-1 min-w-0 text-right">
          <span className="block text-sm font-semibold text-emerald-700 truncate">{row.meal?.name ?? '—'}</span>
          <span className="block text-[10px] text-slate-400 truncate leading-tight">
            بدل <span className="text-red-500 line-through">{row.originalMeal?.name ?? '—'}</span>
          </span>
        </span>
        <span className="shrink-0 text-[9px] font-bold text-emerald-700 bg-white border border-emerald-200 rounded px-1 leading-tight">
          بديل
        </span>
      </div>,
      'bg-emerald-50/50 min-h-[34px]',
      `بديل عن ${row.originalMeal?.name ?? ''}`,
    );
  }

  // صنف ثابت أسبوعي، أو صنف مضاف لهذه الخانة — يفترقان في الشارة والنطاق
  if (row.kind === 'fixed' || row.kind === 'added') {
    const cancelled = row.suppressedBy.length > 0;
    const isAdded = row.kind === 'added';
    const tone = cancelled ? 'bg-slate-50' : isAdded ? 'bg-violet-50/60' : 'bg-teal-50/50';
    const badge = cancelled
      ? { text: 'ملغى', cls: 'text-slate-400 border-slate-200' }
      : isAdded
        ? { text: row.isAlternativeFixed ? 'مضاف·بديل' : 'مضاف', cls: 'text-violet-700 border-violet-200' }
        : { text: row.isAlternativeFixed ? 'ثابت·بديل' : 'ثابت', cls: 'text-teal-700 border-teal-200' };
    return wrap(
      <div className="flex items-center gap-1 px-2 py-1.5">
        {icon}
        <span className={`flex-1 text-right text-sm font-semibold truncate ${
          cancelled ? 'text-slate-400 line-through' : isAdded ? 'text-violet-800' : 'text-teal-800'
        }`}>
          {row.meal?.name ?? '—'}
          {row.quantity > 1 && !cancelled && <span className="text-[10px] font-bold text-violet-600 mr-1">×{row.quantity}</span>}
        </span>
        <span className={`shrink-0 text-[9px] font-bold bg-white border rounded px-1 leading-tight ${badge.cls}`}>
          {badge.text}
        </span>
      </div>,
      `${tone} min-h-[34px]`,
      cancelled
        ? `صنف ثابت يُلغى لوجود ${row.suppressedBy.map(m => m.name).join('، ')} في نفس الوجبة`
        : isAdded
          ? `صنف مضاف لهذه الخانة وحدها${row.isAlternativeFixed ? ' (محتسب مع البدائل)' : ''}${row.quantity > 1 ? ` — كمية ${row.quantity}` : ''}`
          : `صنف ثابت أسبوعي${row.isAlternativeFixed ? ' (محتسب مع البدائل)' : ''}${row.quantity > 1 ? ` — كمية ${row.quantity}` : ''}`,
    );
  }

  return wrap(
    <div className="flex items-center gap-1 px-2 py-1.5">
      {icon}
      <span className="flex-1 text-right text-sm font-medium text-slate-800 truncate">{row.meal?.name ?? '—'}</span>
    </div>,
    'min-h-[34px]',
    row.meal?.name ?? '',
  );
}

// ─── محرّر الخانة ────────────────────────────────────────────────────────────
interface EditingState {
  week: WeekNumber;
  day: number;
  mealType: MealType;
  isSnack: boolean;
  row: PersonalMenuRow | null;
}

/** شارة النطاق — تقول للمستخدم أين يسكن هذا القرار */
function ScopeBadge({ scope }: { scope: PersonalMenuRow['scope'] }) {
  const map: Record<PersonalMenuRow['scope'], { label: string; cls: string } | null> = {
    menu:   null,
    slot:   { label: 'هذا اليوم فقط',  cls: 'text-violet-700 bg-violet-50 border-violet-200' },
    global: { label: 'كل الأيام',      cls: 'text-red-700 bg-red-50 border-red-200' },
    weekly: { label: 'كل نفس اليوم',   cls: 'text-teal-700 bg-teal-50 border-teal-200' },
  };
  const s = map[scope];
  if (!s) return null;
  return <span className={`text-[10px] font-bold border rounded-full px-2 py-0.5 ${s.cls}`}>{s.label}</span>;
}

function MealList({
  meals, onPick, emptyHint,
}: { meals: Meal[]; onPick: (m: Meal) => void; emptyHint: string }) {
  const [query, setQuery] = useState('');
  const filtered = meals.filter(m =>
    !query.trim() || m.name.includes(query.trim()) ||
    (m.english_name ?? '').toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="space-y-2">
      <input
        autoFocus
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="ابحث عن صنف…"
        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-300"
      />
      <div className="max-h-52 overflow-y-auto border border-slate-100 rounded-lg divide-y divide-slate-50">
        {filtered.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-6">{meals.length === 0 ? emptyHint : 'لا نتائج'}</p>
        ) : filtered.map(m => (
          <button
            key={m.id}
            type="button"
            onClick={() => onPick(m)}
            className="w-full text-right px-3 py-2 text-sm text-slate-800 hover:bg-emerald-50 hover:text-emerald-700 transition-colors"
          >
            {m.name}
            {m.english_name && <span className="text-[11px] text-slate-400 mr-2">({m.english_name})</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function CellEditor({
  editing, meals, slotMap, actions, slotDisabled, onClose,
}: {
  editing: EditingState;
  meals: Meal[];
  slotMap: Map<string, MenuItem[]>;
  actions: MenuTabActions;
  /** قرارات الخانة معطّلة (الترقية ما اتشغّلت) — العام والأسبوعي يبقيان متاحين */
  slotDisabled: boolean;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'home' | 'swap-slot' | 'swap-global' | 'add-slot' | 'add-weekly'>('home');
  const [qty, setQty] = useState(1);
  const [isAlt, setIsAlt] = useState(false);

  const { week, day, mealType, isSnack, row } = editing;
  const slot = { week_number: week, day_of_week: day, meal_type: mealType };
  const dayLabel = MENU_DAYS.find(d => d.value === day)?.label ?? '';
  const sectionLabel = MEAL_SECTIONS.find(s => s.meal_type === mealType)?.label ?? '';
  const anchorId = row?.anchorMealId ?? null;

  // أصناف نفس الوجبة ونفس القسم — لا نخلط سناكاً بصنف أساسي
  const candidates = meals.filter(m => m.type === mealType && m.is_snack === isSnack);
  const otherThanCurrent = candidates.filter(m => m.id !== anchorId);

  // أثر القرار العام: كم خانة في المنيو فيها هذا الصنف
  const globalReach = anchorId ? slotsContainingMeal(slotMap, anchorId).length : 0;

  const close = () => { setMode('home'); onClose(); };

  const applySlotReplace = (target: Meal) => {
    // القرار العام على نفس الصنف يبقى للأيام الأخرى — قرار الخانة يتقدّم هنا
    actions.setSlotOverride({ ...slot, action: 'replace', base_meal_id: anchorId, target_meal_id: target.id });
    close();
  };
  const applyGlobalReplace = (target: Meal) => {
    if (!anchorId) return;
    // نلغي قرار هذه الخانة وإلا غطّى على القرار العام فما يشوف المستخدم أثراً
    actions.clearSlotOverride(slot, anchorId);
    actions.setGlobalExclusion(anchorId, target.id);
    close();
  };
  const applySlotRemove = () => {
    actions.setSlotOverride({ ...slot, action: 'remove', base_meal_id: anchorId, target_meal_id: null });
    close();
  };
  const applyGlobalRemove = () => {
    if (!anchorId) return;
    actions.clearSlotOverride(slot, anchorId);
    actions.setGlobalExclusion(anchorId, null);
    close();
  };
  const applySlotAdd = (meal: Meal) => {
    actions.setSlotOverride({
      ...slot, action: 'add', base_meal_id: null, target_meal_id: meal.id,
      quantity: qty, is_alternative: isAlt,
    });
    close();
  };
  const applyWeeklyAdd = (meal: Meal) => {
    actions.addWeeklyFixed(meal, mealType, day, qty, isAlt);
    close();
  };

  const btn = 'w-full text-right px-3 py-2.5 rounded-lg border text-sm font-semibold transition-colors';
  const btnSlot = `${btn} border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100`;
  const btnGlobal = `${btn} border-red-200 bg-red-50 text-red-700 hover:bg-red-100`;
  const btnWeekly = `${btn} border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100`;
  const btnPlain = `${btn} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={close}>
      <div
        className="bg-white rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[85vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* رأس المحرّر */}
        <div className="flex items-start justify-between gap-3 px-5 py-3.5 border-b border-slate-100">
          <div className="min-w-0">
            <h3 className="font-bold text-slate-800 text-sm">
              {WEEK_TITLES[week]} — {dayLabel} — {sectionLabel}{isSnack ? ' (سناك)' : ''}
            </h3>
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
              {row ? (
                <>
                  <span className="font-semibold text-slate-700">
                    {row.kind === 'removed' ? row.originalMeal?.name : row.meal?.name}
                  </span>
                  <ScopeBadge scope={row.scope} />
                  {row.kind === 'replaced' && row.originalMeal && (
                    <span className="text-slate-400">بدل <span className="line-through text-red-500">{row.originalMeal.name}</span></span>
                  )}
                  {row.kind === 'removed' && <span className="text-red-500 font-semibold">مرفوع بلا بديل</span>}
                </>
              ) : <span className="text-slate-400">خانة فاضية</span>}
            </p>
          </div>
          <button type="button" onClick={close}
            className="shrink-0 w-8 h-8 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-lg">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {mode === 'home' && (
            <>
              {/* أوامر على صنف موجود */}
              {row && anchorId && (row.kind === 'kept' || row.kind === 'replaced' || row.kind === 'removed') && (
                <div className="space-y-2">
                  <p className="text-[11px] font-bold text-slate-400">تبديل الصنف</p>
                  <button type="button" className={btnSlot} disabled={slotDisabled}
                    onClick={() => setMode('swap-slot')}
                    title={slotDisabled ? 'يحتاج تشغيل ملف الترقية' : undefined}>
                    بدّله في هذا اليوم فقط
                    <span className="block text-[11px] font-normal opacity-70 mt-0.5">
                      {WEEK_TITLES[week]} — {dayLabel} وحده. لا يظهر في تبويب المحظورات.
                    </span>
                  </button>
                  <button type="button" className={btnGlobal} onClick={() => setMode('swap-global')}>
                    بدّله في كل الأيام
                    <span className="block text-[11px] font-normal opacity-70 mt-0.5">
                      يسري على {globalReach} خانة في المنيو · يظهر في تبويب «المحظورات»
                    </span>
                  </button>

                  <p className="text-[11px] font-bold text-slate-400 pt-2">حذف الصنف (بلا بديل)</p>
                  <button type="button" className={btnSlot} disabled={slotDisabled} onClick={applySlotRemove}>
                    احذفه من هذا اليوم فقط
                  </button>
                  <button type="button" className={btnGlobal} onClick={applyGlobalRemove}>
                    احذفه من كل الأيام
                    <span className="block text-[11px] font-normal opacity-70 mt-0.5">
                      يظهر في تبويب «المحظورات» بلا بديل
                    </span>
                  </button>

                  {/* إلغاء القرار القائم */}
                  {row.scope === 'slot' && (
                    <button type="button" className={btnPlain}
                      onClick={() => { actions.clearSlotOverride(slot, anchorId); close(); }}>
                      ↺ ألغِ قرار هذا اليوم — ورجّع الصنف الأصلي
                    </button>
                  )}
                  {row.scope === 'global' && (
                    <button type="button" className={btnPlain}
                      onClick={() => { actions.clearGlobalExclusion(anchorId); close(); }}>
                      ↺ ألغِ المحظور العام — يرجع الصنف في كل الأيام
                    </button>
                  )}
                </div>
              )}

              {/* أوامر على صنف ثابت أسبوعي */}
              {row && anchorId && row.kind === 'fixed' && (
                <div className="space-y-2">
                  <p className="text-[11px] font-bold text-slate-400">صنف ثابت أسبوعي</p>
                  <div className="flex items-center justify-between gap-2 border border-slate-200 rounded-lg px-3 py-2">
                    <span className="text-sm text-slate-600">الكمية</span>
                    <div className="flex items-center gap-2">
                      <button type="button" className="w-7 h-7 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold"
                        onClick={() => actions.setWeeklyFixedQuantity(anchorId, mealType, Math.max(1, row.quantity - 1))}>−</button>
                      <span className="text-sm font-bold text-slate-800 w-6 text-center">{row.quantity}</span>
                      <button type="button" className="w-7 h-7 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold"
                        onClick={() => actions.setWeeklyFixedQuantity(anchorId, mealType, Math.min(99, row.quantity + 1))}>+</button>
                    </div>
                  </div>
                  <button type="button" className={btnSlot} disabled={slotDisabled} onClick={applySlotRemove}>
                    احذفه من {WEEK_TITLES[week]} فقط
                  </button>
                  <button type="button" className={btnWeekly}
                    onClick={() => { actions.removeWeeklyFixedDay(anchorId, mealType, day); close(); }}>
                    احذفه من كل {dayLabel}
                    <span className="block text-[11px] font-normal opacity-70 mt-0.5">
                      يُحدَّث في تبويب «الثابتة الأسبوعية»
                    </span>
                  </button>
                  <button type="button" className={btnSlot} disabled={slotDisabled} onClick={() => setMode('swap-slot')}>
                    بدّله بصنف آخر في هذا اليوم فقط
                  </button>
                </div>
              )}

              {/* أوامر على صنف مضاف لهذه الخانة */}
              {row && anchorId && row.kind === 'added' && (
                <div className="space-y-2">
                  <p className="text-[11px] font-bold text-slate-400">صنف مضاف لهذه الخانة</p>
                  <div className="flex items-center justify-between gap-2 border border-slate-200 rounded-lg px-3 py-2">
                    <span className="text-sm text-slate-600">الكمية</span>
                    <div className="flex items-center gap-2">
                      <button type="button" className="w-7 h-7 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold"
                        onClick={() => actions.setSlotOverride({
                          ...slot, action: 'add', base_meal_id: null, target_meal_id: anchorId,
                          quantity: Math.max(1, row.quantity - 1), is_alternative: row.isAlternativeFixed,
                        })}>−</button>
                      <span className="text-sm font-bold text-slate-800 w-6 text-center">{row.quantity}</span>
                      <button type="button" className="w-7 h-7 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold"
                        onClick={() => actions.setSlotOverride({
                          ...slot, action: 'add', base_meal_id: null, target_meal_id: anchorId,
                          quantity: Math.min(99, row.quantity + 1), is_alternative: row.isAlternativeFixed,
                        })}>+</button>
                    </div>
                  </div>
                  <button type="button" className={btnPlain}
                    onClick={() => actions.setSlotOverride({
                      ...slot, action: 'add', base_meal_id: null, target_meal_id: anchorId,
                      quantity: row.quantity, is_alternative: !row.isAlternativeFixed,
                    })}>
                    {row.isAlternativeFixed ? '✓ يُحتسب مع البدائل' : 'يُحتسب مع الأصناف الثابتة'}
                    <span className="block text-[11px] font-normal opacity-70 mt-0.5">اضغط للتبديل</span>
                  </button>
                  <button type="button" className={btnPlain}
                    onClick={() => { actions.clearSlotOverride(slot, anchorId); close(); }}>
                    ↺ احذف هذه الإضافة
                  </button>
                </div>
              )}

              {/* إضافة صنف — متاحة دائماً */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <p className="text-[11px] font-bold text-slate-400">إضافة صنف لهذا المستفيد</p>
                <button type="button" className={btnSlot} disabled={slotDisabled} onClick={() => setMode('add-slot')}>
                  أضف صنفاً في {WEEK_TITLES[week]} — {dayLabel} فقط
                </button>
                <button type="button" className={btnWeekly} onClick={() => setMode('add-weekly')}>
                  أضف صنفاً كل {dayLabel} (الأسابيع الأربعة)
                  <span className="block text-[11px] font-normal opacity-70 mt-0.5">
                    يظهر في تبويب «الثابتة الأسبوعية»
                  </span>
                </button>
              </div>
            </>
          )}

          {(mode === 'swap-slot' || mode === 'swap-global') && (
            <div className="space-y-3">
              <div className={`text-xs font-semibold px-3 py-2 rounded-lg border ${
                mode === 'swap-slot'
                  ? 'border-violet-200 bg-violet-50 text-violet-700'
                  : 'border-red-200 bg-red-50 text-red-700'
              }`}>
                {mode === 'swap-slot'
                  ? `البديل يسري على ${WEEK_TITLES[week]} — ${dayLabel} فقط`
                  : `البديل يسري على كل الأيام (${globalReach} خانة) ويظهر في تبويب المحظورات`}
              </div>
              <MealList
                meals={otherThanCurrent}
                emptyHint={`لا يوجد ${isSnack ? 'سناكات' : 'أصناف'} أخرى في هذه الوجبة`}
                onPick={mode === 'swap-slot' ? applySlotReplace : applyGlobalReplace}
              />
              <button type="button" className={btnPlain} onClick={() => setMode('home')}>رجوع</button>
            </div>
          )}

          {(mode === 'add-slot' || mode === 'add-weekly') && (
            <div className="space-y-3">
              <div className={`text-xs font-semibold px-3 py-2 rounded-lg border ${
                mode === 'add-slot'
                  ? 'border-violet-200 bg-violet-50 text-violet-700'
                  : 'border-teal-200 bg-teal-50 text-teal-700'
              }`}>
                {mode === 'add-slot'
                  ? `الإضافة في ${WEEK_TITLES[week]} — ${dayLabel} فقط`
                  : `الإضافة كل ${dayLabel} في الأسابيع الأربعة — تظهر في تبويب الثابتة الأسبوعية`}
              </div>

              <div className="flex items-center justify-between gap-2 border border-slate-200 rounded-lg px-3 py-2">
                <span className="text-sm text-slate-600">الكمية</span>
                <div className="flex items-center gap-2">
                  <button type="button" className="w-7 h-7 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold"
                    onClick={() => setQty(q => Math.max(1, q - 1))}>−</button>
                  <span className="text-sm font-bold text-slate-800 w-6 text-center">{qty}</span>
                  <button type="button" className="w-7 h-7 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold"
                    onClick={() => setQty(q => Math.min(99, q + 1))}>+</button>
                </div>
              </div>

              <label className="flex items-center gap-2.5 cursor-pointer select-none px-3">
                <input type="checkbox" checked={isAlt} onChange={e => setIsAlt(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                <span className="text-sm text-slate-700">
                  يُحتسب مع الأصناف البديلة في أمر التشغيل
                  <span className="block text-[11px] text-slate-400">بدل جدول الأصناف اليومية الثابتة</span>
                </span>
              </label>

              <MealList
                meals={candidates}
                emptyHint={`لا يوجد ${isSnack ? 'سناكات' : 'أصناف'} في هذه الوجبة`}
                onPick={mode === 'add-slot' ? applySlotAdd : applyWeeklyAdd}
              />
              <button type="button" className={btnPlain} onClick={() => setMode('home')}>رجوع</button>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
          <p className="text-[11px] text-slate-500">
            التعديل يظهر فوراً في الشبكة والتبويبات — ويُحفظ في القاعدة بزر «حفظ التعديلات» أسفل النافذة.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function BeneficiaryMenuTab({
  entityType, meals, exclusions, fixed, overrides, overridesReady = true,
  overridesTableMissing = false, actions, beneficiaryName,
}: Props) {
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [extraMeals, setExtraMeals] = useState<Meal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [week, setWeek] = useState<WeekNumber>(1);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const canEdit = !!actions;

  // قراءة أصناف المنيو لهذه الفئة — بنفس سلسلة الإسقاط المستخدمة في صفحة
  // قائمة الطعام: أي عمود ناقص (الترقية ما اتشغّلت) يُسقط وتُعاد المحاولة.
  useEffect(() => {
    let cancelled = false;

    const fetchItems = (withEntity: boolean, withMealCategory: boolean) => {
      const mealCols = `id, name, english_name, type, is_snack${withMealCategory ? ', category' : ''}`;
      return fetchAllRows((from, to) => {
        const q = supabase
          .from('menu_items')
          .select(`id, week_number, day_of_week, meal_type, meal_id, category, position, created_at, meals(${mealCols})`)
          .order('id')
          .range(from, to);
        return withEntity ? q.eq('entity_type', entityType) : q;
      });
    };

    (async () => {
      setLoading(true);
      setError('');
      let res = await fetchItems(true, true);
      if (res.error && /category|column/i.test(res.error.message)) {
        res = await fetchItems(true, false);
      }
      if (res.error && /entity_type|column/i.test(res.error.message)) {
        // ترقية المرافقين ما اتشغّلت — منيو المرافقين غير متاح، ولا نعرض منيو
        // المستفيدين مكانه عشان ما نضلّل المستخدم.
        if (entityType === 'companion') {
          if (!cancelled) {
            setError('منيو المرافقين يحتاج تشغيل ملف الترقية: supabase/companions-meals-migration.sql');
            setMenuItems([]);
            setLoading(false);
          }
          return;
        }
        res = await fetchItems(false, true);
        if (res.error && /category|column/i.test(res.error.message)) {
          res = await fetchItems(false, false);
        }
      }
      if (cancelled) return;
      if (res.error || !res.data) {
        setError('تعذّرت قراءة قائمة الطعام — تحقق من الاتصال ثم أعد فتح النافذة');
        setMenuItems([]);
      } else {
        setMenuItems(res.data as unknown as MenuItem[]);
      }
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [entityType]);

  // أصناف قد تكون خارج قائمة الصفحة (بديل أو صنف ثابت من فئة أخرى مثلاً) —
  // نقرأ أسماءها وحدها عشان ما يظهر الصف بـ«—».
  // `requestedRef` يمنع إعادة الطلب بلا نهاية لمعرّف ما رجع من القاعدة (صنف محذوف).
  const requestedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const known = new Set(meals.map(m => m.id));
    const missing = new Set<string>();
    const want = (id: string | null | undefined) => {
      if (!id || known.has(id) || requestedRef.current.has(id)) return;
      missing.add(id);
    };
    for (const ex of exclusions) want(ex.alternative_meal_id);
    for (const fe of fixed) {
      want(fe.meal_id);
      for (const sid of fe.suppress_if_meal_ids ?? []) want(sid);
    }
    if (missing.size === 0) return;

    const ids = Array.from(missing);
    for (const id of ids) requestedRef.current.add(id);

    let cancelled = false;
    (async () => {
      const fetchMeals = (withCategory: boolean) => supabase
        .from('meals')
        .select(`id, name, english_name, type, is_snack${withCategory ? ', category' : ''}`)
        .in('id', ids);

      let r = await fetchMeals(true);
      if (r.error && /category|column/i.test(r.error.message)) {
        r = await fetchMeals(false);
      }
      const rows = r.data as unknown as Meal[] | null;
      if (cancelled || r.error || !rows || rows.length === 0) return;
      setExtraMeals(prev => [...prev, ...rows]);
    })();
    return () => { cancelled = true; };
  }, [meals, exclusions, fixed]);

  const mealById = useMemo(() => {
    const m = new Map<string, Meal>();
    for (const meal of meals) m.set(meal.id, meal);
    // الأصناف المقروءة إضافياً تكمّل الناقص ولا تطمس قائمة الصفحة
    for (const meal of extraMeals) if (!m.has(meal.id)) m.set(meal.id, meal);
    // الأصناف المضمّنة مع صفوف المنيو — آخر شبكة أمان للأسماء
    for (const item of menuItems) if (item.meals && !m.has(item.meal_id)) m.set(item.meal_id, item.meals);
    return (id: string) => m.get(id);
  }, [meals, extraMeals, menuItems]);

  const slotMap = useMemo(() => buildSlotMap(menuItems), [menuItems]);

  /**
   * شبكة الأسبوع المعروض: لكل وجبة، صفوف أساسية وصفوف سناك مفهرسة بـ(اليوم × الصف)
   * — نفس تقسيم صفحة قائمة الطعام. عدد الصفوف = العدد الثابت في الصفحة، ويزيد
   * تلقائياً لو خانة فيها أصناف أكثر (أصناف ثابتة مثلاً) عشان ما يختفي شيء.
   */
  const grid = useMemo(() => MEAL_SECTIONS.map(section => {
    const byDay = MENU_DAYS.map(d => buildPersonalMenuSlot({
      week, day: d.value, mealType: section.meal_type,
      slotMap, exclusions, fixed, overrides, mealById,
    }));
    return {
      ...section,
      byDay,
      mainRows:  Math.max(MAIN_ROWS_PER_MEAL,  ...byDay.map(s => s.mains.length)),
      snackRows: Math.max(SNACK_ROWS_PER_MEAL, ...byDay.map(s => s.snacks.length)),
    };
  }), [week, slotMap, exclusions, fixed, overrides, mealById]);

  // ملخّص كل يوم في ذيل الجدول: ياكل / بدائل / بلا بديل
  const dayTallies = useMemo(() => MENU_DAYS.map((_, dayIdx) =>
    tallyPersonalMenuRows(grid.flatMap(s => [...s.byDay[dayIdx].mains, ...s.byDay[dayIdx].snacks]))
  ), [grid]);

  const hasMenu = menuItems.length > 0;
  const today = todayDayOfWeek();

  return (
    <div className="p-5 space-y-3">
      {/* شرح */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5">
        <p className="text-xs text-slate-600 leading-relaxed">
          منيو {beneficiaryName?.trim() ? <span className="font-semibold text-slate-800">{beneficiaryName}</span> : 'هذا المستفيد'} —
          نفس شبكة صفحة <span className="font-semibold">قائمة الطعام</span> بالضبط، ومحظوراته مستبدلة ببدائله.
          {canEdit && <span className="text-emerald-700 font-semibold"> اضغط أي خانة لتعديلها.</span>}
        </p>
        <p className="text-[11px] text-slate-400 mt-1">
          {canEdit
            ? 'التعديل «كل الأيام» يظهر في تبويب المحظورات، و«كل نفس اليوم» في تبويب الثابتة الأسبوعية — والعكس صحيح. لا شيء يُكتب في القاعدة قبل «حفظ التعديلات».'
            : 'يعتمد على المحظورات والأصناف الثابتة كما هي في هذه النافذة الآن — حتى قبل الحفظ.'}
        </p>
      </div>

      {/* دليل الألوان */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="px-2 py-0.5 rounded-full border border-slate-200 bg-white text-slate-600">صنف عادي</span>
        <span className="px-2 py-0.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 font-semibold">بديل</span>
        <span className="px-2 py-0.5 rounded-full border border-red-200 bg-red-50 text-red-600 font-semibold">محظور بلا بديل</span>
        <span className="px-2 py-0.5 rounded-full border border-teal-200 bg-teal-50 text-teal-700 font-semibold">صنف ثابت (كل نفس اليوم)</span>
        <span className="px-2 py-0.5 rounded-full border border-violet-200 bg-violet-50 text-violet-700 font-semibold">مضاف (هذا اليوم فقط)</span>
      </div>

      {overridesTableMissing && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-2.5 text-xs leading-relaxed">
          ⚠️ تعديلات «هذا اليوم فقط» معطّلة حتى تشغّل ملف الترقية مرة واحدة في Supabase SQL Editor:
          <span className="font-mono mx-1">supabase/beneficiary-menu-overrides-migration.sql</span>
          — أما «كل الأيام» و«كل نفس اليوم» فتعمل الآن.
        </div>
      )}
      {!overridesReady && (
        <div className="bg-slate-50 border border-slate-200 text-slate-500 rounded-xl px-4 py-2 text-xs">
          جاري قراءة تعديلات هذا المستفيد…
        </div>
      )}

      {/* تبويبات الأسابيع — نفس صفحة قائمة الطعام */}
      <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto">
        {WEEK_NUMBERS.map(w => (
          <button
            key={w}
            type="button"
            onClick={() => setWeek(w)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px whitespace-nowrap ${
              week === w ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {WEEK_TITLES[w]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="animate-spin w-7 h-7 border-2 border-emerald-500 border-t-transparent rounded-full" />
        </div>
      ) : error ? (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm">⚠️ {error}</div>
      ) : !hasMenu ? (
        <div className="border border-dashed border-slate-200 rounded-xl py-10 text-center text-slate-400 text-sm">
          قائمة الطعام فاضية — عبّها من صفحة «قائمة الطعام» ثم ارجع هنا
        </div>
      ) : (
        /* ── نفس جدول صفحة قائمة الطعام: أعمدة الأيام × صفوف الوجبات ── */
        <div className="border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-center min-w-[900px]">
            <thead>
              <tr className="bg-slate-50">
                {MENU_DAYS.map(d => (
                  <th
                    key={d.value}
                    className={`border border-slate-200 px-3 py-2 text-sm font-bold ${
                      d.value === today ? 'bg-emerald-100 text-emerald-800' : 'text-slate-700'
                    }`}
                  >
                    {d.label}
                    {d.value === today && <span className="block text-[10px] font-normal opacity-70">اليوم</span>}
                  </th>
                ))}
                <th className="border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 w-20">
                  اليوم
                </th>
              </tr>
            </thead>
            <tbody>
              {grid.flatMap(section => {
                const sectionTheme = section.meal_type === 'breakfast'
                  ? 'bg-yellow-50 text-yellow-800'
                  : section.meal_type === 'lunch'
                    ? 'bg-emerald-50 text-emerald-800'
                    : 'bg-rose-50 text-rose-800';

                return [
                  // الصفوف الأساسية
                  ...Array.from({ length: section.mainRows }, (_, rowIdx) => (
                    <tr key={`${section.meal_type}-main-${rowIdx}`} className="hover:bg-slate-50/40">
                      {MENU_DAYS.map((d, dayIdx) => (
                        <td key={d.value} className="border border-slate-200 align-middle p-0">
                          <Cell
                            row={section.byDay[dayIdx].mains[rowIdx] ?? null}
                            onEdit={canEdit ? () => setEditing({
                              week, day: d.value, mealType: section.meal_type, isSnack: false,
                              row: section.byDay[dayIdx].mains[rowIdx] ?? null,
                            }) : undefined}
                          />
                        </td>
                      ))}
                      {rowIdx === 0 && (
                        <td
                          rowSpan={section.mainRows}
                          className={`border border-slate-200 align-middle font-bold text-sm w-20 ${sectionTheme}`}
                          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                        >
                          {section.label}
                        </td>
                      )}
                    </tr>
                  )),
                  // صفوف السناك
                  ...Array.from({ length: section.snackRows }, (_, rowIdx) => (
                    <tr key={`${section.meal_type}-snack-${rowIdx}`} className="bg-amber-50/60">
                      {MENU_DAYS.map((d, dayIdx) => (
                        <td key={d.value} className="border border-slate-200 align-middle p-0">
                          <Cell
                            row={section.byDay[dayIdx].snacks[rowIdx] ?? null}
                            onEdit={canEdit ? () => setEditing({
                              week, day: d.value, mealType: section.meal_type, isSnack: true,
                              row: section.byDay[dayIdx].snacks[rowIdx] ?? null,
                            }) : undefined}
                          />
                        </td>
                      ))}
                      {rowIdx === 0 && (
                        <td
                          rowSpan={section.snackRows}
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
            {/* ملخّص كل يوم — ياكل / بدائل / بلا بديل */}
            <tfoot>
              <tr className="bg-slate-50">
                {MENU_DAYS.map((d, dayIdx) => {
                  const t = dayTallies[dayIdx];
                  return (
                    <td key={d.value} className="border border-slate-200 px-2 py-1.5">
                      <div className="flex items-center justify-center gap-1 flex-wrap text-[10px] font-semibold">
                        <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
                          ياكل {t.eats}
                        </span>
                        {t.replaced > 0 && (
                          <span className="text-teal-700 bg-teal-50 border border-teal-200 rounded px-1.5 py-0.5">
                            بدائل {t.replaced}
                          </span>
                        )}
                        {t.missing > 0 && (
                          <span className="text-red-600 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">
                            بلا بديل {t.missing}
                          </span>
                        )}
                      </div>
                    </td>
                  );
                })}
                <td className="border border-slate-200 px-2 py-1.5 text-[11px] font-bold text-slate-500 w-20">
                  الملخّص
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {editing && actions && (
        <CellEditor
          editing={editing}
          meals={meals}
          slotMap={slotMap}
          actions={actions}
          slotDisabled={overridesTableMissing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
