import type { Meal, MealType, ItemCategory, MenuItem } from '@/lib/types';
import { effectiveCategory, splitSlot, slotKey } from '@/lib/menu-utils';

/**
 * المنيو المخصّص للمستفيد — نفس منيو صفحة قائمة الطعام، وعليه تخصيص هذا
 * المستفيد. هذا الملف هو **المصدر الوحيد** لحساب «ماذا يأكل فلان في خانة
 * معيّنة»، ويُستهلك في:
 *   • شاشة منيو المستفيد (عرض وتحرير)
 *   • أمر التشغيل والتقارير والستيكرات (عبر lib/order-report.ts)
 * وحدة الحساب مقصودة: لو اختلفت الشاشتان في سطر واحد، اختلف المطبخ عن التقرير.
 *
 * ── ثلاث طبقات قرار، الأخص يتقدّم ─────────────────────────────────────────
 *  ١) قرار الخانة (`overrides`): أسبوع + يوم + وجبة محددة. الأقوى.
 *     replace → استبدال صنف ببديل هنا فقط
 *     remove  → حذف صنف هنا فقط
 *     add     → إضافة صنف هنا فقط (بكمية)
 *  ٢) المحظور العام (`exclusions`): يسري على كل خانة فيها الصنف — يُطبَّق فقط
 *     على الأصناف التي لا قرار خانة لها.
 *  ٣) الصنف الثابت الأسبوعي (`fixed`): كل نفس اليوم في الأسابيع الأربعة.
 *
 * دلالات الطبقتين ٢ و٣ مأخوذة حرفياً من `lib/order-report.ts` كما كانت قبل
 * إضافة الطبقة ١ — فما تغيّر شيء لمن ما عنده قرارات خانة.
 */

/** حالة الصف في المنيو المخصّص. */
export type PersonalMenuKind =
  /** صنف من المنيو يأكله كما هو */
  | 'kept'
  /** صنف استُبدل ببديل (قرار خانة أو محظور عام له بديل) */
  | 'replaced'
  /** صنف مرفوع بلا بديل — الخانة فاضية */
  | 'removed'
  /** صنف ثابت أسبوعي (كل نفس اليوم) */
  | 'fixed'
  /** صنف مضاف لهذه الخانة وحدها */
  | 'added';

/**
 * نطاق القرار الذي أنتج الصف — تعرضه الواجهة كشارة، وتحتاجه لتشرح للمستخدم
 * أثر تعديله قبل الحفظ.
 */
export type PersonalMenuScope =
  /** من المنيو المشترك بلا أي تخصيص */
  | 'menu'
  /** قرار خانة: هذا الأسبوع وهذا اليوم فقط */
  | 'slot'
  /** محظور عام: يسري على كل خانة فيها الصنف */
  | 'global'
  /** صنف ثابت: كل نفس اليوم في الأسابيع الأربعة */
  | 'weekly';

export interface PersonalMenuRow {
  /** مفتاح ثابت للعرض (React key) */
  key: string;
  kind: PersonalMenuKind;
  scope: PersonalMenuScope;
  /** الصنف الذي يأكله فعلاً — null فقط في `removed` */
  meal: Meal | null;
  /** الصنف الأساسي في المنيو — يُعرض بالأحمر في `removed` و`replaced` */
  originalMeal: Meal | null;
  category: ItemCategory;
  /** كمية الصنف المضاف/الثابت (1 لغيره) */
  quantity: number;
  /** صنف مضاف/ثابت معلَّم «بديل» — يُحتسب مع البدائل في أمر التشغيل */
  isAlternativeFixed: boolean;
  /** صنف ثابت أُلغي لوجود أحد أصناف `suppress_if_meal_ids` في نفس الخانة */
  suppressedBy: Meal[];
  /**
   * معرّف الصنف الذي يُمسك به هذا الصف عند التحرير: الصنف الأساسي للصفوف
   * القادمة من المنيو، والصنف نفسه للمضاف/الثابت. القرارات تُخزَّن بهذا المفتاح.
   */
  anchorMealId: string | null;
  /** معرّف صف القرار في القاعدة — للتحرير والحذف */
  overrideId?: string | null;
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

/** قرار على خانة واحدة — صف في جدول beneficiary_menu_overrides. */
export interface PersonalMenuOverride {
  id?: string;
  week_number: number;
  day_of_week: number;
  meal_type: MealType;
  action: 'replace' | 'remove' | 'add';
  /** الصنف الأساسي — في replace/remove */
  base_meal_id?: string | null;
  /** البديل أو المضاف — في replace/add */
  target_meal_id?: string | null;
  quantity?: number;
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
  /** قرارات الخانات — كلها، وتُفلتر داخلياً على هذه الخانة */
  overrides?: PersonalMenuOverride[];
  /** قاعدة الأصناف — لأسماء البدائل والأصناف الثابتة */
  mealById: (id: string) => Meal | undefined;
}

function rowCategory(meal: Meal | null | undefined, fallback: ItemCategory): ItemCategory {
  const c = meal?.category;
  if (c === 'hot' || c === 'cold' || c === 'snack') return c;
  if (meal?.is_snack) return 'snack';
  return fallback;
}

/** قرارات خانة واحدة مفهرسة: قرار لكل صنف أساسي + قائمة الإضافات. */
interface SlotOverrides {
  byBase: Map<string, PersonalMenuOverride>;
  adds: PersonalMenuOverride[];
}

function slotOverrides(
  overrides: PersonalMenuOverride[] | undefined,
  week: number, day: number, mealType: MealType,
): SlotOverrides {
  const byBase = new Map<string, PersonalMenuOverride>();
  const adds: PersonalMenuOverride[] = [];
  for (const ov of overrides ?? []) {
    if (ov.week_number !== week || ov.day_of_week !== day || ov.meal_type !== mealType) continue;
    if (ov.action === 'add') {
      if (ov.target_meal_id) adds.push(ov);
      continue;
    }
    // replace/remove — قرار واحد لكل صنف أساسي (القيد في القاعدة يضمنه،
    // وهنا نحسم أي تعارض في بيانات قديمة بأول صف يصل)
    if (ov.base_meal_id && !byBase.has(ov.base_meal_id)) byBase.set(ov.base_meal_id, ov);
  }
  return { byBase, adds };
}

/**
 * يبني صفوف خانة واحدة (أسبوع + يوم + وجبة) من منظور مستفيد واحد.
 * ترتيب الصفوف مطابق لصفحة قائمة الطعام، والمضاف والثابت يُلحقان بنهاية قسمهما.
 */
export function buildPersonalMenuSlot({
  week, day, mealType, slotMap, exclusions, fixed, overrides, mealById,
}: PersonalMenuParams): PersonalMenuSlot {
  const slotItems = slotMap.get(slotKey(week, day, mealType)) ?? [];
  const { mains, snacks } = splitSlot(slotItems);

  // أصناف الخانة كلها (أساسي + سناك) — هي نفسها أصناف أمر التشغيل، وعليها
  // يُحسب إلغاء الصنف الثابت (suppress_if_meal_ids).
  const slotMealIds = new Set(slotItems.map(i => i.meal_id));

  const altByMealId = new Map<string, string | null>();
  for (const ex of exclusions) altByMealId.set(ex.meal_id, ex.alternative_meal_id || null);

  const { byBase, adds } = slotOverrides(overrides, week, day, mealType);

  /**
   * قرار صنف واحد ظاهر في الخانة (سواء جاء من المنيو أو من صنف ثابت):
   * قرار الخانة يتقدّم، ثم المحظور العام، وإلا يبقى كما هو.
   */
  const decide = (mealId: string, current: Meal | null, menuCategory: ItemCategory, keyBase: string, keptKind: 'kept' | 'fixed') => {
    const ov = byBase.get(mealId);
    if (ov) {
      if (ov.action === 'remove') {
        return {
          kind: 'removed' as const, scope: 'slot' as const,
          meal: null, category: menuCategory, overrideId: ov.id ?? null, key: `${keyBase}`,
        };
      }
      const target = ov.target_meal_id ? mealById(ov.target_meal_id) ?? null : null;
      if (target) {
        return {
          kind: 'replaced' as const, scope: 'slot' as const,
          meal: target, category: rowCategory(target, menuCategory), overrideId: ov.id ?? null, key: `${keyBase}`,
        };
      }
      // بديل مفقود (صنف محذوف من القاعدة) — نعامله كحذف بلا بديل بدل إظهار «—»
      return {
        kind: 'removed' as const, scope: 'slot' as const,
        meal: null, category: menuCategory, overrideId: ov.id ?? null, key: `${keyBase}`,
      };
    }

    if (altByMealId.has(mealId)) {
      const altId = altByMealId.get(mealId) ?? null;
      const alt = altId ? mealById(altId) ?? null : null;
      if (!alt) {
        return {
          kind: 'removed' as const, scope: 'global' as const,
          meal: null, category: menuCategory, overrideId: null, key: keyBase,
        };
      }
      return {
        kind: 'replaced' as const, scope: 'global' as const,
        meal: alt, category: rowCategory(alt, menuCategory), overrideId: null, key: keyBase,
      };
    }

    return {
      kind: keptKind, scope: (keptKind === 'fixed' ? 'weekly' : 'menu') as PersonalMenuScope,
      meal: current, category: menuCategory, overrideId: null, key: keyBase,
    };
  };

  const buildRows = (items: MenuItem[]): PersonalMenuRow[] => items.map(item => {
    const original = item.meals ?? mealById(item.meal_id) ?? null;
    const menuCategory = effectiveCategory(item);
    const d = decide(item.meal_id, original, menuCategory, item.id, 'kept');
    return {
      key: d.key,
      kind: d.kind,
      scope: d.scope,
      meal: d.meal,
      originalMeal: original,
      category: d.category,
      quantity: 1,
      isAlternativeFixed: false,
      suppressedBy: [],
      anchorMealId: item.meal_id,
      overrideId: d.overrideId,
    };
  });

  const result: PersonalMenuSlot = { mains: buildRows(mains), snacks: buildRows(snacks) };

  const push = (row: PersonalMenuRow) => {
    if (row.category === 'snack') result.snacks.push(row);
    else result.mains.push(row);
  };

  // الأصناف المضافة لهذه الخانة وحدها
  const addedMealIds = new Set<string>();
  for (const ov of adds) {
    const meal = ov.target_meal_id ? mealById(ov.target_meal_id) ?? null : null;
    if (!meal) continue;
    addedMealIds.add(meal.id);
    push({
      key: ov.id ?? `add:${meal.id}`,
      kind: 'added',
      scope: 'slot',
      meal,
      originalMeal: null,
      category: rowCategory(meal, 'hot'),
      quantity: ov.quantity ?? 1,
      isAlternativeFixed: ov.is_alternative === true,
      suppressedBy: [],
      anchorMealId: meal.id,
      overrideId: ov.id ?? null,
    });
  }

  // الأصناف الثابتة الأسبوعية — تُلحق بنهاية قسمها (أساسي أو سناك) حسب فئتها
  for (const fe of fixed) {
    if (fe.meal_type !== mealType) continue;
    let inDay = false;
    for (const d of fe.days) if (d === day) { inDay = true; break; }
    if (!inDay) continue;

    const meal = mealById(fe.meal_id) ?? null;
    if (!meal) continue;

    // نفس الصنف مضاف لهذه الخانة بقرار أخص → القرار يتقدّم، وإلا حُسب مرتين
    if (addedMealIds.has(meal.id)) continue;

    const menuCategory = rowCategory(meal, fe.category ?? 'hot');
    const d = decide(meal.id, meal, menuCategory, `fixed:${fe.meal_id}:${fe.meal_type}`, 'fixed');
    // قرار الخانة على صنف ثابت: حذف أو تبديل لهذا الأسبوع/اليوم وحده
    if (d.kind === 'removed') {
      push({
        key: d.key, kind: 'removed', scope: d.scope, meal: null, originalMeal: meal,
        category: menuCategory, quantity: fe.quantity ?? 1,
        isAlternativeFixed: fe.is_alternative === true, suppressedBy: [],
        anchorMealId: meal.id, overrideId: d.overrideId,
      });
      continue;
    }

    const suppressedBy = (fe.suppress_if_meal_ids ?? [])
      .filter(id => slotMealIds.has(id))
      .map(id => mealById(id))
      .filter((m): m is Meal => !!m);

    push({
      key: d.key,
      kind: d.kind === 'replaced' ? 'replaced' : 'fixed',
      scope: d.scope,
      meal: d.meal,
      originalMeal: d.kind === 'replaced' ? meal : null,
      category: d.category,
      quantity: fe.quantity ?? 1,
      isAlternativeFixed: fe.is_alternative === true,
      suppressedBy,
      anchorMealId: meal.id,
      overrideId: d.overrideId,
    });
  }

  return result;
}

/** ملخّص يوم واحد: ماذا يأكل وماذا لا يأكل. */
export interface PersonalMenuDayTally {
  /** عدد الأصناف التي يأكلها فعلاً (بلا الملغى) */
  eats: number;
  /** عدد الأصناف المرفوعة بلا بديل */
  missing: number;
  /** عدد الأصناف المستبدلة ببديل */
  replaced: number;
  /** عدد الأصناف المضافة لهذه الخانة وحدها */
  added: number;
}

export function tallyPersonalMenuRows(rows: PersonalMenuRow[]): PersonalMenuDayTally {
  let eats = 0, missing = 0, replaced = 0, added = 0;
  for (const r of rows) {
    if (r.kind === 'removed') { missing++; continue; }
    if (r.kind === 'fixed' && r.suppressedBy.length > 0) continue;
    eats++;
    if (r.kind === 'replaced') replaced++;
    if (r.kind === 'added') added++;
  }
  return { eats, missing, replaced, added };
}

// ─── طبقة أمر التشغيل ────────────────────────────────────────────────────────

export interface OrderOverlayParams {
  /** رقم أسبوع الأمر — `null`/`undefined` في الأوامر القديمة */
  week: number | null | undefined;
  day: number;
  mealType: MealType;
  /** أصناف الأمر كما هي في order_items */
  orderMealIds: string[];
  exclusions: PersonalMenuExclusion[];
  overrides?: PersonalMenuOverride[];
}

export interface OrderOverlayResult {
  /** ما يُستبعد من هذا المستفيد، مع بديله (null = بلا بديل) */
  excluded: { meal_id: string; alternative_meal_id: string | null; scope: 'slot' | 'global' }[];
  /** أصناف مضافة لهذه الخانة وحدها */
  added: { meal_id: string; quantity: number; is_alternative: boolean }[];
  /**
   * قرارات الخانة على الأصناف الثابتة الأسبوعية:
   * removed → لا يُحتسب في هذا الأمر، replacedWith → يُحتسب البديل مكانه.
   */
  fixedDecisions: Map<string, { removed: boolean; replacedWith: string | null }>;
}

/**
 * يحوّل تخصيص مستفيد واحد إلى قرارات جاهزة لأمر تشغيل واحد.
 *
 * ⚠️ ضمانة عدم الانحدار: لو الأمر ما يحمل رقم أسبوع (أوامر قديمة قبل
 * order-week-migration) نتجاهل قرارات الخانات تماماً ونرجّع المحظورات العامة
 * وحدها — أي **نفس** سلوك النظام قبل هذه الميزة، حرفياً.
 */
export function buildOrderOverlay({
  week, day, mealType, orderMealIds, exclusions, overrides,
}: OrderOverlayParams): OrderOverlayResult {
  const hasSlot = typeof week === 'number' && week >= 1 && week <= 4;
  const { byBase, adds } = hasSlot
    ? slotOverrides(overrides, week as number, day, mealType)
    : { byBase: new Map<string, PersonalMenuOverride>(), adds: [] as PersonalMenuOverride[] };

  const orderIds = new Set(orderMealIds);
  const excluded: OrderOverlayResult['excluded'] = [];
  const fixedDecisions: OrderOverlayResult['fixedDecisions'] = new Map();

  // ① قرارات الخانة — تسري على أصناف الأمر وعلى الأصناف الثابتة
  for (const [baseId, ov] of byBase) {
    const decision = {
      removed: ov.action === 'remove' || !ov.target_meal_id,
      replacedWith: ov.action === 'replace' ? ov.target_meal_id ?? null : null,
    };
    if (orderIds.has(baseId)) {
      excluded.push({ meal_id: baseId, alternative_meal_id: decision.replacedWith, scope: 'slot' });
    }
    // الصنف الثابت ليس من أصناف الأمر — قراره يُمرَّر للمستدعي ليطبّقه
    fixedDecisions.set(baseId, decision);
  }

  // ② المحظور العام — فقط لما ما فيه قرار خانة لهذا الصنف
  for (const ex of exclusions) {
    if (byBase.has(ex.meal_id)) continue;
    if (!orderIds.has(ex.meal_id)) continue;
    excluded.push({
      meal_id: ex.meal_id,
      alternative_meal_id: ex.alternative_meal_id || null,
      scope: 'global',
    });
  }

  // ③ الإضافات الخاصة بهذه الخانة
  const added = adds
    .filter(ov => !!ov.target_meal_id)
    .map(ov => ({
      meal_id: ov.target_meal_id as string,
      quantity: ov.quantity ?? 1,
      is_alternative: ov.is_alternative === true,
    }));

  return { excluded, added, fixedDecisions };
}

/**
 * الخانات التي يظهر فيها صنف معيّن في المنيو — تُستخدم لتحذير المستخدم قبل
 * الحفظ: «هذا المحظور العام يسري على ٣ خانات» مقابل قرار الخانة الواحدة.
 */
export function slotsContainingMeal(
  slotMap: Map<string, MenuItem[]>,
  mealId: string,
): { week: number; day: number; mealType: MealType }[] {
  const out: { week: number; day: number; mealType: MealType }[] = [];
  for (const [key, items] of slotMap) {
    if (!items.some(i => i.meal_id === mealId)) continue;
    const [w, d, mt] = key.split('|');
    out.push({ week: Number(w), day: Number(d), mealType: mt as MealType });
  }
  return out;
}
