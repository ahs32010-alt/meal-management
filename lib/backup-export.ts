'use client';

import { BACKUP_TABLES, BACKUP_TABLE_LABELS, type BackupSnapshot } from '@/lib/backup-snapshot';
import type { ItemCategory, MealType, EntityType, MenuItem, DeliveryOrder } from '@/lib/types';
import {
  buildBeneficiaryRow,
  type SheetBeneficiary,
  type SheetExclusion,
  type SheetFixedMeal,
  type SheetMeal,
  type SheetMenuOverride,
} from '@/lib/beneficiary-sheet';
import { buildMealRow } from '@/lib/meal-sheet';
import { buildDeliveryOrderRow } from '@/lib/delivery-order-sheet';

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
  custom_ld_meals?: boolean | null;
  entity_type?: EntityType; created_at?: string;
}

interface ExclusionRow {
  beneficiary_id: string; meal_id: string;
  alternative_meal_id?: string | null;
  diet_id?: string | null;
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

// ─── الأنظمة الغذائية والإعدادات (أُضيفت للنسخة بلا أوراق مقروءة) ───────────
interface DietSystemRow { id: string; name: string; description?: string | null }
interface DietSystemExclusionRow { diet_id: string; meal_id: string; alternative_meal_id?: string | null }
interface BeneficiaryDietRow { beneficiary_id: string; diet_id: string }
interface FixedExtraManualRow {
  meal_id: string; meal_type: MealType; quantity: number;
  start_date?: string | null; end_date?: string | null;
}
interface MenuOverrideRow {
  beneficiary_id: string; week_number: number; day_of_week: number; meal_type: MealType;
  action: 'replace' | 'remove' | 'add';
  base_meal_id?: string | null; target_meal_id?: string | null;
  quantity?: number | null; is_alternative?: boolean | null;
}
interface StickerSettingsRow { diet_order?: string[] | null; show_diet_order?: boolean | null }
interface DeliveryCreatorRow { id: string; name: string; phone?: string | null }
type PrintHeaderRow = Record<string, unknown>;

// ─── أنواع منظومة التسليم ──────────────────────────────────────────────────
interface CityRow { id: string; name: string; created_at?: string }
interface DeliveryLocationRow { id: string; name: string; city_id?: string | null; created_at?: string }
interface DeliveryMealRow { id: string; name: string; meal_type: MealType; is_snack: boolean; created_at?: string }
interface DeliveryOrderRow {
  id: string; order_number: string; date: string; meal_type: string;
  /** غائب في النسخ المأخوذة قبل ترقية الفئة — تُقرأ وقتها كمستفيدين */
  entity_type?: string | null;
  delivery_location_id?: string | null;
  creator_id?: string | null;
  created_by_name?: string | null;
  created_by_phone?: string | null;
  delivery_date?: string | null;
  delivery_time?: string | null;
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
  diets: DietSystemRow[] = [],
  benDiets: BeneficiaryDietRow[] = [],
  overrides: MenuOverrideRow[] = [],
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
  const group = <T extends { beneficiary_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const list = m.get(r.beneficiary_id);
      if (list) list.push(r); else m.set(r.beneficiary_id, [r]);
    }
    return m;
  };
  const dietNameById = new Map(diets.map(d => [d.id, d.name] as const));
  const dietsByBen = group(benDiets);
  const overridesByBen = group(overrides);

  return bens
    .filter(b => (b.entity_type ?? 'beneficiary') === entityType)
    .map(b => buildBeneficiaryRow(
      {
        ...b,
        diet_names: (dietsByBen.get(b.id) ?? [])
          .map(d => dietNameById.get(d.diet_id) ?? '').filter(Boolean),
      } as SheetBeneficiary,
      // المحظورات المشتقّة من نظام غذائي (diet_id) تُعاد بناؤها من عمود الأنظمة —
      // كتابتها كمحظور شخصي تجعلها تبقى حتى لو أُزيل النظام. نفس فلتر الصفحة.
      (exclByBen.get(b.id) ?? []).filter(e => !e.diet_id) as SheetExclusion[],
      (fixedByBen.get(b.id) ?? []) as SheetFixedMeal[],
      mealsById,
      (overridesByBen.get(b.id) ?? []) as SheetMenuOverride[],
    ));
}

function buildMealsSheet(meals: MealRow[], entityType: EntityType): Record<string, string>[] {
  // نفس صيغة صفحة الأصناف حرفياً (lib/meal-sheet) — السناك دائماً «سناك»
  // حتى لو بقيت له فئة قديمة، فتُستورد الورقة في الصفحة بلا فروق.
  return meals
    .filter(m => (m.entity_type ?? 'beneficiary') === entityType)
    .map(m => buildMealRow({ ...m, english_name: m.english_name ?? undefined, category: m.category ?? undefined }));
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
  creators: DeliveryCreatorRow[] = [],
): Record<string, string>[] {
  // نفس صيغة صفحة أوامر التسليم (lib/delivery-order-sheet) — كانت الورقة تكتب
  // «المنشئ» بلا ضمة وبترتيب أعمدة مختلف عن ملف الصفحة.
  const cityById = new Map(cities.map(c => [c.id, c] as const));
  const creatorById = new Map(creators.map(c => [c.id, c] as const));
  const locById = new Map(locs.map(l => [l.id, l] as const));
  const itemsByOrder = new Map<string, DeliveryOrderItemRow[]>();
  for (const it of items) {
    const arr = itemsByOrder.get(it.delivery_order_id) ?? [];
    arr.push(it);
    itemsByOrder.set(it.delivery_order_id, arr);
  }

  return orders.map(o => {
    const loc = o.delivery_location_id ? locById.get(o.delivery_location_id) : undefined;
    return buildDeliveryOrderRow({
      ...o,
      delivery_locations: loc
        ? { ...loc, cities: loc.city_id ? cityById.get(loc.city_id) ?? null : null }
        : null,
      delivery_creators: o.creator_id ? creatorById.get(o.creator_id) ?? null : null,
      delivery_order_items: itemsByOrder.get(o.id) ?? [],
    } as unknown as DeliveryOrder);
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

// ─── الأنظمة الغذائية / الإضافات اليدوية / تعديلات المنيو / الإعدادات ───────
// جداول تُحفظ وتُستعاد منذ مدة، لكن ملف Excel كان يخلو منها تماماً.

function buildDietSystemsSheet(
  diets: DietSystemRow[],
  dietExcl: DietSystemExclusionRow[],
  benDiets: BeneficiaryDietRow[],
  bens: BeneficiaryRow[],
  meals: MealRow[],
): Record<string, string>[] {
  const mealName = new Map(meals.map(m => [m.id, m.name] as const));
  const benById = new Map(bens.map(b => [b.id, b] as const));
  return diets.map(d => {
    const excl = dietExcl
      .filter(x => x.diet_id === d.id)
      .map(x => {
        const name = mealName.get(x.meal_id) ?? `(محذوف: ${x.meal_id})`;
        const alt = x.alternative_meal_id ? (mealName.get(x.alternative_meal_id) ?? `(محذوف: ${x.alternative_meal_id})`) : '';
        return alt ? `${name} ← ${alt}` : name;
      });
    const members = benDiets
      .filter(bd => bd.diet_id === d.id)
      .map(bd => {
        const b = benById.get(bd.beneficiary_id);
        return b ? `${b.name} (${b.code})` : `(محذوف: ${bd.beneficiary_id})`;
      });
    return {
      'النظام': d.name,
      'الوصف': d.description ?? '',
      'الأصناف المستبعدة (← البديل)': excl.join(' | '),
      'عدد المستفيدين': String(members.length),
      'المستفيدون': members.join('، '),
    };
  });
}

function buildFixedExtrasManualSheet(rows: FixedExtraManualRow[], meals: MealRow[]): Record<string, string>[] {
  const mealName = new Map(meals.map(m => [m.id, m.name] as const));
  return rows.map(r => ({
    'الصنف': mealName.get(r.meal_id) ?? `(محذوف: ${r.meal_id})`,
    'الوجبة': MEAL_TYPE_AR[r.meal_type] ?? r.meal_type,
    'العدد اليومي': String(r.quantity ?? 0),
    'من تاريخ': r.start_date ?? '',
    'إلى تاريخ': r.end_date ?? 'مستمر',
  }));
}

const OVERRIDE_ACTION_AR: Record<MenuOverrideRow['action'], string> = {
  replace: 'استبدال',
  remove: 'حذف',
  add: 'إضافة',
};

function buildMenuOverridesSheet(
  rows: MenuOverrideRow[],
  bens: BeneficiaryRow[],
  meals: MealRow[],
): Record<string, string>[] {
  const mealName = new Map(meals.map(m => [m.id, m.name] as const));
  const benById = new Map(bens.map(b => [b.id, b] as const));
  const name = (id?: string | null) => (id ? (mealName.get(id) ?? `(محذوف: ${id})`) : '');
  return rows.map(r => {
    const b = benById.get(r.beneficiary_id);
    return {
      'المستفيد': b?.name ?? `(محذوف: ${r.beneficiary_id})`,
      'الكود': b?.code ?? '',
      'الأسبوع': String(r.week_number),
      'اليوم': DAY_SHORT[r.day_of_week] ?? String(r.day_of_week),
      'الوجبة': MEAL_TYPE_AR[r.meal_type] ?? r.meal_type,
      'الإجراء': OVERRIDE_ACTION_AR[r.action] ?? r.action,
      'الصنف الأساسي': name(r.base_meal_id),
      'الصنف البديل/المضاف': name(r.target_meal_id),
      'الكمية': r.action === 'add' ? String(r.quantity ?? 1) : '',
      'يُحتسب كبديل': r.is_alternative ? 'نعم' : 'لا',
    };
  });
}

function buildDeliveryCreatorsSheet(rows: DeliveryCreatorRow[]): Record<string, string>[] {
  return rows.map(c => ({ 'الاسم': c.name, 'الجوال': c.phone ?? '' }));
}

function buildStickerSettingsSheet(rows: StickerSettingsRow[]): Record<string, string>[] {
  return rows.map(r => ({
    'ترتيب الأنظمة في الستيكرات': (r.diet_order ?? []).join(' ← '),
    'إظهار الترتيب': r.show_diet_order === false ? 'لا' : 'نعم',
  }));
}

const PRINT_HEADER_AR: Record<string, string> = {
  company_name_ar: 'اسم الشركة (عربي)',
  company_name_en: 'اسم الشركة (إنجليزي)',
  address_line1: 'العنوان ١',
  address_line2: 'العنوان ٢',
  cr_number: 'السجل التجاري',
  vat_number: 'الرقم الضريبي',
  title_ar: 'العنوان (عربي)',
  title_en: 'العنوان (إنجليزي)',
  logo_url: 'رابط الشعار',
  default_creator_signature_url: 'توقيع المنشئ الافتراضي',
};

function buildPrintHeaderSheet(rows: PrintHeaderRow[]): Record<string, string>[] {
  const h = rows[0];
  if (!h) return [];
  return Object.entries(PRINT_HEADER_AR).map(([key, label]) => ({
    'الحقل': label,
    'القيمة': h[key] == null ? '' : String(h[key]),
  }));
}

// ─── التنزيل كـExcel متعدد الأوراق ──────────────────────────────────────────

export interface BackupSheet { title: string; rows: Record<string, string>[] }

/**
 * كل الأوراق المقروءة في ملف Excel للنسخة (عدا أوراق المنيو القابلة لإعادة
 * الاستيراد، وتُلحق عند التنزيل). دالة نقية — تُختبر بلا متصفح.
 * الأوراق الفارغة تُحذف.
 */
export function buildBackupSheets(snapshot: BackupSnapshot): BackupSheet[] {
  const t = snapshot.tables as unknown as Record<string, unknown[]>;
  const meals = (t.meals ?? []) as unknown as MealRow[];
  const bens = (t.beneficiaries ?? []) as unknown as BeneficiaryRow[];
  // الشخصية فقط — صفوف الأنظمة الغذائية مشتقة، وورقة المستفيدين تُستورد
  const excls = ((t.exclusions ?? []) as unknown as ExclusionRow[]).filter(e => !e.diet_id);
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
  const creators = (t.delivery_creators ?? []) as unknown as DeliveryCreatorRow[];
  const printHeader = (t.delivery_print_header ?? []) as unknown as PrintHeaderRow[];
  // منظومة التكاليف + المراجع
  const costUnits   = (t.cost_units ?? []) as unknown as CostUnitRow[];
  const rawMats     = (t.raw_materials ?? []) as unknown as RawMaterialRow[];
  const recipes     = (t.meal_recipe_items ?? []) as unknown as RecipeItemRow[];
  const pricing     = (t.meal_pricing ?? []) as unknown as MealPriceRow[];
  const frozenCosts = (t.order_cost_snapshots ?? []) as unknown as OrderCostSnapshotRow[];
  const mealAlts    = (t.meal_alternatives ?? []) as unknown as MealAlternativeRow[];
  const dietColors  = (t.lunch_dinner_diet_colors ?? []) as unknown as DietColorRow[];
  // الأنظمة الغذائية والإعدادات
  const diets       = (t.diet_systems ?? []) as unknown as DietSystemRow[];
  const dietExcl    = (t.diet_system_exclusions ?? []) as unknown as DietSystemExclusionRow[];
  const benDiets    = (t.beneficiary_diets ?? []) as unknown as BeneficiaryDietRow[];
  const fixedExtras = (t.fixed_extras_manual ?? []) as unknown as FixedExtraManualRow[];
  const overrides   = (t.beneficiary_menu_overrides ?? []) as unknown as MenuOverrideRow[];
  const stickerSet  = (t.sticker_settings ?? []) as unknown as StickerSettingsRow[];

  const out: BackupSheet[] = [];
  const add = (title: string, rows: Record<string, string>[]) => {
    if (rows.length > 0) out.push({ title, rows });
  };

  // 1) المستفيدون والمرافقون
  add('المستفيدون', buildBeneficiariesSheet(bens, meals, excls, fixed, 'beneficiary', diets, benDiets, overrides));
  add('المرافقون',  buildBeneficiariesSheet(bens, meals, excls, fixed, 'companion', diets, benDiets, overrides));
  add('الأنظمة الغذائية', buildDietSystemsSheet(diets, dietExcl, benDiets, bens, meals));
  add('تعديلات منيو المستفيدين', buildMenuOverridesSheet(overrides, bens, meals));

  // 2) أصناف كل فئة
  add('أصناف المستفيدين', buildMealsSheet(meals, 'beneficiary'));
  add('أصناف المرافقين',  buildMealsSheet(meals, 'companion'));

  // 3) المنيو لكل فئة — جدول مسطّح للقراءة البشرية
  for (const sheet of buildMenuSheets(menu, meals, 'beneficiary')) {
    add(`${sheet.title} - مستفيدين`, sheet.rows);
  }
  for (const sheet of buildMenuSheets(menu, meals, 'companion')) {
    add(`${sheet.title} - مرافقين`, sheet.rows);
  }

  // 4) أوامر التشغيل + الإضافات الثابتة اليدوية
  add('أوامر التشغيل', buildOrdersSheet(orders, orderItems, meals));
  add('إضافات ثابتة يدوية', buildFixedExtrasManualSheet(fixedExtras, meals));

  // 5) منظومة أوامر التسليم
  add('أصناف التسليم',  buildDeliveryMealsSheet(deliveryMeals));
  add('مواقع التسليم',  buildDeliveryLocationsSheet(deliveryLocs, cities));
  add('منشئو التسليم',  buildDeliveryCreatorsSheet(creators));
  add('أوامر التسليم',  buildDeliveryOrdersSheet(deliveryOrders, deliveryItems, deliveryLocs, cities, creators));
  add('ترويسة طباعة التسليم', buildPrintHeaderSheet(printHeader));

  // 6) منظومة التكاليف
  add('وحدات القياس',    buildCostUnitsSheet(costUnits));
  add('المواد الأولية',  buildRawMaterialsSheet(rawMats, costUnits));
  add('الوصفات',         buildRecipesSheet(recipes, meals, rawMats, costUnits));
  add('أسعار البيع',     buildPricingSheet(pricing, meals));
  add('تكاليف مجمّدة',   buildFrozenCostsSheet(frozenCosts, orders));

  // 7) مراجع وإعدادات
  add('بدائل الأصناف',        buildMealAlternativesSheet(mealAlts, meals));
  add('ألوان الأنظمة',        buildDietColorsSheet(dietColors));
  add('إعدادات الستيكرات',    buildStickerSettingsSheet(stickerSet));
  add('الترجمة الحرفية',      buildTranslitSheet(translit));

  return out;
}

/** ورقة Meta: تاريخ النسخة + عدد صفوف كل جدول باسمه العربي. */
export function buildBackupMetaRows(snapshot: BackupSnapshot): Record<string, string>[] {
  const labels = BACKUP_TABLE_LABELS as Record<string, string>;
  return [
    { 'الحقل': 'تاريخ النسخة', 'القيمة': snapshot.taken_at },
    { 'الحقل': 'الإصدار', 'القيمة': String(snapshot.version) },
    ...orderedTableNames(snapshot).map(table => ({
      'الحقل': `عدد ${labels[table] ?? table} (${table})`,
      'القيمة': String((snapshot.tables as Record<string, unknown[]>)[table]?.length ?? 0),
    })),
  ];
}

/**
 * أسماء جداول اللقطة بترتيب BACKUP_TABLES (المرجعي قبل التابع) ثم أي جدول
 * إضافي. لازم: عمود snapshot من نوع jsonb لا يحفظ ترتيب المفاتيح، فترتيب
 * Object.keys بعد القراءة من القاعدة اعتباطي.
 */
function orderedTableNames(snapshot: BackupSnapshot): string[] {
  const present = Object.keys(snapshot.tables ?? {});
  const known = (BACKUP_TABLES as readonly string[]).filter(t => present.includes(t));
  return [...known, ...present.filter(t => !known.includes(t))];
}

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
  const menu = (t.menu_items ?? []) as unknown as MenuRow[];

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

  for (const sheet of buildBackupSheets(snapshot)) addSheet(sheet.title, sheet.rows);

  // نسخة المنيو بصيغة الشبكة **القابلة لإعادة الاستيراد** من صفحة قائمة
  // الطعام مباشرة. الجدول المسطّح للقراءة فقط، فلو احتاج المستخدم يرجّع
  // المنيو وحده (بلا استعادة كاملة) كان لازم يعيد إدخاله يدوياً.
  await appendImportableMenuSheets(XLSX, wb, menu, meals);

  // ورقة Meta للنسخة
  addSheet('Meta', buildBackupMetaRows(snapshot));

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

/**
 * أعمدة من نوع مصفوفة Postgres (text[] / uuid[]) داخل جداول النسخة. تحتاج
 * صيغة '{a,b}' — الصيغة السابقة كانت تكتبها JSON ('["a","b"]') فيفشل ملف SQL
 * كاملاً عند أول صنف ثابت فيه «إلا إذا وُجد» أو أول فصل ستيكرات. بقية القيم
 * الكائنية أعمدة jsonb (snapshot / breakdown) وتبقى JSON.
 */
const PG_ARRAY_COLUMNS: Record<string, readonly string[]> = {
  beneficiary_fixed_meals: ['suppress_if_meal_ids'],
  sticker_settings: ['diet_order'],
  sticker_splits: ['split_meal_ids'],
};

function toPgArrayLiteral(arr: unknown[]): string {
  const els = arr.map(v =>
    v == null ? 'NULL' : `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
  );
  return `'{${els.join(',').replace(/'/g, "''")}}'`;
}

export function toSqlLiteral(val: unknown, pgArray = false): string {
  if (val === null || val === undefined) return 'NULL';
  if (pgArray && Array.isArray(val)) return toPgArrayLiteral(val);
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return isFinite(val) ? String(val) : 'NULL';
  if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
  return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
}

/** نص ملف SQL كاملاً — دالة نقية (تُختبر بلا متصفح). */
export function buildBackupSQL(snapshot: BackupSnapshot): string {
  const tables = orderedTableNames(snapshot);
  const all = snapshot.tables as unknown as Record<string, Record<string, unknown>[]>;
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
    '-- تعطيل قيود المفاتيح الخارجية والـtriggers مؤقتاً لتسهيل الإدراج',
    "SET session_replication_role = replica;",
    '',
    '-- ─── حذف البيانات القديمة (بترتيب عكسي لتجنب تعارض FKs) ───',
  ];

  for (const table of [...tables].reverse()) {
    lines.push(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE;`);
  }
  lines.push('');

  for (const table of tables) {
    const rows = all[table] ?? [];
    lines.push(`-- ─── جدول: ${table} (${rows.length} صف) ───`);
    if (rows.length === 0) { lines.push(''); continue; }

    // اتحاد أعمدة كل الصفوف (لا الصف الأول فقط)؛ العمود الغائب عن صف → DEFAULT
    const cols: string[] = [];
    for (const row of rows) for (const c of Object.keys(row)) if (!cols.includes(c)) cols.push(c);
    const arrayCols = PG_ARRAY_COLUMNS[table] ?? [];
    const colList = cols.map(c => `"${c}"`).join(', ');
    const valueGroups = rows.map(row => {
      const vals = cols.map(c => (c in row ? toSqlLiteral(row[c], arrayCols.includes(c)) : 'DEFAULT')).join(', ');
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
  return lines.join('\n');
}

export function downloadBackupAsSQL(snapshot: BackupSnapshot, filename: string): void {
  const blob = new Blob([buildBackupSQL(snapshot)], { type: 'application/sql;charset=utf-8' });
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
