import type { Meal, MealType, ItemCategory, MenuItem } from '@/lib/types';
import { effectiveCategory, splitSlot, slotKey } from '@/lib/menu-utils';

/**
 * المنيو المخصّص للمستفيد — نفس منيو صفحة قائمة الطعام، لكن محظورات هذا
 * المستفيد مستبدلة ببدائله هو. عرض فقط: ما يكتب ولا يعدّل أي صف في القاعدة.
 *
 * الدلالات مأخوذة حرفياً من `lib/order-report.ts` عشان اللي يظهر هنا هو نفسه
 * اللي يطلع في أمر التشغيل:
 *   • الصنف المحظور: يُستبعد، ويحل مكانه `alternative_meal_id` إن وُجد.
 *   • الصنف المحظور بلا بديل: الخانة تصير فاضية (`kind = 'removed'`).
 *   • الصنف الثابت الأسبوعي: يظهر لو `day_of_week` و`meal_type` يطابقان الخانة،
 *     ويُلغى لو أحد `suppress_if_meal_ids` موجود في أصناف نفس الخانة.
 */

/** حالة الصف في المنيو المخصّص. */
export type PersonalMenuKind =
  /** صنف من المنيو يأكله كما هو */
  | 'kept'
  /** صنف محظور استُبدل ببديل هذا المستفيد */
  | 'replaced'
  /** صنف محظور بلا بديل — الخانة فاضية */
  | 'removed'
  /** صنف ثابت أسبوعي خاص بهذا المستفيد */
  | 'fixed';

export interface PersonalMenuRow {
  /** مفتاح ثابت للعرض (React key) */
  key: string;
  kind: PersonalMenuKind;
  /** الصنف الذي يأكله فعلاً — null فقط في `removed` */
  meal: Meal | null;
  /** الصنف الأساسي في المنيو — يُعرض بالأحمر في `removed` و`replaced` */
  originalMeal: Meal | null;
  category: ItemCategory;
  /** كمية الصنف الثابت (1 لغيره) */
  quantity: number;
  /** صنف ثابت معلَّم «بديل» — يُحتسب مع البدائل في أمر التشغيل */
  isAlternativeFixed: boolean;
  /** صنف ثابت أُلغي لوجود أحد أصناف `suppress_if_meal_ids` في نفس الخانة */
  suppressedBy: Meal[];
}

export interface PersonalMenuExclusion {
  meal_id: string;
  alternative_meal_id?: string | null;
}

export interface PersonalMenuFixed {
  meal_id: string;
  meal_type: MealType;
  /** أيام الأسبوع (0..6) */
  days: Iterable<number>;
  quantity?: number;
  category?: ItemCategory;
  suppress_if_meal_ids?: string[];
  is_alternative?: boolean;
}

export interface PersonalMenuSlot {
  /** صفوف القسم الأساسي (حار + بارد) بنفس ترتيب صفحة قائمة الطعام */
  mains: PersonalMenuRow[];
  /** صفوف السناك بنفس ترتيب صفحة قائمة الطعام */
  snacks: PersonalMenuRow[];
}

export interface PersonalMenuParams {
  week: number;
  day: number;
  mealType: MealType;
  /** كل أصناف المنيو لهذه الفئة — تُفلتر داخلياً على (أسبوع، يوم، وجبة) */
  slotMap: Map<string, MenuItem[]>;
  exclusions: PersonalMenuExclusion[];
  fixed: PersonalMenuFixed[];
  /** قاعدة الأصناف — لأسماء البدائل والأصناف الثابتة */
  mealById: (id: string) => Meal | undefined;
}

function rowCategory(meal: Meal | null | undefined, fallback: ItemCategory): ItemCategory {
  const c = meal?.category;
  if (c === 'hot' || c === 'cold' || c === 'snack') return c;
  if (meal?.is_snack) return 'snack';
  return fallback;
}

/**
 * يبني صفوف خانة واحدة (أسبوع + يوم + وجبة) من منظور مستفيد واحد.
 * ترتيب الصفوف مطابق لصفحة قائمة الطعام، والأصناف الثابتة تُلحق في نهاية قسمها.
 */
export function buildPersonalMenuSlot({
  week, day, mealType, slotMap, exclusions, fixed, mealById,
}: PersonalMenuParams): PersonalMenuSlot {
  const slotItems = slotMap.get(slotKey(week, day, mealType)) ?? [];
  const { mains, snacks } = splitSlot(slotItems);

  // أصناف الخانة كلها (أساسي + سناك) — هي نفسها أصناف أمر التشغيل، وعليها
  // يُحسب إلغاء الصنف الثابت (suppress_if_meal_ids).
  const slotMealIds = new Set(slotItems.map(i => i.meal_id));

  const altByMealId = new Map<string, string | null>();
  for (const ex of exclusions) altByMealId.set(ex.meal_id, ex.alternative_meal_id || null);

  const buildRows = (items: MenuItem[]): PersonalMenuRow[] => items.map(item => {
    const original = item.meals ?? mealById(item.meal_id) ?? null;
    const menuCategory = effectiveCategory(item);
    const base = {
      key: item.id,
      originalMeal: original,
      quantity: 1,
      isAlternativeFixed: false,
      suppressedBy: [] as Meal[],
    };

    if (!altByMealId.has(item.meal_id)) {
      return { ...base, kind: 'kept' as const, meal: original, category: menuCategory };
    }

    const altId = altByMealId.get(item.meal_id) ?? null;
    const alt = altId ? mealById(altId) ?? null : null;
    if (!alt) {
      return { ...base, kind: 'removed' as const, meal: null, category: menuCategory };
    }
    return { ...base, kind: 'replaced' as const, meal: alt, category: rowCategory(alt, menuCategory) };
  });

  const result: PersonalMenuSlot = { mains: buildRows(mains), snacks: buildRows(snacks) };

  // الأصناف الثابتة الأسبوعية — تُلحق بنهاية قسمها (أساسي أو سناك) حسب فئتها
  for (const fe of fixed) {
    if (fe.meal_type !== mealType) continue;
    let inDay = false;
    for (const d of fe.days) if (d === day) { inDay = true; break; }
    if (!inDay) continue;

    const meal = mealById(fe.meal_id) ?? null;
    if (!meal) continue;

    const category = rowCategory(meal, fe.category ?? 'hot');
    const suppressedBy = (fe.suppress_if_meal_ids ?? [])
      .filter(id => slotMealIds.has(id))
      .map(id => mealById(id))
      .filter((m): m is Meal => !!m);

    const row: PersonalMenuRow = {
      key: `fixed:${fe.meal_id}:${fe.meal_type}`,
      kind: 'fixed',
      meal,
      originalMeal: null,
      category,
      quantity: fe.quantity ?? 1,
      isAlternativeFixed: fe.is_alternative === true,
      suppressedBy,
    };

    if (category === 'snack') result.snacks.push(row);
    else result.mains.push(row);
  }

  return result;
}

/** ملخّص يوم واحد: ماذا يأكل وماذا لا يأكل. */
export interface PersonalMenuDayTally {
  /** عدد الأصناف التي يأكلها فعلاً (بلا الملغى) */
  eats: number;
  /** عدد الأصناف المحظورة بلا بديل */
  missing: number;
  /** عدد الأصناف المستبدلة ببديل */
  replaced: number;
}

export function tallyPersonalMenuRows(rows: PersonalMenuRow[]): PersonalMenuDayTally {
  let eats = 0, missing = 0, replaced = 0;
  for (const r of rows) {
    if (r.kind === 'removed') { missing++; continue; }
    if (r.kind === 'fixed' && r.suppressedBy.length > 0) continue;
    eats++;
    if (r.kind === 'replaced') replaced++;
  }
  return { eats, missing, replaced };
}
