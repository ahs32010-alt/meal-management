// ============================================================================
// حساب تكلفة أوامر التشغيل — الجانب الخادمي
//
// يجمع ثلاث مصادر ويطلّع رقماً واحداً:
//   1. الكميات النهائية لكل صنف في الأمر  ← تقرير الأمر (itemFinalCounts)
//   2. وصفة كل صنف                        ← meal_recipe_items
//   3. أسعار المواد الأولية                ← raw_materials
//
// الحساب نفسه يعيش في lib/costs.ts (وحدة نقية مختبَرة) — هنا فقط جلب البيانات.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildOrderReport } from '@/lib/order-report';
import {
  costOrder,
  costRecipe,
  round,
  type CostedOrderItem,
  type CostUnitDef,
  type OrderQuantity,
  type RawMaterial,
  type RecipeCost,
  type RecipeLineInput,
} from '@/lib/costs';
import type { MealType } from '@/lib/types';

export interface OrderRow {
  id: string;
  date: string;
  meal_type: MealType;
  entity_type?: 'beneficiary' | 'companion' | null;
  snapshot?: { itemFinalCounts?: Record<string, number> } | null;
}

export interface OrderCostResult {
  order_id: string;
  date: string;
  meal_type: MealType;
  entity_type: 'beneficiary' | 'companion';
  /** مجمّدة = محسوبة بأسعار لحظة الاعتماد ومحفوظة، لا تتأثر بتغيّر الأسعار */
  frozen: boolean;
  frozen_at: string | null;
  frozen_by_name: string | null;
  total: number;
  totalPortions: number;
  avgPortionCost: number;
  coverage: number;
  items: CostedOrderItem[];
  unpricedNames: string[];
  partialNames: string[];
  /** الأمر بلا أصناف/بلا تقرير — ما نقدر نسعّره */
  noData: boolean;
}

/** خريطة meal_id → تكلفة الحصة، مبنية من الوصفات وأسعار المواد الحالية */
export interface PricingContext {
  materials: Record<string, RawMaterial>;
  units: Record<string, CostUnitDef>;
  recipeCosts: Record<string, RecipeCost>;
}

/** يقرأ الوحدات والمواد الأولية والوصفات مرة واحدة ويبني تكلفة الحصة لكل صنف */
export async function loadPricingContext(supabase: SupabaseClient): Promise<PricingContext> {
  const [unitsRes, materialsRes, recipesRes] = await Promise.all([
    supabase.from('cost_units').select('id, name, family, factor, is_builtin'),
    supabase.from('raw_materials').select('id, name, unit_id, unit_cost'),
    supabase.from('meal_recipe_items').select('meal_id, raw_material_id, quantity, unit_id'),
  ]);

  // numeric في Postgres يرجع نصاً عبر PostgREST — نحوّله هنا مرة واحدة فما
  // يتسرّب نص إلى أي حساب لاحق.
  const units: Record<string, CostUnitDef> = {};
  for (const u of (unitsRes.data ?? []) as CostUnitDef[]) {
    units[u.id] = { ...u, factor: Number(u.factor) || 0 };
  }

  const materials: Record<string, RawMaterial> = {};
  for (const m of (materialsRes.data ?? []) as RawMaterial[]) {
    materials[m.id] = { ...m, unit_cost: Number(m.unit_cost) || 0 };
  }

  // نجمع أسطر كل صنف ثم نسعّرها دفعة واحدة
  const byMeal: Record<string, RecipeLineInput[]> = {};
  for (const r of (recipesRes.data ?? []) as { meal_id: string; raw_material_id: string; quantity: number | string; unit_id: string }[]) {
    (byMeal[r.meal_id] ??= []).push({
      raw_material_id: r.raw_material_id,
      quantity: Number(r.quantity) || 0,
      unit_id: r.unit_id,
    });
  }

  const recipeCosts: Record<string, RecipeCost> = {};
  for (const [mealId, lines] of Object.entries(byMeal)) {
    recipeCosts[mealId] = costRecipe(lines, materials, units);
  }

  return { materials, units, recipeCosts };
}

/**
 * الكميات النهائية لكل صنف في أمر. تُقرأ من لقطة الأمر المحفوظة إن وُجدت،
 * وإلا تُحسب مباشرة. نفس المصدر الذي تعرضه شاشة أوامر التشغيل والتقارير —
 * فلا يختلف رقم التكلفة عن الكميات المطبوعة.
 */
export async function orderQuantities(
  supabase: SupabaseClient,
  order: OrderRow,
): Promise<Record<string, number>> {
  const fromSnapshot = order.snapshot?.itemFinalCounts;
  if (fromSnapshot && Object.keys(fromSnapshot).length > 0) return fromSnapshot;

  const report = await buildOrderReport(supabase, order.id);
  const counts = report?.itemFinalCounts as Record<string, number> | undefined;
  return counts ?? {};
}

/** يجلب أسماء الأصناف لمجموعة معرّفات (تشمل البدائل والأصناف الثابتة) */
async function mealNames(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const { data } = await supabase.from('meals').select('id, name').in('id', ids);
  const out: Record<string, string> = {};
  for (const m of (data ?? []) as { id: string; name: string }[]) out[m.id] = m.name;
  return out;
}

/**
 * يحسب تكلفة مجموعة أوامر. الأوامر المجمّدة تُرجَّع من اللقطة المحفوظة كما هي
 * (بأسعار وقت الاعتماد)، والباقي يُحسب بالأسعار الحالية.
 */
export async function computeOrderCosts(
  supabase: SupabaseClient,
  orders: OrderRow[],
): Promise<OrderCostResult[]> {
  if (orders.length === 0) return [];

  const [ctx, frozenRes] = await Promise.all([
    loadPricingContext(supabase),
    supabase
      .from('order_cost_snapshots')
      .select('order_id, total_cost, breakdown, frozen_at, frozen_by_name')
      .in('order_id', orders.map(o => o.id)),
  ]);

  interface FrozenRow {
    order_id: string;
    total_cost: number | string;
    breakdown: Record<string, unknown>;
    frozen_at: string;
    frozen_by_name: string | null;
  }

  const frozenByOrder: Record<string, Omit<FrozenRow, 'total_cost'> & { total_cost: number }> = {};
  for (const row of (frozenRes.data ?? []) as FrozenRow[]) {
    frozenByOrder[row.order_id] = { ...row, total_cost: Number(row.total_cost) || 0 };
  }

  // الكميات لكل أمر — تُجلب بالتوازي، وأمر واحد فاشل ما يسقط الباقي
  const quantitiesPerOrder = await Promise.all(
    orders.map(async o => {
      const frozen = frozenByOrder[o.id];
      // الأمر المجمّد ما يحتاج إعادة حساب كميات — تفصيله محفوظ
      if (frozen) return {} as Record<string, number>;
      try { return await orderQuantities(supabase, o); }
      catch { return {} as Record<string, number>; }
    }),
  );

  const allMealIds = new Set<string>();
  quantitiesPerOrder.forEach(q => Object.keys(q).forEach(id => allMealIds.add(id)));
  const names = await mealNames(supabase, Array.from(allMealIds));

  return orders.map((order, idx) => {
    const entityType = order.entity_type === 'companion' ? 'companion' : 'beneficiary';
    const frozen = frozenByOrder[order.id];

    if (frozen) {
      const b = frozen.breakdown as {
        items?: CostedOrderItem[];
        totalPortions?: number;
        coverage?: number;
        unpricedNames?: string[];
        partialNames?: string[];
      };
      const items = b.items ?? [];
      const totalPortions = b.totalPortions ?? items.reduce((s, i) => s + i.quantity, 0);
      return {
        order_id: order.id,
        date: order.date,
        meal_type: order.meal_type,
        entity_type: entityType,
        frozen: true,
        frozen_at: frozen.frozen_at,
        frozen_by_name: frozen.frozen_by_name,
        total: frozen.total_cost,
        totalPortions,
        avgPortionCost: totalPortions > 0 ? frozen.total_cost / totalPortions : 0,
        coverage: b.coverage ?? 0,
        items,
        unpricedNames: b.unpricedNames ?? [],
        partialNames: b.partialNames ?? [],
        noData: items.length === 0,
      };
    }

    const counts = quantitiesPerOrder[idx];
    const quantities: OrderQuantity[] = Object.entries(counts)
      .filter(([, qty]) => qty > 0)
      .map(([mealId, qty]) => ({
        meal_id: mealId,
        meal_name: names[mealId] ?? '—',
        quantity: qty,
      }));

    const cost = costOrder(quantities, ctx.recipeCosts);

    return {
      order_id: order.id,
      date: order.date,
      meal_type: order.meal_type,
      entity_type: entityType,
      frozen: false,
      frozen_at: null,
      frozen_by_name: null,
      total: cost.total,
      totalPortions: cost.totalPortions,
      avgPortionCost: cost.avgPortionCost,
      coverage: cost.coverage,
      items: cost.items,
      unpricedNames: cost.unpricedItems.map(i => i.meal_name),
      partialNames: cost.partialItems.map(i => i.meal_name),
      noData: quantities.length === 0,
    };
  });
}

/**
 * يبني جسم اللقطة المحفوظة عند الاعتماد. نحفظ تفصيل الأصناف *وأسعار المواد
 * المستخدمة وقتها* — عشان يبقى الرقم قابلاً للتدقيق بعد سنة من تغيّر الأسعار.
 */
export function buildFreezeBreakdown(
  result: OrderCostResult,
  ctx: PricingContext,
): Record<string, unknown> {
  const usedMaterials: Record<string, { name: string; unit: string; unit_cost: number }> = {};
  for (const item of result.items) {
    const recipe = ctx.recipeCosts[item.meal_id];
    for (const line of recipe?.lines ?? []) {
      const m = ctx.materials[line.raw_material_id];
      if (m) {
        usedMaterials[m.id] = {
          name: m.name,
          // نحفظ اسم الوحدة لا معرّفها — اللقطة لازم تنقرأ بعد سنة حتى لو
          // أُعيدت تسمية الوحدة أو حُذفت
          unit: ctx.units[m.unit_id]?.name ?? '—',
          unit_cost: m.unit_cost,
        };
      }
    }
  }

  return {
    items: result.items.map(i => ({
      ...i,
      portion_cost: round(i.portion_cost, 4),
      total_cost: round(i.total_cost, 4),
    })),
    recipes: Object.fromEntries(
      result.items
        .filter(i => ctx.recipeCosts[i.meal_id])
        .map(i => [
          i.meal_id,
          ctx.recipeCosts[i.meal_id].lines.map(l => ({
            raw_material_id: l.raw_material_id,
            name: l.name,
            quantity: l.quantity,
            unit: l.unit_name,
            material_unit: l.material_unit_name,
            unit_cost: l.unit_cost,
            cost: round(l.cost, 4),
            issue: l.issue,
          })),
        ]),
    ),
    materials: usedMaterials,
    totalPortions: result.totalPortions,
    coverage: round(result.coverage, 2),
    unpricedNames: result.unpricedNames,
    partialNames: result.partialNames,
    computed_at: new Date().toISOString(),
  };
}
