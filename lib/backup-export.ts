'use client';

import type { BackupSnapshot } from '@/lib/backup-snapshot';
import type { ItemCategory, MealType, EntityType, MenuItem } from '@/lib/types';
import {
  buildBeneficiaryRow,
  type SheetBeneficiary,
  type SheetExclusion,
  type SheetFixedMeal,
  type SheetMeal,
} from '@/lib/beneficiary-sheet';

// ─── أنواع مساعدة ───────────────────────────────────────────────────────────

interface MealRow {
  id: string; name: string; english_name?: string | null;
  type: MealType; is_snack: boolean; category?: ItemCategory | null;
  entity_type?: EntityType; created_at?: string;
}

interface BeneficiaryRow {
  id: string; name: string; english_name?: string | null;
  code: string; category?: string | null; villa?: string | null;
  diet_type?: string | null; notes?: string | null;
  // حقول كانت غائبة عن ورقة النسخة رغم أن الصفحة تحرّرها
  is_active?: boolean | null;
  no_fish?: boolean | null; no_pasta_sandwich?: boolean | null; low_carb?: boolean | null;
  entity_type?: EntityType; created_at?: string;
}

interface ExclusionRow {
  beneficiary_id: string; meal_id: string;
  alternative_meal_id?: string | null;
}

interface FixedMealRow {
  beneficiary_id: string; day_of_week: number; meal_type: MealType;
  meal_id: string; quantity: number; category?: ItemCategory;
  suppress_if_meal_ids?: string[] | null;
  is_alternative?: boolean | null;
}

interface MenuRow {
  week_number: number; day_of_week: number; meal_type: MealType;
  meal_id: string; category: ItemCategory; position: number;
  multiplier?: number; extra_quantity?: number | null;
  entity_type?: EntityType;
}

interface OrderRow {
  id: string; date: string; meal_type: MealType;
  week_number?: number | null; day_of_week?: number | null;
  entity_type?: EntityType; created_at?: string;
}

interface OrderItemRow {
  order_id: string; meal_id: string;
  display_name?: string | null; extra_quantity?: number | null;
  category?: ItemCategory | null; multiplier?: number | null;
}

interface CustomTranslitRow {
  word: string; transliteration: string;
}

// ─── أنواع منظومة التكاليف ─────────────────────────────────────────────────
interface CostUnitRow { id: string; name: string; family: string; factor: number; is_builtin?: boolean | null }
interface RawMaterialRow { id: string; name: string; unit_id?: string | null; unit_cost: number; notes?: string | null; is_active?: boolean | null }
interface RecipeItemRow { id: string; meal_id: string; raw_material_id: string; quantity: number; unit_id?: string | null }
interface MealPriceRow { meal_id: string; selling_price: number; notes?: string | null }
interface OrderCostSnapshotRow { order_id: string; total_cost: number; frozen_at?: string | null; frozen_by_name?: string | null }
interface MealAlternativeRow { meal_id: string; alternative_id: string }
interface DietColorRow { diet_type: string; color: string }

// ─── أنواع منظومة التسليم ──────────────────────────────────────────────────
interface CityRow { id: string; name: string; created_at?: string }
interface DeliveryLocationRow { id: string; name: string; city_id?: string | null; created_at?: string }
interface DeliveryMealRow { id: string; name: string; meal_type: MealType; is_snack: boolean; created_at?: string }
interface DeliveryOrderRow {
  id: string; order_number: string; date: string; meal_type: string;
  delivery_location_id?: string | null;
  notes?: string | null;
  created_at?: string;
}
interface DeliveryOrderItemRow {
  id: string; delivery_order_id: string; display_name: string;
  meal_type: string; quantity: number; position: number;
}

// ─── خرائط مساعدة ───────────────────────────────────────────────────────────

const DAY_SHORT: Record<number, string> = {
  0: 'احد', 1: 'اثنين', 2: 'ثلاثاء', 3: 'اربعاء', 4: 'خميس', 5: 'جمعة', 6: 'سبت',
};

const MEAL_TYPE_AR: Record<MealType, string> = {
  breakfast: 'فطور',
  lunch: 'غداء',
  dinner: 'عشاء',
};

const CAT_AR: Record<ItemCategory, string> = {
  hot: 'حار',
  cold: 'بارد',
  snack: 'سناك',
};

// ─── تحويل الجداول إلى صفوف Excel — نفس الصيغ المستعملة في الصفحات ─────────

function buildBeneficiariesSheet(
  bens: BeneficiaryRow[],
  meals: MealRow[],
  exclusions: ExclusionRow[],
  fixed: FixedMealRow[],
  entityType: EntityType,
): Record<string, string>[] {
  // نفس الصيغة التي تصدّرها صفحة المستفيدين حرفياً — مصدر واحد في
  // lib/beneficiary-sheet، فما تتباعد ورقة النسخة عن ملف الصفحة مرة أخرى.
  const mealsById = new Map<string, SheetMeal>(
    meals.map(m => [m.id, { id: m.id, name: m.name, type: m.type, is_snack: m.is_snack }] as const),
  );
  const exclByBen = new Map<string, ExclusionRow[]>();
  for (const e of exclusions) {
    const list = exclByBen.get(e.beneficiary_id);
    if (list) list.push(e); else exclByBen.set(e.beneficiary_id, [e]);
  }
  const fixedByBen = new Map<string, FixedMealRow[]>();
  for (const f of fixed) {
    const list = fixedByBen.get(f.beneficiary_id);
    if (list) list.push(f); else fixedByBen.set(f.beneficiary_id, [f]);
  }

  return bens
    .filter(b => (b.entity_type ?? 'beneficiary') === entityType)
    .map(b => buildBeneficiaryRow(
      b as SheetBeneficiary,
      (exclByBen.get(b.id) ?? []) as SheetExclusion[],
      (fixedByBen.get(b.id) ?? []) as SheetFixedMeal[],
      mealsById,
    ));
}

function buildMealsSheet(meals: MealRow[], entityType: EntityType): Record<string, string>[] {
  return meals
    .filter(m => (m.entity_type ?? 'beneficiary') === entityType)
    .map(m => {
      const cat: ItemCategory = (m.category as ItemCategory | undefined) ?? (m.is_snack ? 'snack' : 'hot');
      return {
        'الاسم': m.name,
        'الاسم الإنجليزي': m.english_name ?? '',
        'نوع الوجبة': MEAL_TYPE_AR[m.type] ?? m.type,
        'سناك': m.is_snack ? 'نعم' : 'لا',
        'الفئة': CAT_AR[cat],
      };
    });
}

function buildMenuSheets(
  menu: MenuRow[],
  meals: MealRow[],
  entityType: EntityType,
): Array<{ title: string; rows: Record<string, string>[] }> {
  const mealsById = new Map(meals.map(m => [m.id, m] as const));
  const filtered = menu.filter(mi => (mi.entity_type ?? 'beneficiary') === entityType);

  // ورقة لكل أسبوع — جدول مسطّح (أسبوع/يوم/وجبة/تصنيف/صنف/مضاعف/كمية إضافية)
  // أبسط من إعادة بناء التصميم البصري الشبكي في export الأصلي،
  // لكن مفصّل ويُستورد مرة ثانية يدوياً عند الحاجة.
  const out: Array<{ title: string; rows: Record<string, string>[] }> = [];
  for (const week of [1, 2, 3, 4]) {
    const rows: Record<string, string>[] = [];
    for (const item of filtered.filter(i => i.week_number === week)) {
      const m = mealsById.get(item.meal_id);
      rows.push({
        'الأسبوع': String(week),
        'اليوم': DAY_SHORT[item.day_of_week] ?? String(item.day_of_week),
        'الوجبة': MEAL_TYPE_AR[item.meal_type] ?? item.meal_type,
        'التصنيف': CAT_AR[item.category] ?? item.category,
        'الصنف': m?.name ?? `(محذوف: ${item.meal_id})`,
        'المضاعف': String(item.multiplier ?? 1),
        'الكمية الإضافية': String(item.extra_quantity ?? 0),
        'الترتيب': String(item.position),
      });
    }
    if (rows.length > 0) {
      out.push({ title: `منيو أسبوع ${week}`, rows });
    }
  }
  return out;
}

function buildOrdersSheet(
  orders: OrderRow[],
  orderItems: OrderItemRow[],
  meals: MealRow[],
): Record<string, string>[] {
  const mealsById = new Map(meals.map(m => [m.id, m] as const));
  const itemsByOrder = new Map<string, OrderItemRow[]>();
  for (const it of orderItems) {
    const list = itemsByOrder.get(it.order_id) ?? [];
    list.push(it);
    itemsByOrder.set(it.order_id, list);
  }
  return orders.map(o => {
    const items = itemsByOrder.get(o.id) ?? [];
    const itemsStr = items.map(it => {
      const m = mealsById.get(it.meal_id);
      const nameRaw = it.display_name || m?.name || '';
      const mult = it.multiplier ?? 1;
      const extra = it.extra_quantity ?? 0;
      const cat = it.category ? CAT_AR[it.category] : '';
      const parts = [nameRaw];
      if (mult > 1) parts.push(`×${mult}`);
      if (extra) parts.push(`+${extra}`);
      if (cat) parts.push(`(${cat})`);
      return parts.join(' ');
    }).join(' | ');
    return {
      'التاريخ': o.date,
      'الوجبة': MEAL_TYPE_AR[o.meal_type] ?? o.meal_type,
      'الفئة': o.entity_type === 'companion' ? 'المرافقون' : 'المستفيدون',
      'الأسبوع': o.week_number != null ? String(o.week_number) : '',
      'اليوم': o.day_of_week != null ? (DAY_SHORT[o.day_of_week] ?? '') : '',
      'الأصناف': itemsStr,
      'تاريخ الإنشاء': o.created_at ?? '',
    };
  });
}

function buildTranslitSheet(t: CustomTranslitRow[]): Record<string, string>[] {
  return t.map(r => ({
    'الكلمة': r.word,
    'الترجمة الحرفية': r.transliteration,
  }));
}

// ─── أوراق منظومة التسليم ──────────────────────────────────────────────────

function buildDeliveryMealsSheet(meals: DeliveryMealRow[]): Record<string, string>[] {
  return meals.map(m => ({
    'الاسم': m.name,
    'نوع الوجبة': MEAL_TYPE_AR[m.meal_type] ?? m.meal_type,
    'سناك': m.is_snack ? 'نعم' : 'لا',
  }));
}

function buildDeliveryLocationsSheet(
  locs: DeliveryLocationRow[],
  cities: CityRow[],
): Record<string, string>[] {
  const cityById = new Map(cities.map(c => [c.id, c.name] as const));
  return locs.map(l => ({
    'الموقع': l.name,
    'المدينة': l.city_id ? (cityById.get(l.city_id) ?? '') : '',
  }));
}

function buildDeliveryOrdersSheet(
  orders: DeliveryOrderRow[],
  items: DeliveryOrderItemRow[],
  locs: DeliveryLocationRow[],
  cities: CityRow[],
): Record<string, string>[] {
  const cityById = new Map(cities.map(c => [c.id, c.name] as const));
  const locById = new Map(locs.map(l => [l.id, l] as const));
  const itemsByOrder = new Map<string, DeliveryOrderItemRow[]>();
  for (const it of items) {
    const arr = itemsByOrder.get(it.delivery_order_id) ?? [];
    arr.push(it);
    itemsByOrder.set(it.delivery_order_id, arr);
  }
  const mealTypeAr = (mt: string) =>
    mt === 'all' ? 'فطور + غداء + عشاء' : (MEAL_TYPE_AR[mt as MealType] ?? mt);

  return orders.map(o => {
    const loc = o.delivery_location_id ? locById.get(o.delivery_location_id) : null;
    const cityName = loc?.city_id ? (cityById.get(loc.city_id) ?? '') : '';
    const ordItems = (itemsByOrder.get(o.id) ?? []).slice().sort((a, b) => a.position - b.position);
    const itemsStr = ordItems.map(it => {
      const mt = mealTypeAr(it.meal_type);
      return `${it.display_name} (${mt}) ×${it.quantity}`;
    }).join(' | ');
    return {
      'رقم الأمر': o.order_number,
      'التاريخ': o.date,
      'نوع الوجبة': mealTypeAr(o.meal_type),
      'موقع التسليم': loc?.name ?? '',
      'المدينة': cityName,
      'الأصناف': itemsStr,
      'الملاحظات': o.notes ?? '',
      'تاريخ الإنشاء': o.created_at ?? '',
    };
  });
}

// ─── أوراق منظومة التكاليف والمراجع ─────────────────────────────────────────
// كانت هذه الجداول خارج النسخة الاحتياطية بالكامل — لا تُحفظ ولا تُستعاد.

function buildCostUnitsSheet(units: CostUnitRow[]): Record<string, string>[] {
  return units.map(u => ({
    'الوحدة': u.name,
    'المجموعة': u.family,
    'المعامل': String(u.factor),
    'مدمجة': u.is_builtin ? 'نعم' : 'لا',
  }));
}

function buildRawMaterialsSheet(mats: RawMaterialRow[], units: CostUnitRow[]): Record<string, string>[] {
  const unitById = new Map(units.map(u => [u.id, u.name] as const));
  return mats.map(m => ({
    'المادة': m.name,
    'وحدة الشراء': m.unit_id ? (unitById.get(m.unit_id) ?? '') : '',
    'سعر الوحدة': String(m.unit_cost ?? 0),
    'مفعّلة': m.is_active === false ? 'لا' : 'نعم',
    'ملاحظات': m.notes ?? '',
  }));
}

function buildRecipesSheet(
  recipes: RecipeItemRow[],
  meals: MealRow[],
  mats: RawMaterialRow[],
  units: CostUnitRow[],
): Record<string, string>[] {
  const mealById = new Map(meals.map(m => [m.id, m] as const));
  const matById  = new Map(mats.map(m => [m.id, m.name] as const));
  const unitById = new Map(units.map(u => [u.id, u.name] as const));
  return recipes.map(r => {
    const meal = mealById.get(r.meal_id);
    return {
      'الصنف': meal?.name ?? `(محذوف: ${r.meal_id})`,
      'الوجبة': meal ? (MEAL_TYPE_AR[meal.type] ?? meal.type) : '',
      'المادة': matById.get(r.raw_material_id) ?? `(محذوفة: ${r.raw_material_id})`,
      'الكمية': String(r.quantity ?? 0),
      'الوحدة': r.unit_id ? (unitById.get(r.unit_id) ?? '') : '',
    };
  });
}

function buildPricingSheet(prices: MealPriceRow[], meals: MealRow[]): Record<string, string>[] {
  const mealById = new Map(meals.map(m => [m.id, m] as const));
  return prices.map(p => {
    const meal = mealById.get(p.meal_id);
    return {
      'الصنف': meal?.name ?? `(محذوف: ${p.meal_id})`,
      'الوجبة': meal ? (MEAL_TYPE_AR[meal.type] ?? meal.type) : '',
      'سعر البيع': String(p.selling_price ?? 0),
      'ملاحظات': p.notes ?? '',
    };
  });
}

function buildFrozenCostsSheet(snaps: OrderCostSnapshotRow[], orders: OrderRow[]): Record<string, string>[] {
  const orderById = new Map(orders.map(o => [o.id, o] as const));
  return snaps.map(s => {
    const o = orderById.get(s.order_id);
    return {
      'التاريخ': o?.date ?? '',
      'الوجبة': o ? (MEAL_TYPE_AR[o.meal_type] ?? o.meal_type) : '',
      'الفئة': o?.entity_type === 'companion' ? 'المرافقون' : 'المستفيدون',
      'التكلفة المجمّدة': String(s.total_cost ?? 0),
      'تاريخ التجميد': s.frozen_at ?? '',
      'جمّدها': s.frozen_by_name ?? '',
    };
  });
}

function buildMealAlternativesSheet(alts: MealAlternativeRow[], meals: MealRow[]): Record<string, string>[] {
  const mealById = new Map(meals.map(m => [m.id, m] as const));
  return alts.map(a => ({
    'الصنف': mealById.get(a.meal_id)?.name ?? `(محذوف: ${a.meal_id})`,
    'البديل': mealById.get(a.alternative_id)?.name ?? `(محذوف: ${a.alternative_id})`,
  }));
}

function buildDietColorsSheet(colors: DietColorRow[]): Record<string, string>[] {
  return colors.map(c => ({ 'النظام الغذائي': c.diet_type, 'اللون': c.color }));
}

// ─── التنزيل كـExcel متعدد الأوراق ──────────────────────────────────────────

export async function downloadBackupAsXLSX(
  snapshot: BackupSnapshot,
  filename: string,
): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  if (!wb.Workbook) wb.Workbook = {};
  if (!wb.Workbook.Views) wb.Workbook.Views = [];
  wb.Workbook.Views[0] = { RTL: true };

  const t = snapshot.tables as unknown as Record<string, unknown[]>;
  const meals = (t.meals ?? []) as unknown as MealRow[];
  const bens = (t.beneficiaries ?? []) as unknown as BeneficiaryRow[];
  const excls = (t.exclusions ?? []) as unknown as ExclusionRow[];
  const fixed = (t.beneficiary_fixed_meals ?? []) as unknown as FixedMealRow[];
  const menu = (t.menu_items ?? []) as unknown as MenuRow[];
  const orders = (t.daily_orders ?? []) as unknown as OrderRow[];
  const orderItems = (t.order_items ?? []) as unknown as OrderItemRow[];
  const translit = (t.custom_transliterations ?? []) as unknown as CustomTranslitRow[];
  // منظومة أوامر التسليم
  const cities = (t.cities ?? []) as unknown as CityRow[];
  const deliveryLocs = (t.delivery_locations ?? []) as unknown as DeliveryLocationRow[];
  const deliveryMeals = (t.delivery_meals ?? []) as unknown as DeliveryMealRow[];
  const deliveryOrders = (t.delivery_orders ?? []) as unknown as DeliveryOrderRow[];
  const deliveryItems = (t.delivery_order_items ?? []) as unknown as DeliveryOrderItemRow[];
  // منظومة التكاليف + المراجع
  const costUnits   = (t.cost_units ?? []) as unknown as CostUnitRow[];
  const rawMats     = (t.raw_materials ?? []) as unknown as RawMaterialRow[];
  const recipes     = (t.meal_recipe_items ?? []) as unknown as RecipeItemRow[];
  const pricing     = (t.meal_pricing ?? []) as unknown as MealPriceRow[];
  const frozenCosts = (t.order_cost_snapshots ?? []) as unknown as OrderCostSnapshotRow[];
  const mealAlts    = (t.meal_alternatives ?? []) as unknown as MealAlternativeRow[];
  const dietColors  = (t.lunch_dinner_diet_colors ?? []) as unknown as DietColorRow[];

  const addSheet = (title: string, rows: Record<string, string>[]) => {
    if (rows.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(rows);
    // عرض الأعمدة أوتوماتيكياً
    const cols = Object.keys(rows[0] ?? {}).map(key => ({
      wch: Math.max(
        key.length,
        ...rows.map(r => String(r[key] ?? '').length),
        12,
      ) + 2,
    }));
    ws['!cols'] = cols;
    ws['!sheetView'] = [{ rightToLeft: true } as unknown as never];
    // أسماء الأوراق محدودة بـ31 حرف في Excel
    XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
  };

  // 1) المستفيدون والمرافقون
  addSheet('المستفيدون', buildBeneficiariesSheet(bens, meals, excls, fixed, 'beneficiary'));
  addSheet('المرافقون',  buildBeneficiariesSheet(bens, meals, excls, fixed, 'companion'));

  // 2) أصناف كل فئة
  addSheet('أصناف المستفيدين', buildMealsSheet(meals, 'beneficiary'));
  addSheet('أصناف المرافقين',  buildMealsSheet(meals, 'companion'));

  // 3) المنيو لكل فئة — جدول مسطّح للقراءة البشرية
  for (const sheet of buildMenuSheets(menu, meals, 'beneficiary')) {
    addSheet(`${sheet.title} - مستفيدين`, sheet.rows);
  }
  for (const sheet of buildMenuSheets(menu, meals, 'companion')) {
    addSheet(`${sheet.title} - مرافقين`, sheet.rows);
  }

  // 3ب) نسخة المنيو بصيغة الشبكة **القابلة لإعادة الاستيراد** من صفحة قائمة
  //     الطعام مباشرة. الجدول المسطّح أعلاه للقراءة فقط، فلو احتاج المستخدم
  //     يرجّع المنيو وحده (بلا استعادة كاملة) كان لازم يعيد إدخاله يدوياً.
  await appendImportableMenuSheets(XLSX, wb, menu, meals);

  // 4) أوامر التشغيل
  addSheet('أوامر التشغيل', buildOrdersSheet(orders, orderItems, meals));

  // 5) منظومة أوامر التسليم
  addSheet('أصناف التسليم',  buildDeliveryMealsSheet(deliveryMeals));
  addSheet('مواقع التسليم',  buildDeliveryLocationsSheet(deliveryLocs, cities));
  addSheet('أوامر التسليم',  buildDeliveryOrdersSheet(deliveryOrders, deliveryItems, deliveryLocs, cities));

  // 6) منظومة التكاليف
  addSheet('وحدات القياس',    buildCostUnitsSheet(costUnits));
  addSheet('المواد الأولية',  buildRawMaterialsSheet(rawMats, costUnits));
  addSheet('الوصفات',         buildRecipesSheet(recipes, meals, rawMats, costUnits));
  addSheet('أسعار البيع',     buildPricingSheet(pricing, meals));
  addSheet('تكاليف مجمّدة',   buildFrozenCostsSheet(frozenCosts, orders));

  // 7) مراجع وإعدادات
  addSheet('بدائل الأصناف',        buildMealAlternativesSheet(mealAlts, meals));
  addSheet('ألوان الأنظمة',        buildDietColorsSheet(dietColors));
  addSheet('الترجمة الحرفية',      buildTranslitSheet(translit));

  // ورقة Meta للنسخة
  const metaRows: Record<string, string>[] = [
    { 'الحقل': 'تاريخ النسخة', 'القيمة': snapshot.taken_at },
    { 'الحقل': 'الإصدار', 'القيمة': String(snapshot.version) },
    ...Object.entries(snapshot.tables).map(([table, rows]) => ({
      'الحقل': `عدد ${table}`,
      'القيمة': String(rows.length),
    })),
  ];
  addSheet('Meta', metaRows);

  XLSX.writeFile(wb, filename);
}

/**
 * يُلحق أوراق المنيو بصيغة الشبكة نفسها التي تصدّرها صفحة قائمة الطعام —
 * ورقة لكل (فئة × أسبوع)، فيمكن نسخ ورقة ورفعها في الصفحة مباشرة.
 * أسماء الأوراق تحمل لاحقة الفئة، والقارئ يتعرّف على الأسبوع من رقمه في الاسم.
 */
async function appendImportableMenuSheets(
  XLSX: typeof import('xlsx'),
  wb: import('xlsx').WorkBook,
  menu: MenuRow[],
  meals: MealRow[],
): Promise<void> {
  const { buildMenuWorkbook } = await import('@/components/menu/menu-xlsx');
  const mealsById = new Map(meals.map(m => [m.id, m] as const));

  for (const entityType of ['beneficiary', 'companion'] as EntityType[]) {
    const items: MenuItem[] = menu
      .filter(mi => (mi.entity_type ?? 'beneficiary') === entityType)
      .map(mi => ({
        // معرّف مشتقّ من المفتاح الفريد — يكفي لكسر التعادل في الترتيب الثابت
        id: `${mi.week_number}|${mi.day_of_week}|${mi.meal_type}|${mi.meal_id}`,
        week_number: mi.week_number,
        day_of_week: mi.day_of_week,
        meal_type: mi.meal_type,
        meal_id: mi.meal_id,
        category: mi.category,
        position: mi.position,
        multiplier: mi.multiplier ?? 1,
        extra_quantity: mi.extra_quantity ?? 0,
        entity_type: entityType,
        created_at: '',
        meals: (() => {
          const m = mealsById.get(mi.meal_id);
          if (!m) return undefined;
          return {
            id: m.id,
            name: m.name,
            english_name: m.english_name ?? undefined,
            type: m.type,
            is_snack: m.is_snack,
            category: m.category ?? undefined,
            entity_type: m.entity_type,
            created_at: m.created_at ?? '',
          };
        })(),
      }));
    if (items.length === 0) continue;

    const suffix = entityType === 'companion' ? 'مرافقين' : 'مستفيدين';
    const src = buildMenuWorkbook(XLSX, items);
    for (const name of src.SheetNames) {
      XLSX.utils.book_append_sheet(wb, src.Sheets[name], `${name} ${suffix}`.slice(0, 31));
    }
  }
}

// ─── التنزيل كـSQL ──────────────────────────────────────────────────────────

function toSqlLiteral(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return isFinite(val) ? String(val) : 'NULL';
  if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
  return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
}

export function downloadBackupAsSQL(snapshot: BackupSnapshot, filename: string): void {
  const tables = Object.keys(snapshot.tables) as (keyof typeof snapshot.tables)[];
  const lines: string[] = [
    '-- ============================================================',
    '-- نسخة احتياطية — نظام إدارة الوجبات',
    `-- تاريخ النسخة: ${snapshot.taken_at}`,
    `-- الإصدار: ${snapshot.version}`,
    '-- ============================================================',
    '-- للاستخدام: شغّل هذا الملف في Supabase SQL Editor أو psql',
    '-- ============================================================',
    '',
    'BEGIN;',
    '',
    '-- تعطيل قيود المفاتيح الخارجية مؤقتاً لتسهيل الإدراج',
    "SET session_replication_role = replica;",
    '',
    '-- ─── حذف البيانات القديمة (بترتيب عكسي لتجنب تعارض FKs) ───',
  ];

  for (const table of [...tables].reverse()) {
    lines.push(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE;`);
  }
  lines.push('');

  for (const table of tables) {
    const rows = snapshot.tables[table] as Record<string, unknown>[];
    lines.push(`-- ─── جدول: ${table} (${rows.length} صف) ───`);
    if (rows.length === 0) { lines.push(''); continue; }

    const cols = Object.keys(rows[0]);
    const colList = cols.map(c => `"${c}"`).join(', ');
    const valueGroups = rows.map(row => {
      const vals = cols.map(c => toSqlLiteral(row[c])).join(', ');
      return `  (${vals})`;
    });
    lines.push(`INSERT INTO "${table}" (${colList}) VALUES`);
    lines.push(valueGroups.join(',\n') + ';');
    lines.push('');
  }

  lines.push('-- إعادة تفعيل قيود المفاتيح الخارجية');
  lines.push("SET session_replication_role = DEFAULT;");
  lines.push('');
  lines.push('COMMIT;');

  const blob = new Blob([lines.join('\n')], { type: 'application/sql;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── التنزيل كـJSON ─────────────────────────────────────────────────────────

export function downloadBackupAsJSON(snapshot: BackupSnapshot, filename: string): void {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
