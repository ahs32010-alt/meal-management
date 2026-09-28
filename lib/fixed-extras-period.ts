import type { SupabaseClient } from '@supabase/supabase-js';
import type { Meal, MealType, EntityType } from '@/lib/types';
import { fetchAllRows } from '@/lib/fetch-all';
import { buildOrderOverlay, type PersonalMenuOverride } from '@/lib/beneficiary-menu';

/**
 * حصر «الأصناف اليومية الإضافية» (الأصناف الثابتة غير البديلة) لفترة بالتاريخ.
 *
 * لكل يوم في الفترة ولكل وجبة مختارة:
 *  - لو فيه أمر تشغيل محفوظ لهذا اليوم/الوجبة/الفئة → نحسب مثل أمر التشغيل
 *    بالضبط: يوم الأسبوع من الأمر، «لا يُصرف لو وُجد» من أصنافه، وقرارات
 *    الخانة (حذف/تبديل/إضافة) من رقم أسبوعه.
 *  - وإلا (يوم قادم ما انعمل له أمر) → نحسب من المسجّل على المستفيد وحده حسب
 *    يوم الأسبوع.
 * الصنف الثابت المعلَّم «بديل» لا يدخل هنا — مكانه جدول البدائل.
 */

export const MAX_RANGE_DAYS = 366;

export interface FixedExtrasBen {
  id: string;
  name: string;
  code: string;
  entity_type?: EntityType | null;
  fixed_meals: {
    day_of_week: number;
    meal_type: string;
    meal_id: string;
    quantity: number | null;
    suppress_if_meal_ids?: string[] | null;
    is_alternative?: boolean | null;
  }[];
}

export interface FixedExtrasOrder {
  date: string;
  meal_type: MealType;
  entity_type?: EntityType | null;
  week_number?: number | null;
  day_of_week?: number | null;
  meal_ids: string[];
}

export interface FixedExtrasRow {
  meal: Meal;
  byMealType: Record<MealType, number>;
  total: number;
  /** عدد المستفيدين الذين يأخذون هذا الصنف في الفترة */
  beneficiaries: number;
  /** سعر بيع الحبة من «الأسعار والتكاليف» (meal_pricing) — null = غير مسعَّر */
  unitPrice: number | null;
  /** الكمية × سعر الحبة (صفر لو غير مسعَّر) */
  totalPrice: number;
}

export interface FixedExtrasReport {
  from: string;
  to: string;
  days: number;
  mealTypes: MealType[];
  entityType?: EntityType;
  /** خانات (يوم × وجبة) حُسبت من أمر تشغيل محفوظ */
  slotsFromOrders: number;
  /** خانات حُسبت من التسجيل وحده (لا يوجد لها أمر) */
  slotsFromRegistration: number;
  rows: FixedExtrasRow[];
  byBeneficiary: { id: string; name: string; code: string; total: number; totalPrice: number; items: { meal: Meal; qty: number }[] }[];
  grandTotal: number;
  /** مجموع أسعار كل الإضافات المسعَّرة */
  grandTotalPrice: number;
  /** أصناف ظهرت في الحصر بلا سعر بيع — مجموعها ناقص بقدرها */
  unpricedCount: number;
}

/** كل التواريخ من from إلى to شاملة (YYYY-MM-DD). */
export function datesInRange(from: string, to: string): string[] {
  const out: string[] = [];
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return out;
  for (let t = start; t <= end; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

const ZERO = (): Record<MealType, number> => ({ breakfast: 0, lunch: 0, dinner: 0 });

/** الحساب الصافي — بلا قاعدة بيانات، عشان يُختبر مباشرة. */
export function computeFixedExtras(params: {
  from: string;
  to: string;
  mealTypes: MealType[];
  entityType?: EntityType;
  beneficiaries: FixedExtrasBen[];
  orders: FixedExtrasOrder[];
  overrides: (PersonalMenuOverride & { beneficiary_id: string })[];
  meals: Record<string, Meal>;
  /** سعر بيع الحبة لكل صنف (meal_id → سعر) */
  prices?: Record<string, number>;
}): FixedExtrasReport {
  const { from, to, mealTypes, entityType, meals } = params;
  const prices = params.prices ?? {};
  const priceOf = (id: string): number | null =>
    typeof prices[id] === 'number' && Number.isFinite(prices[id]) ? prices[id] : null;
  // تقريب لخانتين بعد كل ضرب — تفادي 0.1+0.2 في المجاميع
  const money = (v: number) => Math.round(v * 100) / 100;
  const dates = datesInRange(from, to);
  const entityOf = (e?: EntityType | null): EntityType => (e === 'companion' ? 'companion' : 'beneficiary');

  const bens = params.beneficiaries.filter(b => !entityType || entityOf(b.entity_type) === entityType);

  const orderByKey = new Map<string, FixedExtrasOrder>();
  for (const o of params.orders) orderByKey.set(`${o.date}|${o.meal_type}|${entityOf(o.entity_type)}`, o);

  const overridesByBen = new Map<string, PersonalMenuOverride[]>();
  for (const ov of params.overrides) {
    const list = overridesByBen.get(ov.beneficiary_id) ?? [];
    list.push(ov);
    overridesByBen.set(ov.beneficiary_id, list);
  }

  const rows = new Map<string, FixedExtrasRow & { benIds: Set<string> }>();
  const perBen = new Map<string, Map<string, number>>();
  const usedSlots = new Set<string>();
  const regSlots = new Set<string>();

  const add = (benId: string, mealId: string, mealType: MealType, qty: number) => {
    const meal = meals[mealId];
    if (!meal || qty <= 0) return;
    let row = rows.get(mealId);
    if (!row) {
      row = { meal, byMealType: ZERO(), total: 0, beneficiaries: 0, unitPrice: priceOf(mealId), totalPrice: 0, benIds: new Set() };
      rows.set(mealId, row);
    }
    row.byMealType[mealType] += qty;
    row.total += qty;
    row.benIds.add(benId);
    const m = perBen.get(benId) ?? new Map<string, number>();
    m.set(mealId, (m.get(mealId) ?? 0) + qty);
    perBen.set(benId, m);
  };

  for (const date of dates) {
    for (const mealType of mealTypes) {
      for (const ben of bens) {
        const order = orderByKey.get(`${date}|${mealType}|${entityOf(ben.entity_type)}`);
        const slotId = `${date}|${mealType}|${entityOf(ben.entity_type)}`;
        (order ? usedSlots : regSlots).add(slotId);

        const day = order && typeof order.day_of_week === 'number' && order.day_of_week >= 0 && order.day_of_week <= 6
          ? order.day_of_week
          : weekdayOf(date);
        const orderMealIds = new Set(order?.meal_ids ?? []);

        // قرارات الخانة لا تُعرف إلا من أمر يحمل رقم أسبوع — نفس ضمانة أمر التشغيل
        const overlay = order
          ? buildOrderOverlay({
              week: order.week_number ?? null,
              day,
              mealType,
              orderMealIds: order.meal_ids,
              exclusions: [],
              overrides: overridesByBen.get(ben.id),
            })
          : null;

        const slotItems: { meal_id: string; qty: number; alt: boolean }[] = [];
        for (const fm of ben.fixed_meals) {
          if (fm.day_of_week !== day || fm.meal_type !== mealType) continue;
          if (fm.suppress_if_meal_ids?.some(id => orderMealIds.has(id))) continue;
          const qty = fm.quantity ?? 1;
          const alt = fm.is_alternative === true;
          const decision = overlay?.fixedDecisions.get(fm.meal_id);
          if (decision?.removed) continue;
          slotItems.push({ meal_id: decision?.replacedWith ?? fm.meal_id, qty, alt });
        }
        for (const a of overlay?.added ?? []) {
          // الإضافة الخاصة بالخانة تغلب صنفاً ثابتاً بنفس الاسم — كما في أمر التشغيل
          const i = slotItems.findIndex(s => s.meal_id === a.meal_id);
          const item = { meal_id: a.meal_id, qty: a.quantity, alt: a.is_alternative };
          if (i >= 0) slotItems[i] = item; else slotItems.push(item);
        }

        for (const s of slotItems) if (!s.alt) add(ben.id, s.meal_id, mealType, s.qty);
      }
    }
  }

  const benById = new Map(bens.map(b => [b.id, b]));
  const byBeneficiary = [...perBen.entries()]
    .map(([id, m]) => {
      const b = benById.get(id)!;
      const items = [...m.entries()]
        .map(([mealId, qty]) => ({ meal: meals[mealId], qty }))
        .sort((a, b) => b.qty - a.qty);
      const totalPrice = money(items.reduce((s, x) => s + x.qty * (priceOf(x.meal.id) ?? 0), 0));
      return { id, name: b.name, code: b.code, total: items.reduce((s, x) => s + x.qty, 0), totalPrice, items };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'));

  const outRows = [...rows.values()]
    .map(({ benIds, ...r }) => ({
      ...r,
      beneficiaries: benIds.size,
      totalPrice: r.unitPrice === null ? 0 : money(r.total * r.unitPrice),
    }))
    .sort((a, b) => b.total - a.total);

  return {
    from, to,
    days: dates.length,
    mealTypes,
    entityType,
    slotsFromOrders: countSlots(usedSlots),
    slotsFromRegistration: countSlots(regSlots),
    rows: outRows,
    byBeneficiary,
    grandTotal: outRows.reduce((s, r) => s + r.total, 0),
    grandTotalPrice: money(outRows.reduce((s, r) => s + r.totalPrice, 0)),
    unpricedCount: outRows.filter(r => r.unitPrice === null).length,
  };
}

// الخانة = يوم × وجبة؛ نعدّها مرة وحدة حتى لو شملت الفئتين
function countSlots(keys: Set<string>): number {
  return new Set([...keys].map(k => k.split('|').slice(0, 2).join('|'))).size;
}

export async function buildFixedExtrasReport(
  supabase: SupabaseClient,
  params: { from: string; to: string; mealTypes: MealType[]; entityType?: EntityType },
): Promise<FixedExtrasReport> {
  const { from, to, mealTypes, entityType } = params;

  // الأعمدة الاختيارية (ترقيات قديمة) — نجرّبها كلها ثم نسقطها عند الخطأ
  const fetchBens = (full: boolean) =>
    fetchAllRows((a, b) =>
      supabase
        .from('beneficiaries')
        .select(
          full
            ? 'id, name, code, entity_type, is_active, fixed_meals:beneficiary_fixed_meals(day_of_week, meal_type, meal_id, quantity, suppress_if_meal_ids, is_alternative)'
            : 'id, name, code, fixed_meals:beneficiary_fixed_meals(day_of_week, meal_type, meal_id, quantity)',
        )
        .order('id')
        .range(a, b));

  const fetchOrders = (full: boolean) =>
    fetchAllRows((a, b) =>
      supabase
        .from('daily_orders')
        .select(full
          ? 'id, date, meal_type, entity_type, week_number, day_of_week, order_items(meal_id)'
          : 'id, date, meal_type, order_items(meal_id)')
        .gte('date', from)
        .lte('date', to)
        .in('meal_type', mealTypes)
        .order('id')
        .range(a, b));

  const fetchOverrides = () =>
    fetchAllRows<PersonalMenuOverride & { beneficiary_id: string }>((a, b) =>
      supabase
        .from('beneficiary_menu_overrides')
        .select('id, beneficiary_id, week_number, day_of_week, meal_type, action, base_meal_id, target_meal_id, quantity, is_alternative')
        .in('meal_type', mealTypes)
        .order('id')
        .range(a, b));

  const fetchMeals = () =>
    fetchAllRows((a, b) =>
      supabase.from('meals').select('id, name, english_name, type, is_snack').order('id').range(a, b));

  // أسعار البيع من «الأسعار والتكاليف» — الجدول اختياري (costs-selling-price-migration)
  const fetchPrices = () =>
    fetchAllRows((a, b) =>
      supabase.from('meal_pricing').select('meal_id, selling_price').order('meal_id').range(a, b));

  let [bensRes, ordersRes, ovRes, mealsRes, pricesRes] = await Promise.all([
    fetchBens(true), fetchOrders(true), fetchOverrides(), fetchMeals(), fetchPrices(),
  ]);
  if (bensRes.error) bensRes = await fetchBens(false);
  if (ordersRes.error) ordersRes = await fetchOrders(false);
  if (bensRes.error) throw new Error(bensRes.error.message);
  if (ordersRes.error) throw new Error(ordersRes.error.message);
  if (mealsRes.error) throw new Error(mealsRes.error.message);

  // الـselect ديناميكي فما يستنتج TypeScript شكل الصف — نقصّه لشكله المحلّي
  type BenRow = FixedExtrasBen & { is_active?: boolean };
  type OrderRow = {
    date: string; meal_type: MealType; entity_type?: EntityType;
    week_number?: number; day_of_week?: number; order_items: { meal_id: string }[] | null;
  };
  // numeric يرجع نصاً عبر PostgREST — نحوّله رقماً هنا
  const prices: Record<string, number> = {};
  if (!pricesRes.error) {
    for (const p of (pricesRes.data ?? []) as unknown as { meal_id: string; selling_price: number | string | null }[]) {
      const v = Number(p.selling_price);
      if (p.selling_price !== null && Number.isFinite(v)) prices[p.meal_id] = v;
    }
  }
  const meals: Record<string, Meal> = {};
  for (const m of (mealsRes.data ?? []) as unknown as Meal[]) meals[m.id] = m;

  return computeFixedExtras({
    from, to, mealTypes, entityType,
    // المعطّلون مؤقتاً لا يدخلون الحصر — مثل أوامر التشغيل
    beneficiaries: ((bensRes.data ?? []) as unknown as BenRow[]).filter(b => b.is_active !== false),
    orders: ((ordersRes.data ?? []) as unknown as OrderRow[]).map(o => ({
      date: o.date,
      meal_type: o.meal_type,
      entity_type: o.entity_type,
      week_number: o.week_number,
      day_of_week: o.day_of_week,
      meal_ids: (o.order_items ?? []).map(i => i.meal_id),
    })),
    // جدول القرارات قد لا يكون موجوداً قبل ترقيته — نكمل بدونه
    overrides: ovRes.error ? [] : ovRes.data ?? [],
    meals,
    prices,
  });
}
