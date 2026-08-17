'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase-client';
import { fetchAllRows } from '@/lib/fetch-all';
import type { Meal, ItemCategory, MenuItem, EntityType } from '@/lib/types';
import {
  WEEK_NUMBERS, WEEK_TITLES, MENU_DAYS, MEAL_SECTIONS,
  MAIN_ROWS_PER_MEAL, SNACK_ROWS_PER_MEAL,
  buildSlotMap, type WeekNumber,
} from '@/lib/menu-utils';
import {
  buildPersonalMenuSlot,
  tallyPersonalMenuRows,
  type PersonalMenuExclusion,
  type PersonalMenuFixed,
  type PersonalMenuRow,
} from '@/lib/beneficiary-menu';

/**
 * تبويب «المنيو» داخل نافذة المستفيد — عرض فقط.
 *
 * الشكل مطابق لشبكة صفحة قائمة الطعام (أعمدة الأيام × صفوف الوجبات + صفوف
 * السناك) عشان القراءة تكون بنفس العين، لكن المحتوى مخصّص لهذا المستفيد:
 * محظوراته مستبدلة ببدائله. لا يكتب هذا الملف أي صف في القاعدة.
 *
 * المحظورات والأصناف الثابتة تُقرأ من حالة النافذة الحالية (لا من القاعدة) —
 * فأي تعديل في تبويب المحظورات ينعكس هنا فوراً قبل الحفظ.
 */

interface Props {
  entityType: EntityType;
  /** قاعدة أصناف نفس الفئة — نفس القائمة التي تستعملها بقية التبويبات */
  meals: Meal[];
  exclusions: PersonalMenuExclusion[];
  fixed: PersonalMenuFixed[];
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
function Cell({ row }: { row: PersonalMenuRow | null }) {
  if (!row) return <div className="w-full h-full min-h-[34px]" />;

  const theme = CATEGORY_THEME[row.category];
  const icon = (
    <span className={`shrink-0 text-sm leading-none w-5 h-5 flex items-center justify-center rounded ${theme.bg} ${theme.text}`}>
      {theme.icon}
    </span>
  );

  // محظور بلا بديل → الخانة فاضية، واسم الصنف الأساسي بخط أحمر
  if (row.kind === 'removed') {
    return (
      <div className="flex items-center gap-1 px-2 py-1.5 bg-red-50/50 min-h-[34px]" title={`${row.originalMeal?.name ?? ''} — محظور بلا بديل، ما ياكل شيء بدله`}>
        {icon}
        <span className="flex-1 text-right text-sm font-semibold text-red-600 truncate">
          {row.originalMeal?.name ?? '—'}
        </span>
        <span className="shrink-0 text-[9px] font-bold text-red-600 bg-white border border-red-200 rounded px-1 leading-tight">
          بلا بديل
        </span>
      </div>
    );
  }

  if (row.kind === 'replaced') {
    return (
      <div className="flex items-center gap-1 px-2 py-1 bg-emerald-50/50 min-h-[34px]" title={`بديل عن ${row.originalMeal?.name ?? ''}`}>
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
      </div>
    );
  }

  if (row.kind === 'fixed') {
    const cancelled = row.suppressedBy.length > 0;
    return (
      <div
        className={`flex items-center gap-1 px-2 py-1.5 min-h-[34px] ${cancelled ? 'bg-slate-50' : 'bg-teal-50/50'}`}
        title={cancelled
          ? `صنف ثابت يُلغى لوجود ${row.suppressedBy.map(m => m.name).join('، ')} في نفس الوجبة`
          : `صنف ثابت أسبوعي${row.isAlternativeFixed ? ' (محتسب مع البدائل)' : ''}${row.quantity > 1 ? ` — كمية ${row.quantity}` : ''}`}
      >
        {icon}
        <span className={`flex-1 text-right text-sm font-semibold truncate ${cancelled ? 'text-slate-400 line-through' : 'text-teal-800'}`}>
          {row.meal?.name ?? '—'}
          {row.quantity > 1 && !cancelled && <span className="text-[10px] font-bold text-violet-600 mr-1">×{row.quantity}</span>}
        </span>
        <span className={`shrink-0 text-[9px] font-bold bg-white border rounded px-1 leading-tight ${
          cancelled ? 'text-slate-400 border-slate-200' : 'text-teal-700 border-teal-200'
        }`}>
          {cancelled ? 'ملغى' : row.isAlternativeFixed ? 'ثابت·بديل' : 'ثابت'}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 min-h-[34px]">
      {icon}
      <span className="flex-1 text-right text-sm font-medium text-slate-800 truncate">{row.meal?.name ?? '—'}</span>
    </div>
  );
}

export default function BeneficiaryMenuTab({ entityType, meals, exclusions, fixed, beneficiaryName }: Props) {
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [extraMeals, setExtraMeals] = useState<Meal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [week, setWeek] = useState<WeekNumber>(1);

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
      slotMap, exclusions, fixed, mealById,
    }));
    return {
      ...section,
      byDay,
      mainRows:  Math.max(MAIN_ROWS_PER_MEAL,  ...byDay.map(s => s.mains.length)),
      snackRows: Math.max(SNACK_ROWS_PER_MEAL, ...byDay.map(s => s.snacks.length)),
    };
  }), [week, slotMap, exclusions, fixed, mealById]);

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
          <span className="text-slate-400"> عرض فقط: ما يعدّل المنيو ولا أي بيانات.</span>
        </p>
        <p className="text-[11px] text-slate-400 mt-1">
          يعتمد على المحظورات والأصناف الثابتة كما هي في هذه النافذة الآن — حتى قبل الحفظ.
        </p>
      </div>

      {/* دليل الألوان */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="px-2 py-0.5 rounded-full border border-slate-200 bg-white text-slate-600">صنف عادي</span>
        <span className="px-2 py-0.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 font-semibold">بديل</span>
        <span className="px-2 py-0.5 rounded-full border border-red-200 bg-red-50 text-red-600 font-semibold">محظور بلا بديل</span>
        <span className="px-2 py-0.5 rounded-full border border-teal-200 bg-teal-50 text-teal-700 font-semibold">صنف ثابت</span>
      </div>

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
                          <Cell row={section.byDay[dayIdx].mains[rowIdx] ?? null} />
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
                          <Cell row={section.byDay[dayIdx].snacks[rowIdx] ?? null} />
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
    </div>
  );
}
