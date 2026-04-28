import type { SupabaseClient } from '@supabase/supabase-js';
import type { Meal, ItemCategory } from '@/lib/types';

/**
 * Builds the full report payload for an order from CURRENT database state.
 * This is the snapshot computation — calling it twice at different times
 * may produce different results if beneficiaries/exclusions/fixed_meals change.
 *
 * Returns null if the order doesn't exist or has no items.
 */
export async function buildOrderReport(
  supabase: SupabaseClient,
  orderId: string,
): Promise<Record<string, unknown> | null> {
  // نحاول جلب meals.category أولاً (المصدر الأساسي للتصنيف). لو الـmigration
  // ما اتشغّل، نرجع للسلوك القديم بدون العمود.
  const fetchOrder = async (withMealCategory: boolean) =>
    supabase
      .from('daily_orders')
      .select(`*, order_items(id, meal_id, display_name, extra_quantity, category, multiplier, meals(id, name, english_name, type, is_snack${withMealCategory ? ', category' : ''}))`)
      .eq('id', orderId)
      .single();

  let { data: order, error: orderError } = await fetchOrder(true);
  if (orderError && /category|column/i.test(orderError.message)) {
    ({ data: order, error: orderError } = await fetchOrder(false));
  }

  if (orderError || !order) return null;

  const orderItems: { meal_id: string; display_name?: string | null; extra_quantity?: number; category?: string; multiplier?: number; meals: Meal }[] = order.order_items || [];
  if (orderItems.length === 0) return null;

  const mealMap: Record<string, Meal> = {};
  const displayMealMap: Record<string, Meal> = {};
  const extraQtyMap: Record<string, number> = {};
  const categoryMap: Record<string, ItemCategory> = {};
  const multiplierMap: Record<string, number> = {};

  orderItems.forEach(item => {
    mealMap[item.meal_id] = item.meals;
    extraQtyMap[item.meal_id] = item.extra_quantity ?? 0;
    multiplierMap[item.meal_id] = Math.max(1, item.multiplier ?? 1);
    // أولوية التصنيف: (1) meals.category — المصدر الموحد، (2) order_items.category
    // — توافق رجعي، (3) المشتق من is_snack. هذا يضمن الستيكرات تتبع نفس التصنيف
    // أينما ظهر الصنف.
    const mealCat = (item.meals as { category?: ItemCategory }).category;
    categoryMap[item.meal_id] =
      mealCat ?? (item.category as ItemCategory) ?? (item.meals.is_snack ? 'snack' : 'hot');
    displayMealMap[item.meal_id] = item.display_name
      ? { ...item.meals, name: item.display_name }
      : item.meals;
  });

  const orderMealIds = new Set(Object.keys(mealMap));
  // Prefer the explicit day_of_week stored on the order (driven by the menu).
  // For older orders that don't have it set, fall back to deriving it from the date.
  const orderDayOfWeek = (typeof order.day_of_week === 'number' && order.day_of_week >= 0 && order.day_of_week <= 6)
    ? order.day_of_week
    : new Date(order.date).getDay();

  // كل أمر تشغيل يخص فئة معيّنة (مستفيدين أو مرافقين). نقرأ النوع من الأمر،
  // ولو ما كان موجود (أمر قديم قبل الـmigration) نعتبره مستفيدين.
  const orderEntityType: 'beneficiary' | 'companion' =
    (order as { entity_type?: string }).entity_type === 'companion' ? 'companion' : 'beneficiary';

  // Try with the category column on fixed_meals first; if the migration hasn't
  // been run yet, fall back to the older shape so the report still works.
  // Same fallback strategy for the entity_type filter on beneficiaries.
  const fetchBens = async (withFixedCategory: boolean, withEntityType: boolean, withMealCategory: boolean) => {
    const mealCols = `id, name, english_name, type, is_snack${withMealCategory ? ', category' : ''}`;
    const sel = `*, exclusions(id, meal_id, alternative_meal_id, meals:meals!exclusions_meal_id_fkey(${mealCols})), fixed_meals:beneficiary_fixed_meals(id, day_of_week, meal_type, meal_id, quantity${withFixedCategory ? ', category' : ''}, meals(${mealCols}))`;
    const q = supabase.from('beneficiaries').select(sel).order('name');
    return withEntityType ? q.eq('entity_type', orderEntityType) : q;
  };

  // نحاول كل الأعمدة، ثم نسقط واحدة بواحدة عند ظهور أخطاء العمود/الترقية
  let bensRes = await fetchBens(true, true, true);
  if (bensRes.error && /category|column/i.test(bensRes.error.message)) {
    // إما fixed_meals.category أو meals.category — جرّب الإسقاط بالترتيب
    bensRes = await fetchBens(false, true, true);
    if (bensRes.error && /category|column/i.test(bensRes.error.message)) {
      bensRes = await fetchBens(true, true, false);
      if (bensRes.error && /category|column/i.test(bensRes.error.message)) {
        bensRes = await fetchBens(false, true, false);
      }
    }
  }
  if (bensRes.error && /entity_type|column/i.test(bensRes.error.message)) {
    bensRes = await fetchBens(false, false, false);
  }
  // الـquery select ديناميكي فما يقدر TypeScript يستنتج النوع — نعرّف نوع
  // محلّي يطابق شكل الصف ونقصّ النتيجة إليه.
  type BenRow = {
    id: string; name: string; english_name?: string; code: string;
    category: string; villa?: string; diet_type?: string;
    fixed_items?: string; notes?: string; created_at: string;
    exclusions: { id: string; meal_id: string; alternative_meal_id: string | null }[];
    fixed_meals: { id: string; day_of_week: number; meal_type: string; meal_id: string; quantity: number; meals: Meal; category?: string }[];
  };
  const beneficiaries = bensRes.data as unknown as BenRow[] | null;

  if (!beneficiaries || beneficiaries.length === 0) return null;

  const altIds = new Set<string>();
  beneficiaries.forEach((ben: { exclusions: { alternative_meal_id: string | null }[] }) => {
    (ben.exclusions || []).forEach(ex => { if (ex.alternative_meal_id) altIds.add(ex.alternative_meal_id); });
  });

  const altMealMap: Record<string, Meal> = { ...mealMap };
  if (altIds.size > 0) {
    const { data: altMeals } = await supabase
      .from('meals')
      .select('id, name, english_name, type, is_snack')
      .in('id', Array.from(altIds));
    (altMeals || []).forEach((m: { id: string; name: string; english_name?: string; type: string; is_snack: boolean }) => {
      altMealMap[m.id] = m as Meal;
    });
  }

  const mainQty: Record<string, number> = {};
  const altQty: Record<string, number> = {};
  const fixedQty: Record<string, number> = {};
  const allMealDetails: Record<string, Meal> = { ...altMealMap };
  Object.entries(displayMealMap).forEach(([id, m]) => { allMealDetails[id] = m; });

  const beneficiaryDetails = beneficiaries.map((ben: {
    id: string; name: string; english_name?: string; code: string;
    category: string; villa?: string; diet_type?: string;
    fixed_items?: string; notes?: string; created_at: string;
    exclusions: { id: string; meal_id: string; alternative_meal_id: string | null }[];
    fixed_meals: { id: string; day_of_week: number; meal_type: string; meal_id: string; quantity: number; meals: Meal }[];
  }) => {
    const excludedIds = new Set((ben.exclusions || []).map(e => e.meal_id));

    const excludedItems = (ben.exclusions || [])
      .filter(ex => orderMealIds.has(ex.meal_id))
      .map(ex => {
        const meal = displayMealMap[ex.meal_id];
        let alternative: Meal | null = null;
        if (ex.alternative_meal_id && altMealMap[ex.alternative_meal_id]) {
          alternative = altMealMap[ex.alternative_meal_id];
        }
        const category = categoryMap[ex.meal_id] ?? (meal.is_snack ? 'snack' : 'hot');
        return { meal, alternative, category };
      });

    const todayFixed: { meal: Meal; quantity: number; category: ItemCategory }[] = (ben.fixed_meals || [])
      .filter(fm => fm.day_of_week === orderDayOfWeek && fm.meal_type === order.meal_type && fm.meals)
      .map(fm => {
        // أولوية تصنيف الصنف الثابت:
        //   1) meals.category — المصدر الموحد (يضمن نفس الصنف نفس الفئة في كل مكان)
        //   2) قيمة محفوظة على صف fixed_meals (للتوافق الرجعي)
        //   3) تصنيف الصنف داخل أمر التشغيل
        //   4) المشتق من is_snack
        const mealCat = (fm.meals as { category?: ItemCategory }).category;
        const stored = (fm as { category?: ItemCategory }).category;
        return {
          meal: fm.meals,
          quantity: fm.quantity ?? 1,
          category: mealCat ?? stored ?? categoryMap[fm.meal_id] ?? (fm.meals.is_snack ? 'snack' : 'hot'),
        };
      });

    orderItems.forEach(item => {
      if (!excludedIds.has(item.meal_id)) {
        mainQty[item.meal_id] = (mainQty[item.meal_id] || 0) + 1;
        allMealDetails[item.meal_id] = displayMealMap[item.meal_id];
      }
    });
    excludedItems.forEach(({ alternative }) => {
      if (alternative) {
        altQty[alternative.id] = (altQty[alternative.id] || 0) + 1;
        allMealDetails[alternative.id] = alternative;
      }
    });
    todayFixed.forEach(({ meal, quantity }) => {
      fixedQty[meal.id] = (fixedQty[meal.id] || 0) + quantity;
      allMealDetails[meal.id] = meal;
    });

    return {
      beneficiary: {
        id: ben.id, name: ben.name, english_name: ben.english_name,
        code: ben.code, category: ben.category, villa: ben.villa,
        diet_type: ben.diet_type, fixed_items: ben.fixed_items,
        notes: ben.notes, created_at: ben.created_at,
      },
      excludedItems,
      fixedItems: todayFixed,
    };
  });

  const allIds = new Set([...Object.keys(mainQty), ...Object.keys(altQty), ...Object.keys(fixedQty)]);
  const itemsSummary = Array.from(allIds)
    .map(id => {
      const extra = extraQtyMap[id] ?? 0;
      const mult  = multiplierMap[id] ?? 1;
      const mainCooked = (mainQty[id] || 0) * mult + extra;
      return {
        meal: allMealDetails[id],
        quantity: mainCooked + (altQty[id] || 0) + (fixedQty[id] || 0),
        mainQty: mainCooked,
        altQty: altQty[id] || 0,
        fixedQty: fixedQty[id] || 0,
        multiplier: mult,
      };
    })
    .filter(x => x.meal)
    .sort((a, b) => b.quantity - a.quantity);

  const mainMealsSummary = orderItems
    .filter(item => !item.meals.is_snack)
    .map(item => {
      const mult = multiplierMap[item.meal_id] ?? 1;
      return {
        meal: displayMealMap[item.meal_id],
        gets: (mainQty[item.meal_id] || 0) * mult + (extraQtyMap[item.meal_id] ?? 0),
        multiplier: mult,
      };
    });

  const snackMealsSummary = orderItems
    .filter(item => item.meals.is_snack)
    .map(item => {
      const mult = multiplierMap[item.meal_id] ?? 1;
      return {
        meal: displayMealMap[item.meal_id],
        gets: (mainQty[item.meal_id] || 0) * mult + (extraQtyMap[item.meal_id] ?? 0),
        multiplier: mult,
      };
    });

  const altSummary = Object.entries(altQty)
    .map(([id, qty]) => ({ meal: allMealDetails[id], qty }))
    .filter(x => x.meal && !x.meal.is_snack);

  const snackAltSummary = Object.entries(altQty)
    .map(([id, qty]) => ({ meal: allMealDetails[id], qty }))
    .filter(x => x.meal && x.meal.is_snack);

  const fixedSummary = Object.entries(fixedQty)
    .map(([id, qty]) => ({ meal: allMealDetails[id], qty }))
    .filter(x => x.meal)
    .sort((a, b) => b.qty - a.qty);

  // Per-meal final count (used by OrderList for the snapshot-friendly count column)
  const itemFinalCounts: Record<string, number> = {};
  orderItems.forEach(item => {
    const id = item.meal_id;
    const mult = multiplierMap[id] ?? 1;
    itemFinalCounts[id] = (mainQty[id] || 0) * mult + (extraQtyMap[id] ?? 0);
  });

  return {
    order,
    itemsSummary,
    beneficiaryDetails,
    mainMealsSummary,
    snackMealsSummary,
    altSummary,
    snackAltSummary,
    fixedSummary,
    itemFinalCounts,
    totalBeneficiaries: beneficiaries.length,
  };
}

/**
 * Saves the snapshot for an order. Returns the timestamp.
 * Silently no-ops if the snapshot column doesn't exist yet (migration not run).
 */
export async function saveOrderSnapshot(
  supabase: SupabaseClient,
  orderId: string,
  snapshot: Record<string, unknown>,
): Promise<string | null> {
  const snapshotAt = new Date().toISOString();
  const { error } = await supabase
    .from('daily_orders')
    .update({ snapshot, snapshot_at: snapshotAt })
    .eq('id', orderId);
  if (error && /snapshot|column/i.test(error.message)) {
    return null;
  }
  return snapshotAt;
}
