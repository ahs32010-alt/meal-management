import type { SupabaseClient } from '@supabase/supabase-js';
import type { Meal, MealType, ItemCategory } from '@/lib/types';
import { MEAL_SECTIONS } from '@/lib/menu-utils';

type EntityType = 'beneficiary' | 'companion';

type MenuItemRow = {
  week_number: number;
  day_of_week: number;
  meal_type: MealType;
  meal_id: string;
  category?: string;
  multiplier?: number;
  entity_type?: string;
  meals: Meal;
};

type BenRow = {
  id: string;
  exclusions: Array<{ meal_id: string; alternative_meal_id: string | null }>;
  fixed_meals: Array<{
    day_of_week: number;
    meal_type: string;
    meal_id: string;
    quantity: number;
    meals: Meal;
    category?: string;
  }>;
};

export interface MenuPeriodReport {
  // which weeks → days were queried
  selections: Record<string, number[]>;
  entityType?: EntityType;
  mealType?: MealType;
  // summary per week for the result header
  weeksSummary: Array<{
    week: number;
    days: number[];
    totalItems: number;
  }>;
  processedSlots: number;
  aggregated: {
    mainMealsSummary: Array<{ meal: Meal; gets: number }>;
    altSummary: Array<{ meal: Meal; qty: number }>;
    snackMealsSummary: Array<{ meal: Meal; gets: number }>;
    snackAltSummary: Array<{ meal: Meal; qty: number }>;
    fixedSummary: Array<{ meal: Meal; qty: number }>;
    itemsSummary: Array<{ meal: Meal; quantity: number }>;
  };
}

/**
 * Computes an aggregated item report from the menu (menu_items table) for the
 * given week-day selections. No daily_orders needed — results are based purely
 * on the menu definition plus beneficiary exclusions and fixed meals.
 *
 * @param selections  { weekNumber: [dayOfWeek, ...] }
 * @param meal_type   optional — if omitted all three meal types are summed
 * @param entity_type optional — if omitted beneficiaries of both types are included
 */
export async function buildMenuPeriodReport(
  supabase: SupabaseClient,
  params: {
    selections: Record<string | number, number[]>;
    meal_type?: MealType;
    entity_type?: EntityType;
  },
): Promise<MenuPeriodReport | null> {
  const selectionEntries = Object.entries(params.selections)
    .map(([w, days]) => ({ week: Number(w), days: days.filter(d => d >= 0 && d <= 6) }))
    .filter(e => e.week >= 1 && e.week <= 4 && e.days.length > 0);

  if (selectionEntries.length === 0) return null;

  const weekNumbers = selectionEntries.map(e => e.week);
  const mealTypes: MealType[] = params.meal_type
    ? [params.meal_type]
    : MEAL_SECTIONS.map(s => s.meal_type);

  // ── 1. Fetch menu items for the selected weeks ────────────────────────────
  const fetchItems = async (withEntityType: boolean, withMealCategory: boolean) => {
    const mealCols = `id, name, english_name, type, is_snack${withMealCategory ? ', category' : ''}`;
    let q = supabase
      .from('menu_items')
      .select(
        `week_number, day_of_week, meal_type, meal_id, category, multiplier${withEntityType ? ', entity_type' : ''}, meals(${mealCols})`,
      )
      .in('week_number', weekNumbers)
      .in('meal_type', mealTypes);
    if (params.entity_type && withEntityType) q = q.eq('entity_type', params.entity_type);
    return q;
  };

  let itemsRes = await fetchItems(true, true);
  if (itemsRes.error && /entity_type|column/i.test(itemsRes.error.message)) {
    itemsRes = await fetchItems(false, true);
  }
  if (itemsRes.error && /category|column/i.test(itemsRes.error.message)) {
    itemsRes = await fetchItems(true, false);
    if (itemsRes.error && /entity_type|column/i.test(itemsRes.error.message)) {
      itemsRes = await fetchItems(false, false);
    }
  }

  const rawItems = (itemsRes.data as unknown as MenuItemRow[]) || [];

  // Keep only (week, day) pairs that are in the selections
  const selectedPairs = new Set(
    selectionEntries.flatMap(e => e.days.map(d => `${e.week}|${d}`)),
  );
  const menuItems = rawItems.filter(
    item => selectedPairs.has(`${item.week_number}|${item.day_of_week}`),
  );

  if (menuItems.length === 0) return null;

  // ── 2. Fetch beneficiaries + exclusions + fixed_meals ─────────────────────
  const fetchBens = async (
    withEntityTypeFilter: boolean,
    withFixedCategory: boolean,
    withMealCategory: boolean,
  ) => {
    const mealCols = `id, name, english_name, type, is_snack${withMealCategory ? ', category' : ''}`;
    const sel =
      `id, exclusions(meal_id, alternative_meal_id), ` +
      `fixed_meals:beneficiary_fixed_meals(day_of_week, meal_type, meal_id, quantity${withFixedCategory ? ', category' : ''}, meals(${mealCols}))`;
    const q = supabase.from('beneficiaries').select(sel);
    return withEntityTypeFilter && params.entity_type ? q.eq('entity_type', params.entity_type) : q;
  };

  let bensRes = await fetchBens(true, true, true);
  if (bensRes.error && /category|column/i.test(bensRes.error.message)) {
    bensRes = await fetchBens(true, false, true);
  }
  if (bensRes.error && /entity_type|column/i.test(bensRes.error.message)) {
    bensRes = await fetchBens(false, false, true);
  }
  if (bensRes.error && /category|column/i.test(bensRes.error.message)) {
    bensRes = await fetchBens(false, false, false);
  }

  const beneficiaries = (bensRes.data as unknown as BenRow[]) || [];
  if (beneficiaries.length === 0) return null;

  // ── 3. Collect alternative meal IDs not already in the menu ───────────────
  const menuMealMap: Record<string, Meal> = {};
  menuItems.forEach(item => { menuMealMap[item.meal_id] = item.meals; });

  const altIds = new Set<string>();
  beneficiaries.forEach(ben => {
    (ben.exclusions || []).forEach(ex => {
      if (ex.alternative_meal_id && !menuMealMap[ex.alternative_meal_id]) {
        altIds.add(ex.alternative_meal_id);
      }
    });
  });

  const altMealMap: Record<string, Meal> = { ...menuMealMap };
  if (altIds.size > 0) {
    const { data: altMeals } = await supabase
      .from('meals')
      .select('id, name, english_name, type, is_snack')
      .in('id', Array.from(altIds));
    (altMeals || []).forEach(
      (m: { id: string; name: string; english_name?: string; type: string; is_snack: boolean }) => {
        altMealMap[m.id] = m as Meal;
      },
    );
  }

  // ── 4. Group menu items by slot (week|day|meal_type) ──────────────────────
  const slotMap = new Map<string, MenuItemRow[]>();
  menuItems.forEach(item => {
    const k = `${item.week_number}|${item.day_of_week}|${item.meal_type}`;
    const list = slotMap.get(k) ?? [];
    list.push(item);
    slotMap.set(k, list);
  });

  // ── 5. Aggregation maps ───────────────────────────────────────────────────
  const aggMain = new Map<string, { meal: Meal; gets: number }>();
  const aggAlt = new Map<string, { meal: Meal; qty: number }>();
  const aggSnack = new Map<string, { meal: Meal; gets: number }>();
  const aggSnackAlt = new Map<string, { meal: Meal; qty: number }>();
  const aggFixed = new Map<string, { meal: Meal; qty: number }>();
  const aggItems = new Map<string, { meal: Meal; quantity: number }>();

  // Per-week totals for the summary
  const weekTotals: Record<number, number> = {};

  let processedSlots = 0;

  // ── 6. Process each slot ──────────────────────────────────────────────────
  for (const [slotKeyStr, slotItems] of slotMap) {
    const [weekStr, dayStr, mealTypeStr] = slotKeyStr.split('|');
    const slotWeek = Number(weekStr);
    const slotDay = Number(dayStr);
    const slotMealType = mealTypeStr as MealType;

    processedSlots++;

    // Build helper maps for this slot
    const categoryMap: Record<string, ItemCategory> = {};
    const multiplierMap: Record<string, number> = {};
    const displayMealMap: Record<string, Meal> = {};

    slotItems.forEach(item => {
      multiplierMap[item.meal_id] = Math.max(1, item.multiplier ?? 1);
      const mealCat = (item.meals as { category?: ItemCategory }).category;
      categoryMap[item.meal_id] =
        mealCat ?? (item.category as ItemCategory) ?? (item.meals.is_snack ? 'snack' : 'hot');
      displayMealMap[item.meal_id] = item.meals;
    });

    const slotMealIds = new Set(slotItems.map(i => i.meal_id));

    // Per-slot quantity counters
    const mainQty: Record<string, number> = {};
    const altQty: Record<string, number> = {};
    const fixedQty: Record<string, number> = {};
    const localMeals: Record<string, Meal> = { ...altMealMap, ...displayMealMap };

    beneficiaries.forEach(ben => {
      const excludedIds = new Set((ben.exclusions || []).map(e => e.meal_id));

      // Excluded items that apply to this slot
      const excludedItems = (ben.exclusions || [])
        .filter(ex => slotMealIds.has(ex.meal_id))
        .map(ex => ({
          mealId: ex.meal_id,
          alternative: ex.alternative_meal_id ? (altMealMap[ex.alternative_meal_id] ?? null) : null,
        }));

      // Fixed meals for this day + meal_type
      const todayFixed = (ben.fixed_meals || [])
        .filter(fm => fm.day_of_week === slotDay && fm.meal_type === slotMealType && fm.meals)
        .map(fm => ({ meal: fm.meals, quantity: fm.quantity ?? 1 }));

      // Main qty: non-excluded slot meals
      slotItems.forEach(item => {
        if (!excludedIds.has(item.meal_id)) {
          mainQty[item.meal_id] = (mainQty[item.meal_id] || 0) + 1;
        }
      });

      // Alternative qty (respects multiplier of the excluded meal)
      excludedItems.forEach(({ mealId, alternative }) => {
        if (alternative) {
          const mult = multiplierMap[mealId] ?? 1;
          altQty[alternative.id] = (altQty[alternative.id] || 0) + mult;
          localMeals[alternative.id] = alternative;
        }
      });

      // Fixed qty
      todayFixed.forEach(({ meal, quantity }) => {
        fixedQty[meal.id] = (fixedQty[meal.id] || 0) + quantity;
        localMeals[meal.id] = meal;
      });
    });

    // Compute per-slot items total (for weeksSummary)
    let slotTotal = 0;
    Object.entries(mainQty).forEach(([id, qty]) => {
      slotTotal += qty * (multiplierMap[id] ?? 1);
    });
    Object.values(altQty).forEach(v => { slotTotal += v; });
    Object.values(fixedQty).forEach(v => { slotTotal += v; });
    weekTotals[slotWeek] = (weekTotals[slotWeek] || 0) + slotTotal;

    // Merge into aggregated maps
    slotItems
      .filter(i => !i.meals.is_snack)
      .forEach(item => {
        const mult = multiplierMap[item.meal_id] ?? 1;
        const gets = (mainQty[item.meal_id] || 0) * mult;
        const ex = aggMain.get(item.meal_id);
        if (ex) ex.gets += gets; else aggMain.set(item.meal_id, { meal: displayMealMap[item.meal_id], gets });
      });

    slotItems
      .filter(i => i.meals.is_snack)
      .forEach(item => {
        const mult = multiplierMap[item.meal_id] ?? 1;
        const gets = (mainQty[item.meal_id] || 0) * mult;
        const ex = aggSnack.get(item.meal_id);
        if (ex) ex.gets += gets; else aggSnack.set(item.meal_id, { meal: displayMealMap[item.meal_id], gets });
      });

    Object.entries(altQty).forEach(([id, qty]) => {
      const meal = localMeals[id];
      if (!meal) return;
      if (meal.is_snack) {
        const ex = aggSnackAlt.get(id);
        if (ex) ex.qty += qty; else aggSnackAlt.set(id, { meal, qty });
      } else {
        const ex = aggAlt.get(id);
        if (ex) ex.qty += qty; else aggAlt.set(id, { meal, qty });
      }
    });

    Object.entries(fixedQty).forEach(([id, qty]) => {
      const meal = localMeals[id];
      if (!meal) return;
      const ex = aggFixed.get(id);
      if (ex) ex.qty += qty; else aggFixed.set(id, { meal, qty });
    });

    // Total per meal (main + alt + fixed) for this slot
    const allQtyIds = new Set([...Object.keys(mainQty), ...Object.keys(altQty), ...Object.keys(fixedQty)]);
    allQtyIds.forEach(id => {
      const meal = localMeals[id];
      if (!meal) return;
      const mult = multiplierMap[id] ?? 1;
      const quantity = (mainQty[id] || 0) * mult + (altQty[id] || 0) + (fixedQty[id] || 0);
      const ex = aggItems.get(id);
      if (ex) ex.quantity += quantity; else aggItems.set(id, { meal, quantity });
    });
  }

  // ── 7. Build weeksSummary ─────────────────────────────────────────────────
  const weeksSummary = selectionEntries
    .filter(e => weekTotals[e.week] !== undefined || e.days.length > 0)
    .map(e => ({
      week: e.week,
      days: e.days,
      totalItems: weekTotals[e.week] || 0,
    }));

  return {
    selections: Object.fromEntries(selectionEntries.map(e => [String(e.week), e.days])),
    entityType: params.entity_type,
    mealType: params.meal_type,
    processedSlots,
    weeksSummary,
    aggregated: {
      mainMealsSummary: [...aggMain.values()].sort((a, b) => b.gets - a.gets),
      altSummary:       [...aggAlt.values()].sort((a, b)  => b.qty - a.qty),
      snackMealsSummary:[...aggSnack.values()].sort((a, b)=> b.gets - a.gets),
      snackAltSummary:  [...aggSnackAlt.values()].sort((a, b) => b.qty - a.qty),
      fixedSummary:     [...aggFixed.values()].sort((a, b) => b.qty - a.qty),
      itemsSummary:     [...aggItems.values()].sort((a, b) => b.quantity - a.quantity),
    },
  };
}
