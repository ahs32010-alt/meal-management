import { createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import type { ReportData, Meal } from '@/lib/types';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: order, error: orderError } = await supabase
    .from('daily_orders')
    .select(`*, order_items(id, meal_id, display_name, extra_quantity, meals(id, name, english_name, type, is_snack))`)
    .eq('id', params.id)
    .single();

  if (orderError || !order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

  const orderItems: { meal_id: string; display_name?: string | null; extra_quantity?: number; meals: Meal }[] = order.order_items || [];
  if (orderItems.length === 0) return NextResponse.json({ error: 'No items in this order' }, { status: 400 });

  // Build base meal map and display-name-overridden meal map
  const mealMap: Record<string, Meal> = {};
  const displayMealMap: Record<string, Meal> = {};
  const extraQtyMap: Record<string, number> = {};

  orderItems.forEach(item => {
    mealMap[item.meal_id] = item.meals;
    extraQtyMap[item.meal_id] = item.extra_quantity ?? 0;
    // Create a display-name version of the meal (overrides name if set)
    displayMealMap[item.meal_id] = item.display_name
      ? { ...item.meals, name: item.display_name }
      : item.meals;
  });

  const orderMealIds = new Set(Object.keys(mealMap));

  // Day of week from order date (0=Sun … 6=Sat)
  const orderDayOfWeek = new Date(order.date).getDay();

  const { data: beneficiaries } = await supabase
    .from('beneficiaries')
    .select(`
      *,
      exclusions(id, meal_id, alternative_meal_id, meals:meals!exclusions_meal_id_fkey(id, name, english_name, type, is_snack)),
      fixed_meals:beneficiary_fixed_meals(id, day_of_week, meal_type, meal_id, meals(id, name, english_name, type, is_snack))
    `)
    .order('name');

  if (!beneficiaries || beneficiaries.length === 0)
    return NextResponse.json({ error: 'No beneficiaries found' }, { status: 400 });

  // Collect alternative_meal_ids to resolve meals not in the order
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

  // Quantities: main + alternative + fixed
  const mainQty: Record<string, number> = {};
  const altQty: Record<string, number> = {};
  const fixedQty: Record<string, number> = {};
  const allMealDetails: Record<string, Meal> = { ...altMealMap };

  // Seed display names into allMealDetails
  Object.entries(displayMealMap).forEach(([id, m]) => { allMealDetails[id] = m; });

  const beneficiaryDetails = beneficiaries.map((ben: {
    id: string; name: string; english_name?: string; code: string;
    category: string; villa?: string; diet_type?: string;
    fixed_items?: string; notes?: string; created_at: string;
    exclusions: { id: string; meal_id: string; alternative_meal_id: string | null }[];
    fixed_meals: { id: string; day_of_week: number; meal_type: string; meal_id: string; meals: Meal }[];
  }) => {
    const excludedIds = new Set((ben.exclusions || []).map(e => e.meal_id));

    // Excluded items (only those in this order)
    const excludedItems = (ben.exclusions || [])
      .filter(ex => orderMealIds.has(ex.meal_id))
      .map(ex => {
        const meal = displayMealMap[ex.meal_id]; // use display name
        let alternative: Meal | null = null;
        if (ex.alternative_meal_id && altMealMap[ex.alternative_meal_id]) {
          alternative = altMealMap[ex.alternative_meal_id];
        }
        return { meal, alternative };
      });

    // Fixed meals for today's day + this meal type
    const todayFixed: Meal[] = (ben.fixed_meals || [])
      .filter(fm => fm.day_of_week === orderDayOfWeek && fm.meal_type === order.meal_type && fm.meals)
      .map(fm => fm.meals);

    // Count main meals
    orderItems.forEach(item => {
      if (!excludedIds.has(item.meal_id)) {
        mainQty[item.meal_id] = (mainQty[item.meal_id] || 0) + 1;
        allMealDetails[item.meal_id] = displayMealMap[item.meal_id];
      }
    });
    // Count alternatives
    excludedItems.forEach(({ alternative }) => {
      if (alternative) {
        altQty[alternative.id] = (altQty[alternative.id] || 0) + 1;
        allMealDetails[alternative.id] = alternative;
      }
    });
    // Count fixed
    todayFixed.forEach(m => {
      fixedQty[m.id] = (fixedQty[m.id] || 0) + 1;
      allMealDetails[m.id] = m;
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

  // Build itemsSummary: include extra_quantity in main counts
  const allIds = new Set([...Object.keys(mainQty), ...Object.keys(altQty), ...Object.keys(fixedQty)]);
  const itemsSummary = Array.from(allIds)
    .map(id => {
      const extra = extraQtyMap[id] ?? 0;
      return {
        meal: allMealDetails[id],
        quantity: (mainQty[id] || 0) + extra + (altQty[id] || 0) + (fixedQty[id] || 0),
        mainQty: (mainQty[id] || 0) + extra,
        altQty: altQty[id] || 0,
        fixedQty: fixedQty[id] || 0,
      };
    })
    .filter(x => x.meal)
    .sort((a, b) => b.quantity - a.quantity);

  // Side-by-side tables — use display names, include extra_quantity in gets
  const mainMealsSummary = orderItems
    .filter(item => !item.meals.is_snack)
    .map(item => ({
      meal: displayMealMap[item.meal_id],
      gets: (mainQty[item.meal_id] || 0) + (extraQtyMap[item.meal_id] ?? 0),
    }));

  const snackMealsSummary = orderItems
    .filter(item => item.meals.is_snack)
    .map(item => ({
      meal: displayMealMap[item.meal_id],
      gets: (mainQty[item.meal_id] || 0) + (extraQtyMap[item.meal_id] ?? 0),
    }));

  // Alternatives used (for display next to main)
  const altSummary = Object.entries(altQty)
    .map(([id, qty]) => ({ meal: allMealDetails[id], qty }))
    .filter(x => x.meal && !x.meal.is_snack);

  const snackAltSummary = Object.entries(altQty)
    .map(([id, qty]) => ({ meal: allMealDetails[id], qty }))
    .filter(x => x.meal && x.meal.is_snack);

  const reportData: ReportData = {
    order,
    itemsSummary,
    beneficiaryDetails,
    mainMealsSummary,
    snackMealsSummary,
    altSummary,
    snackAltSummary,
  } as ReportData & {
    mainMealsSummary: typeof mainMealsSummary;
    snackMealsSummary: typeof snackMealsSummary;
    altSummary: typeof altSummary;
    snackAltSummary: typeof snackAltSummary;
  };

  return NextResponse.json(reportData);
}
