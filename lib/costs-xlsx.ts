// ============================================================================
// استيراد وتصدير بيانات التكاليف بصيغة Excel
//
// ملف واحد بثلاث أوراق مترابطة: الوحدات ← المواد الأولية ← الوصفات.
// نفس الشكل في التصدير والاستيراد، فالدورة كاملة: صدّر ← عدّل ← استورد.
//
// وحدة نقية (بلا 'use client' وبلا قاعدة بيانات) — كل التحقّق يصير هنا قبل
// أي كتابة، عشان الاستيراد يا ينجح كاملاً يا يتوقف بقائمة أخطاء واضحة. صفحة
// التكاليف حسّاسة، والاستيراد الجزئي الصامت أسوأ من الرفض الصريح.
// ============================================================================

import {
  convertQuantity,
  type MealPrice,
  type MealMargin,
  MARGIN_STATUS_LABELS,
  deriveFactor,
  newCustomFamily,
  parsePositiveNumber,
  round,
  type CostUnitDef,
  type CostedOrderItem,
  type RawMaterial,
  type RecipeItem,
} from '@/lib/costs';
import { ENTITY_TYPE_LABELS, MEAL_TYPE_LABELS, type Meal, type MealType, type EntityType } from '@/lib/types';

// ── أسماء الأوراق والأعمدة ──────────────────────────────────────────────────

export const SHEETS = {
  guide:     'تعليمات',
  units:     'الوحدات',
  materials: 'المواد الأولية',
  recipes:   'الوصفات',
  prices:    'أسعار البيع',
} as const;

export const COLS = {
  units: {
    name:      'اسم الوحدة',
    qty:       'تساوي كم',
    reference: 'من وحدة',
  },
  materials: {
    name:  'المادة الأولية',
    unit:  'وحدة الشراء',
    price: 'السعر لكل وحدة',
    notes: 'ملاحظات',
  },
  recipes: {
    meal:     'الصنف',
    mealType: 'الوجبة',
    entity:   'الفئة',
    snack:    'سناك',
    material: 'المادة الأولية',
    qty:      'الكمية للحصة',
    unit:     'الوحدة',
  },
  prices: {
    meal:     'الصنف',
    mealType: 'الوجبة',
    entity:   'الفئة',
    snack:    'سناك',
    price:    'سعر بيع الحصة',
  },
} as const;

/**
 * الأعمدة اللازمة لقراءة كل ورقة. ورقة فيها صفوف وينقصها عمود منها تُرفض
 * بخطأ صريح — بدل ما تُتجاهل صفوفها بصمت ويقول الاستيراد «ما فيه تغيير».
 * أعمدة التمييز (الوجبة/الفئة/سناك) والملاحظات اختيارية.
 */
const REQUIRED_COLS: Record<'units' | 'materials' | 'recipes' | 'prices', string[]> = {
  units:     [COLS.units.name, COLS.units.qty, COLS.units.reference],
  materials: [COLS.materials.name, COLS.materials.unit, COLS.materials.price],
  recipes:   [COLS.recipes.meal, COLS.recipes.material, COLS.recipes.qty, COLS.recipes.unit],
  prices:    [COLS.prices.meal, COLS.prices.price],
};

export const UNIT_HEADERS     = Object.values(COLS.units);
export const MATERIAL_HEADERS = Object.values(COLS.materials);
export const RECIPE_HEADERS   = Object.values(COLS.recipes);
export const PRICE_HEADERS    = Object.values(COLS.prices);

// ── تحويل القيم العربية ─────────────────────────────────────────────────────

const ENTITY_LABEL: Record<EntityType, string> = {
  beneficiary: 'مستفيدون',
  companion:   'مرافقون',
};

const YES = 'نعم';
const NO  = 'لا';

function norm(v: unknown): string {
  return String(v ?? '').trim();
}

/** مقارنة أسماء متسامحة: تتجاهل المسافات الزائدة وحالة الأحرف */
export function nameKey(v: unknown): string {
  return norm(v).replace(/\s+/g, ' ').toLowerCase();
}

export function parseBool(v: unknown): boolean | null {
  const s = nameKey(v);
  if (s === '') return null;
  if (['نعم', 'ن', 'yes', 'y', 'true', '1', '✓'].includes(s)) return true;
  if (['لا', 'no', 'n', 'false', '0', '-'].includes(s)) return false;
  return null;
}

export function parseMealType(v: unknown): MealType | null {
  const s = nameKey(v);
  if (s === '') return null;
  for (const [k, label] of Object.entries(MEAL_TYPE_LABELS)) {
    if (nameKey(label) === s) return k as MealType;
  }
  if (['breakfast', 'lunch', 'dinner'].includes(s)) return s as MealType;
  if (s === 'افطار' || s === 'إفطار') return 'breakfast';
  return null;
}

export function parseEntity(v: unknown): EntityType | null {
  const s = nameKey(v);
  if (s === '') return null;
  if (['مستفيدون', 'مستفيد', 'المستفيدون', 'beneficiary'].includes(s)) return 'beneficiary';
  if (['مرافقون', 'مرافق', 'المرافقون', 'companion'].includes(s)) return 'companion';
  return null;
}

// ── التصدير ─────────────────────────────────────────────────────────────────

export interface ExportInput {
  units: CostUnitDef[];
  materials: RawMaterial[];
  meals: Meal[];
  recipes: RecipeItem[];
  prices: MealPrice[];
}

/** أصغر وحدة في المجموعة — نستخدمها كمرجع عند تصدير الوحدات */
function familyBase(family: string, units: CostUnitDef[]): CostUnitDef | undefined {
  return units.filter(u => u.family === family).sort((a, b) => a.factor - b.factor)[0];
}

export function buildUnitRows(units: CostUnitDef[]) {
  return units
    .slice()
    .sort((a, b) => a.family.localeCompare(b.family) || a.factor - b.factor)
    .map(u => {
      const base = familyBase(u.family, units);
      const isBase = !base || base.id === u.id;
      return {
        [COLS.units.name]:      u.name,
        // الوحدة الأساسية في مجموعتها ما لها مرجع — تُترك فارغة
        [COLS.units.qty]:       isBase ? '' : round(u.factor / base.factor, 8),
        [COLS.units.reference]: isBase ? '' : base.name,
      };
    });
}

export function buildMaterialRows(materials: RawMaterial[], units: CostUnitDef[]) {
  const unitName = (id: string) => units.find(u => u.id === id)?.name ?? '';
  return materials
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
    .map(m => ({
      [COLS.materials.name]:  m.name,
      [COLS.materials.unit]:  unitName(m.unit_id),
      [COLS.materials.price]: round(m.unit_cost, 4),
      [COLS.materials.notes]: m.notes ?? '',
    }));
}

export function buildRecipeRows(input: ExportInput) {
  const { units, materials, meals, recipes } = input;
  const mealById     = new Map(meals.map(m => [m.id, m]));
  const materialById = new Map(materials.map(m => [m.id, m]));
  const unitById     = new Map(units.map(u => [u.id, u]));

  return recipes
    .map(r => {
      const meal = mealById.get(r.meal_id);
      const mat  = materialById.get(r.raw_material_id);
      if (!meal || !mat) return null;
      return {
        [COLS.recipes.meal]:     meal.name,
        [COLS.recipes.mealType]: MEAL_TYPE_LABELS[meal.type],
        [COLS.recipes.entity]:   ENTITY_LABEL[(meal.entity_type as EntityType) ?? 'beneficiary'],
        [COLS.recipes.snack]:    meal.is_snack ? YES : NO,
        [COLS.recipes.material]: mat.name,
        [COLS.recipes.qty]:      round(r.quantity, 4),
        [COLS.recipes.unit]:     unitById.get(r.unit_id)?.name ?? '',
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) =>
      a[COLS.recipes.meal].toString().localeCompare(b[COLS.recipes.meal].toString(), 'ar') ||
      a[COLS.recipes.material].toString().localeCompare(b[COLS.recipes.material].toString(), 'ar'),
    );
}

export function buildPriceRows(meals: Meal[], prices: MealPrice[]) {
  const mealById = new Map(meals.map(m => [m.id, m]));
  return prices
    .map(p => {
      const meal = mealById.get(p.meal_id);
      if (!meal) return null;
      return {
        [COLS.prices.meal]:     meal.name,
        [COLS.prices.mealType]: MEAL_TYPE_LABELS[meal.type],
        [COLS.prices.entity]:   ENTITY_LABEL[(meal.entity_type as EntityType) ?? 'beneficiary'],
        [COLS.prices.snack]:    meal.is_snack ? YES : NO,
        [COLS.prices.price]:    round(p.selling_price, 4),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a[COLS.prices.meal].toString().localeCompare(b[COLS.prices.meal].toString(), 'ar'));
}

/** صفوف ورقة التعليمات — تُقرأ كنص عادي داخل Excel */
export function buildGuideRows() {
  const line = (t: string) => ({ 'كيف تستخدم هذا الملف': t });
  return [
    line('١) ورقة «الوحدات»: أضف وحدة جديدة بكتابة اسمها وكم تساوي من وحدة موجودة.'),
    line(`   مثال: رطل | 0.4536 | كجم    —    كرتون | 24 | حبة`),
    line('   اترك «تساوي كم» و«من وحدة» فارغتين لوحدة مستقلة لا تتحوّل لغيرها.'),
    line(''),
    line('٢) ورقة «المواد الأولية»: اسم المادة، الوحدة اللي تشتري بها، وسعر الوحدة الواحدة.'),
    line('   مثال: زيت | لتر | 100    يعني اللتر بـ100 ريال.'),
    line(''),
    line('٣) ورقة «الوصفات»: سطر لكل مادة داخل الصنف، بالكمية اللازمة لحصة واحدة.'),
    line('   مثال: كبدة | غداء | مستفيدون | لا | زيت | 2 | مل'),
    line('   تقدر تدخل الكمية بأي وحدة من نفس مجموعة وحدة الشراء والنظام يحوّل.'),
    line(''),
    line(''),
    line('٤) ورقة «أسعار البيع»: سعر بيع الحصة الواحدة من الصنف.'),
    line('   مثال: كبدة | غداء | مستفيدون | لا | 12'),
    line('   النظام يحسب الربح = سعر البيع − التكلفة، وهامش الربح تلقائياً.'),
    line('   اترك السطر أو ضع صفراً لإزالة السعر.'),
    line(''),
    line('ملاحظات مهمة:'),
    line('• الأصناف لازم تكون موجودة مسبقاً في صفحة «الأصناف» — الاستيراد ما ينشئها.'),
    line('• أعمدة الوجبة/الفئة/سناك تلزم فقط لو تكرّر اسم الصنف؛ غير كذا اتركها فارغة.'),
    line('• أي صنف يظهر في ورقة «الوصفات» تُستبدل وصفته بالكامل بأسطره في الملف.'),
    line('• الأصناف غير المذكورة في الملف لا تتأثر إطلاقاً.'),
    line('• الوحدات الموجودة لا يتغيّر تعريفها من الملف — الملف يضيف وحدات جديدة فقط.'),
    line('• لا تغيّر أسماء الأوراق ولا رؤوس الأعمدة؛ الأعمدة المحسوبة الإضافية تُتجاهل.'),
    line('• لو فيه أي خطأ، يتوقف الاستيراد كاملاً ويعرض لك الأخطاء — ما ينحفظ شي ناقص.'),
  ];
}

// ── الاستيراد: التحليل والتحقّق ─────────────────────────────────────────────

export interface ImportContext {
  units: CostUnitDef[];
  materials: RawMaterial[];
  meals: Meal[];
  /**
   * الوصفات وأسعار البيع الحالية — اختيارية. عند تمريرها تُستبعد الأصناف
   * والأسعار المطابقة للموجود، فإعادة استيراد ملف مصدَّر بلا تعديل لا تكتب شيئاً.
   */
  recipes?: RecipeItem[];
  prices?: MealPrice[];
}

export interface NewUnit {
  name: string;
  family: string;
  factor: number;
}

export interface MaterialUpsert {
  /** موجود مسبقاً → تحديث، وإلا إنشاء */
  id?: string;
  name: string;
  unitName: string;
  unit_cost: number;
  notes: string | null;
  /** تغيّر شيء فعلاً — الصفوف غير المتغيّرة لا تُكتب */
  changed: boolean;
}

export interface RecipeLineDraft {
  materialName: string;
  quantity: number;
  unitName: string;
}

export interface RecipePlan {
  meal: Meal;
  lines: RecipeLineDraft[];
}

export interface PricePlan {
  meal: Meal;
  /** null يعني إزالة السعر */
  selling_price: number | null;
}

export interface ImportPlan {
  newUnits: NewUnit[];
  materials: MaterialUpsert[];
  recipes: RecipePlan[];
  prices: PricePlan[];
  errors: string[];
  warnings: string[];
  stats: {
    unitsNew: number;
    materialsNew: number;
    materialsUpdated: number;
    materialsUnchanged: number;
    mealsPriced: number;
    recipeLines: number;
    /** وصفات في الملف مطابقة للموجود — لا تُكتب */
    recipesUnchanged: number;
    sellingPricesSet: number;
    sellingPricesRemoved: number;
    /** أسعار بيع مطابقة للموجود — لا تُكتب */
    sellingPricesUnchanged: number;
  };
}

type Row = Record<string, string>;

/**
 * يوحّد أسماء الأوراق ورؤوس الأعمدة بقصّ المسافات الزائدة — مسافة زائدة في
 * رأس عمود عدّله المستخدم كانت تُسقط العمود كاملاً بصمت.
 */
function normalizeSheets(sheets: Record<string, Row[]>): Record<string, Row[]> {
  const out: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(sheets)) {
    out[norm(name)] = (rows ?? []).map(row => {
      const r: Row = {};
      for (const [k, v] of Object.entries(row)) r[norm(k)] = v;
      return r;
    });
  }
  return out;
}

/** ملاحظات المقارنة: الفارغ والـnull سواء */
function notesKey(v: string | null | undefined): string | null {
  return norm(v) || null;
}

/** مفتاح الصنف الفريد: اسم + وجبة + فئة + سناك — تحقّقنا أنه بلا تعارض */
function mealKey(name: string, type: MealType, entity: EntityType, snack: boolean): string {
  return [nameKey(name), type, entity, snack ? '1' : '0'].join('|');
}

/**
 * هل تعريف الوحدة في سطر الملف يختلف عن الوحدة الموجودة؟ السطر الفارغ يعني
 * «وحدة أساسية في مجموعتها»، وغيره يُقارن معامله بعد التحويل للأساس.
 */
function unitDefinitionDiffers(
  existing: CostUnitDef,
  qtyRaw: string,
  refRaw: string,
  unitsByName: Map<string, CostUnitDef>,
  allUnits: CostUnitDef[],
): boolean {
  if (!qtyRaw && !refRaw) {
    const base = familyBase(existing.family, allUnits);
    return !!base && base.id !== existing.id;
  }
  const ref = unitsByName.get(nameKey(refRaw));
  const qty = parsePositiveNumber(qtyRaw);
  if (!ref || qty === null) return true;
  if (ref.family !== existing.family) return true;
  const factor = deriveFactor(qty, ref);
  return Math.abs(factor - existing.factor) > 1e-6 * Math.max(1, existing.factor);
}

/**
 * يبني خطة الاستيراد من أوراق الملف ويتحقّق منها بالكامل.
 * لا يكتب شيئاً — الكتابة تصير في الواجهة بعد موافقة المستخدم، وفقط لو
 * errors فارغة.
 */
export function planImport(
  rawSheets: Record<string, Row[]>,
  ctx: ImportContext,
): ImportPlan {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sheets = normalizeSheets(rawSheets);

  // ── الأوراق والأعمدة ──────────────────────────────────────────────────────
  const knownSheets = Object.values(SHEETS) as string[];
  const present = Object.keys(sheets);
  if (present.length > 0 && !present.some(n => knownSheets.includes(n))) {
    errors.push(
      `الملف لا يحتوي أي ورقة معروفة (${[SHEETS.units, SHEETS.materials, SHEETS.recipes, SHEETS.prices]
        .map(n => `«${n}»`).join('، ')}) — استخدم ملفاً من «تصدير الكل» أو «تنزيل قالب».`,
    );
  }

  /** صفوف الورقة لو أعمدتها اللازمة موجودة، وإلا [] مع خطأ واضح */
  const rowsOf = (key: keyof typeof REQUIRED_COLS): Row[] => {
    const rows = sheets[SHEETS[key]] ?? [];
    if (rows.length === 0) return rows;
    const headers = new Set(rows.flatMap(r => Object.keys(r)));
    const missing = REQUIRED_COLS[key].filter(c => !headers.has(c));
    if (missing.length > 0) {
      errors.push(
        `ورقة «${SHEETS[key]}» ينقصها ${missing.length > 1 ? 'الأعمدة' : 'العمود'} ` +
        `${missing.map(c => `«${c}»`).join('، ')} — لا تغيّر أسماء رؤوس الأعمدة.`,
      );
      return [];
    }
    return rows;
  };

  // ── الوحدات ───────────────────────────────────────────────────────────────
  // نبدأ بخريطة الوحدات الحالية ونضيف عليها الجديدة، عشان المواد والوصفات
  // تقدر تشير لوحدة معرّفة في نفس الملف.
  const unitsByName = new Map<string, CostUnitDef>();
  for (const u of ctx.units) unitsByName.set(nameKey(u.name), u);

  const unitsById = new Map<string, CostUnitDef>();
  for (const u of ctx.units) unitsById.set(u.id, u);

  const newUnits: NewUnit[] = [];
  const seenUnit = new Set<string>();
  const unitRows = rowsOf('units');

  unitRows.forEach((row, i) => {
    const ln = `«${SHEETS.units}» سطر ${i + 2}`;
    const name = norm(row[COLS.units.name]);
    if (!name) return;                       // سطر فارغ — نتجاهله بهدوء

    if (seenUnit.has(nameKey(name))) {
      errors.push(`${ln}: الوحدة «${name}» مكرّرة في الملف.`);
      return;
    }
    seenUnit.add(nameKey(name));

    const qtyRaw = norm(row[COLS.units.qty]);
    const refRaw = norm(row[COLS.units.reference]);

    // موجودة — لا تُعدَّل من الملف، لكن ننبّه لو تعريفها في الملف مختلف عشان
    // ما يظن المستخدم أن تعديله انحفظ
    const existing = unitsByName.get(nameKey(name));
    if (existing) {
      if (!existing.id.startsWith('new:') && unitDefinitionDiffers(existing, qtyRaw, refRaw, unitsByName, ctx.units)) {
        warnings.push(
          `${ln}: الوحدة «${existing.name}» موجودة مسبقاً بتعريف مختلف — ` +
          'تعريف الوحدات الموجودة لا يتغيّر من الملف، وسيُتجاهل هذا السطر.',
        );
      }
      return;
    }

    if (!refRaw && !qtyRaw) {
      // وحدة مستقلة — مجموعة خاصة بها
      const unit: NewUnit = { name, family: newCustomFamily(nameKey(name)), factor: 1 };
      newUnits.push(unit);
      const def = { id: `new:${name}`, ...unit };
      unitsByName.set(nameKey(name), def);
      unitsById.set(def.id, def);
      return;
    }

    if (!refRaw) { errors.push(`${ln}: «${name}» فيها «تساوي كم» بلا «من وحدة».`); return; }
    const ref = unitsByName.get(nameKey(refRaw));
    if (!ref) { errors.push(`${ln}: الوحدة المرجعية «${refRaw}» غير معروفة.`); return; }

    const qty = parsePositiveNumber(qtyRaw);
    if (qty === null || qty <= 0) {
      errors.push(`${ln}: «تساوي كم» غير صالحة لـ«${name}» — أدخل رقماً أكبر من صفر.`);
      return;
    }

    const factor = deriveFactor(qty, ref);
    newUnits.push({ name, family: ref.family, factor });
    const def = { id: `new:${name}`, name, family: ref.family, factor };
    unitsByName.set(nameKey(name), def);
    unitsById.set(def.id, def);
  });

  // ── المواد الأولية ────────────────────────────────────────────────────────
  const materialsByName = new Map<string, RawMaterial>();
  for (const m of ctx.materials) materialsByName.set(nameKey(m.name), m);

  const materials: MaterialUpsert[] = [];
  const seenMaterial = new Set<string>();
  const materialRows = rowsOf('materials');

  materialRows.forEach((row, i) => {
    const ln = `«${SHEETS.materials}» سطر ${i + 2}`;
    const name = norm(row[COLS.materials.name]);
    if (!name) return;

    if (seenMaterial.has(nameKey(name))) {
      errors.push(`${ln}: المادة «${name}» مكرّرة في الملف.`);
      return;
    }
    seenMaterial.add(nameKey(name));

    const unitName = norm(row[COLS.materials.unit]);
    if (!unitName) { errors.push(`${ln}: «${name}» بلا وحدة شراء.`); return; }
    const unit = unitsByName.get(nameKey(unitName));
    if (!unit) { errors.push(`${ln}: الوحدة «${unitName}» غير معروفة — عرّفها في ورقة «${SHEETS.units}».`); return; }

    const price = parsePositiveNumber(norm(row[COLS.materials.price]));
    if (price === null) { errors.push(`${ln}: سعر «${name}» غير صالح.`); return; }
    if (price === 0) warnings.push(`${ln}: سعر «${name}» صفر — تكلفة أي صنف يستخدمها ستكون ناقصة.`);

    const existing = materialsByName.get(nameKey(name));
    // عمود الملاحظات اختياري: غيابه من الملف يُبقي الملاحظات الحالية بدل مسحها
    const notes = COLS.materials.notes in row
      ? notesKey(row[COLS.materials.notes])
      : notesKey(existing?.notes);

    const changed = !existing
      || existing.unit_id !== unit.id
      || round(existing.unit_cost, 4) !== round(price, 4)
      || notesKey(existing.notes) !== notes;

    const upsert: MaterialUpsert = {
      id: existing?.id,
      name: existing?.name ?? name,
      unitName: unit.name,
      unit_cost: price,
      notes,
      changed,
    };
    materials.push(upsert);

    // تسجّل في الخريطة عشان الوصفات تلقاها حتى لو جديدة
    materialsByName.set(nameKey(name), {
      id: existing?.id ?? `new:${name}`,
      name,
      unit_id: unit.id,
      unit_cost: price,
    });
  });

  // ── الوصفات ───────────────────────────────────────────────────────────────
  // فهرس الأصناف: بالمفتاح الكامل، وبالاسم وحده لاكتشاف الغموض
  const mealsByFullKey = new Map<string, Meal>();
  // مفاتيح كاملة متكرّرة (نفس الاسم والوجبة والفئة وسناك) — ما نقدر نميّزها
  const collidingKeys = new Set<string>();
  const mealsByName = new Map<string, Meal[]>();
  for (const m of ctx.meals) {
    const entity = (m.entity_type as EntityType) ?? 'beneficiary';
    const key = mealKey(m.name, m.type, entity, !!m.is_snack);
    if (mealsByFullKey.has(key)) collidingKeys.add(key);
    mealsByFullKey.set(key, m);
    const list = mealsByName.get(nameKey(m.name)) ?? [];
    list.push(m);
    mealsByName.set(nameKey(m.name), list);
  }

  /**
   * يحدّد الصنف من صف: بالاسم لو فريد، وإلا بالاسم + وجبة + فئة + سناك.
   * مشتركة بين ورقتَي «الوصفات» و«أسعار البيع» فما يختلف سلوك التمييز بينهما.
   */
  const resolveMeal = (
    ln: string,
    name: string,
    cols: { mealType: string; entity: string; snack: string },
    row: Row,
  ): Meal | null => {
    const candidates = mealsByName.get(nameKey(name)) ?? [];
    if (candidates.length === 0) {
      errors.push(`${ln}: الصنف «${name}» غير موجود — أضفه في صفحة «الأصناف» أولاً.`);
      return null;
    }
    if (candidates.length === 1) return candidates[0];

    const type   = parseMealType(row[cols.mealType]);
    const entity = parseEntity(row[cols.entity]);
    const snack  = parseBool(row[cols.snack]);
    if (type === null || entity === null || snack === null) {
      errors.push(
        `${ln}: الاسم «${name}» مكرّر على ${candidates.length} أصناف — عبّي أعمدة ` +
        `«${cols.mealType}» و«${cols.entity}» و«${cols.snack}» للتمييز.`,
      );
      return null;
    }
    const fullKey = mealKey(name, type, entity, snack);
    if (collidingKeys.has(fullKey)) {
      errors.push(
        `${ln}: فيه أكثر من صنف «${name}» بنفس الوجبة/الفئة/سناك — غيّر اسم أحدها ` +
        'في صفحة «الأصناف» ثم أعد الاستيراد.',
      );
      return null;
    }
    const found = mealsByFullKey.get(fullKey);
    if (!found) {
      errors.push(`${ln}: ما فيه صنف «${name}» بهذه الوجبة/الفئة/سناك.`);
      return null;
    }
    return found;
  };

  const byMeal = new Map<string, RecipePlan>();
  const seenPair = new Set<string>();
  const recipeRows = rowsOf('recipes');

  recipeRows.forEach((row, i) => {
    const ln = `«${SHEETS.recipes}» سطر ${i + 2}`;
    const mealName = norm(row[COLS.recipes.meal]);
    if (!mealName) return;

    // ١) حدّد الصنف
    const meal = resolveMeal(ln, mealName, COLS.recipes, row);
    if (!meal) return;

    // ٢) المادة الأولية
    const matName = norm(row[COLS.recipes.material]);
    if (!matName) { errors.push(`${ln}: بلا مادة أولية.`); return; }
    const mat = materialsByName.get(nameKey(matName));
    if (!mat) {
      errors.push(`${ln}: المادة «${matName}» غير معروفة — أضفها في ورقة «${SHEETS.materials}».`);
      return;
    }

    const pairKey = `${meal.id}|${nameKey(matName)}`;
    if (seenPair.has(pairKey)) {
      errors.push(`${ln}: «${matName}» مكرّرة داخل الصنف «${mealName}» — ادمجها في سطر واحد.`);
      return;
    }
    seenPair.add(pairKey);

    // ٣) الكمية والوحدة
    const qty = parsePositiveNumber(norm(row[COLS.recipes.qty]));
    if (qty === null || qty <= 0) {
      errors.push(`${ln}: كمية «${matName}» في «${mealName}» غير صالحة.`);
      return;
    }

    const unitName = norm(row[COLS.recipes.unit]);
    if (!unitName) { errors.push(`${ln}: بلا وحدة للكمية.`); return; }
    const unit = unitsByName.get(nameKey(unitName));
    if (!unit) { errors.push(`${ln}: الوحدة «${unitName}» غير معروفة.`); return; }

    // ٤) التوافق مع وحدة شراء المادة — أهم تحقّق: يمنع خلط وزن بحجم
    const matUnit = unitsById.get(mat.unit_id);
    if (!matUnit) { errors.push(`${ln}: وحدة شراء «${matName}» غير معروفة.`); return; }

    if (convertQuantity(qty, unit, matUnit) === null) {
      errors.push(
        `${ln}: الوحدة «${unit.name}» لا تتحوّل إلى «${matUnit.name}» ` +
        `(وحدة شراء «${matName}») — لازم تكون من نفس المجموعة.`,
      );
      return;
    }

    const plan = byMeal.get(meal.id) ?? { meal, lines: [] };
    plan.lines.push({ materialName: mat.name, quantity: qty, unitName: unit.name });
    byMeal.set(meal.id, plan);
  });

  // الوصفة المطابقة للموجود سطراً بسطر لا تُعاد كتابتها
  const currentByMeal = new Map<string, RecipeItem[]>();
  for (const r of ctx.recipes ?? []) {
    const list = currentByMeal.get(r.meal_id) ?? [];
    list.push(r);
    currentByMeal.set(r.meal_id, list);
  }
  const lineSig = (materialId: string, unitId: string, qty: number) =>
    `${materialId}|${unitId}|${round(qty, 4)}`;
  const recipeUnchanged = (plan: RecipePlan): boolean => {
    if (!ctx.recipes) return false;
    const current = currentByMeal.get(plan.meal.id) ?? [];
    if (current.length !== plan.lines.length) return false;
    const before = current.map(r => lineSig(r.raw_material_id, r.unit_id, r.quantity)).sort();
    const after = plan.lines.map(l => lineSig(
      materialsByName.get(nameKey(l.materialName))?.id ?? '',
      unitsByName.get(nameKey(l.unitName))?.id ?? '',
      l.quantity,
    )).sort();
    return before.every((s, i) => s === after[i]);
  };

  const allRecipes = Array.from(byMeal.values());
  const recipes = allRecipes.filter(r => !recipeUnchanged(r));
  const recipesUnchanged = allRecipes.length - recipes.length;

  // تغيير وحدة شراء مادة لمجموعة أخرى (وزن ↔ حجم) يكسر أسطر الوصفات الحالية
  // التي لا يستبدلها هذا الملف — ننبّه بأسماء الأصناف المتأثرة
  if (ctx.recipes) {
    const replaced = new Set(allRecipes.map(r => r.meal.id));
    const mealNameById = new Map(ctx.meals.map(m => [m.id, m.name]));
    for (const m of materials) {
      if (!m.id || !m.changed) continue;
      const newUnit = unitsByName.get(nameKey(m.unitName));
      if (!newUnit) continue;
      const broken = ctx.recipes.filter(r => {
        if (r.raw_material_id !== m.id || replaced.has(r.meal_id)) return false;
        const lineUnit = unitsById.get(r.unit_id);
        return !!lineUnit && lineUnit.family !== newUnit.family;
      });
      if (broken.length > 0) {
        const names = Array.from(new Set(broken.map(r => mealNameById.get(r.meal_id) ?? '—')));
        warnings.push(
          `وحدة شراء «${m.name}» صارت «${newUnit.name}» من مجموعة مختلفة — ` +
          `${broken.length} سطر وصفة لن يُحسب (${names.slice(0, 5).join('، ')}${names.length > 5 ? '…' : ''}). ` +
          `صحّح وحداتها أو أضفها لورقة «${SHEETS.recipes}».`,
        );
      }
    }
  }

  // ── أسعار البيع ───────────────────────────────────────────────────────────
  const prices: PricePlan[] = [];
  const seenPriceMeal = new Set<string>();
  const priceRows = rowsOf('prices');
  const currentPrice = new Map<string, number>();
  for (const p of ctx.prices ?? []) {
    if (p.selling_price > 0) currentPrice.set(p.meal_id, p.selling_price);
  }
  /** السعر المطابق للحالي (أو إزالة سعر غير موجود أصلاً) لا يُكتب */
  const priceUnchanged = (mealId: string, price: number | null): boolean => {
    if (!ctx.prices) return false;
    const cur = currentPrice.get(mealId);
    if (price === null) return cur === undefined;
    return cur !== undefined && round(cur, 4) === round(price, 4);
  };
  let pricesUnchanged = 0;
  const pushPrice = (meal: Meal, selling_price: number | null) => {
    if (priceUnchanged(meal.id, selling_price)) { pricesUnchanged++; return; }
    prices.push({ meal, selling_price });
  };

  priceRows.forEach((row, i) => {
    const ln = `«${SHEETS.prices}» سطر ${i + 2}`;
    const mealName = norm(row[COLS.prices.meal]);
    if (!mealName) return;

    const meal = resolveMeal(ln, mealName, COLS.prices, row);
    if (!meal) return;

    if (seenPriceMeal.has(meal.id)) {
      errors.push(`${ln}: الصنف «${mealName}» مكرّر في ورقة أسعار البيع.`);
      return;
    }
    seenPriceMeal.add(meal.id);

    const raw = norm(row[COLS.prices.price]);
    // فارغ أو صفر = إزالة السعر
    if (raw === '') { pushPrice(meal, null); return; }

    const price = parsePositiveNumber(raw);
    if (price === null) {
      errors.push(`${ln}: سعر بيع «${mealName}» غير صالح.`);
      return;
    }
    pushPrice(meal, price > 0 ? price : null);
  });

  return {
    newUnits,
    materials,
    recipes,
    prices,
    errors,
    warnings,
    stats: {
      unitsNew:           newUnits.length,
      materialsNew:       materials.filter(m => !m.id).length,
      materialsUpdated:   materials.filter(m => m.id && m.changed).length,
      materialsUnchanged: materials.filter(m => m.id && !m.changed).length,
      mealsPriced:        recipes.length,
      recipeLines:        recipes.reduce((s, r) => s + r.lines.length, 0),
      recipesUnchanged,
      sellingPricesSet:     prices.filter(p => p.selling_price !== null).length,
      sellingPricesRemoved: prices.filter(p => p.selling_price === null).length,
      sellingPricesUnchanged: pricesUnchanged,
    },
  };
}

/**
 * أسطر نموذجية في القالب الفارغ — تشرح الشكل بالمثال. الوحدات المثال التي
 * توجد فعلاً تُحذف (القالب يحمل الوحدات الحالية أصلاً) عشان ما تتكرّر.
 */
export function templateSamples(existingUnits: CostUnitDef[] = []) {
  const exists = new Set(existingUnits.map(u => nameKey(u.name)));
  return {
    units: [
      { [COLS.units.name]: 'رطل',   [COLS.units.qty]: 0.4536, [COLS.units.reference]: 'كجم' },
      { [COLS.units.name]: 'كرتون', [COLS.units.qty]: 24,     [COLS.units.reference]: 'حبة' },
    ].filter(r => !exists.has(nameKey(r[COLS.units.name]))),
    materials: [
      { [COLS.materials.name]: 'زيت',  [COLS.materials.unit]: 'لتر', [COLS.materials.price]: 100, [COLS.materials.notes]: '' },
      { [COLS.materials.name]: 'كبدة', [COLS.materials.unit]: 'كجم', [COLS.materials.price]: 25,  [COLS.materials.notes]: '' },
    ],
    recipes: [
      {
        [COLS.recipes.meal]: 'كبدة', [COLS.recipes.mealType]: 'غداء', [COLS.recipes.entity]: 'مستفيدون',
        [COLS.recipes.snack]: NO, [COLS.recipes.material]: 'كبدة', [COLS.recipes.qty]: 150, [COLS.recipes.unit]: 'جم',
      },
      {
        [COLS.recipes.meal]: 'كبدة', [COLS.recipes.mealType]: 'غداء', [COLS.recipes.entity]: 'مستفيدون',
        [COLS.recipes.snack]: NO, [COLS.recipes.material]: 'زيت', [COLS.recipes.qty]: 2, [COLS.recipes.unit]: 'مل',
      },
    ],
    prices: [
      {
        [COLS.prices.meal]: 'كبدة', [COLS.prices.mealType]: 'غداء',
        [COLS.prices.entity]: 'مستفيدون', [COLS.prices.snack]: NO, [COLS.prices.price]: 12,
      },
    ],
  };
}

/** ملخّص الخطة بالعربي — يُعرض في نافذة المعاينة قبل التطبيق */
export function summarizePlan(plan: ImportPlan): string[] {
  const s = plan.stats;
  const out: string[] = [];
  if (s.unitsNew)           out.push(`${s.unitsNew} وحدة جديدة`);
  if (s.materialsNew)       out.push(`${s.materialsNew} مادة أولية جديدة`);
  if (s.materialsUpdated)   out.push(`${s.materialsUpdated} مادة سيُحدَّث سعرها/وحدتها`);
  if (s.materialsUnchanged) out.push(`${s.materialsUnchanged} مادة بلا تغيير`);
  if (s.mealsPriced)        out.push(`${s.mealsPriced} صنف سيُستبدل تسعيره (${s.recipeLines} سطر)`);
  if (s.sellingPricesSet)     out.push(`${s.sellingPricesSet} سعر بيع سيُضبط`);
  if (s.sellingPricesRemoved) out.push(`${s.sellingPricesRemoved} سعر بيع سيُزال`);
  if (s.recipesUnchanged)       out.push(`${s.recipesUnchanged} وصفة بلا تغيير`);
  if (s.sellingPricesUnchanged) out.push(`${s.sellingPricesUnchanged} سعر بيع بلا تغيير`);
  // الأسطر «بلا تغيير» وحدها تعني أن الملف لا يغيّر شيئاً
  const writes = s.unitsNew + s.materialsNew + s.materialsUpdated + s.mealsPriced
    + s.sellingPricesSet + s.sellingPricesRemoved;
  if (writes === 0) out.unshift('ما فيه أي تغيير في الملف');
  return out;
}

// ── تقارير التبويبات (تصدير فقط) ───────────────────────────────────────────

/** صف «الأصناف والأسعار» كما يحسبه التبويب — نفس الأرقام المعروضة */
export interface MealReportInput {
  meal: Meal;
  itemsCount: number;
  portionCost: number;
  hasRecipe: boolean;
  issueCount: number;
  margin: MealMargin;
}

/**
 * تقرير تبويب الأصناف والأسعار. أعمدة تمييز الصنف وسعر البيع بنفس رؤوس ورقة
 * «أسعار البيع»، والورقة تحمل نفس الاسم — فالتقرير نفسه يُستورد لتعديل أسعار
 * البيع، والأعمدة المحسوبة (التكلفة/الربح/الهامش) تُتجاهل عند الاستيراد.
 */
export function buildMealReportRows(rows: MealReportInput[]) {
  return rows.map(r => ({
    [COLS.prices.meal]:     r.meal.name,
    [COLS.prices.mealType]: MEAL_TYPE_LABELS[r.meal.type],
    [COLS.prices.entity]:   ENTITY_LABEL[(r.meal.entity_type as EntityType) ?? 'beneficiary'],
    [COLS.prices.snack]:    r.meal.is_snack ? YES : NO,
    'عدد المكوّنات':        r.itemsCount,
    'تكلفة الحصة':          r.hasRecipe ? round(r.portionCost, 4) : '',
    [COLS.prices.price]:    r.margin.price !== null ? round(r.margin.price, 4) : '',
    'الربح للحصة':          r.margin.profit !== null ? round(r.margin.profit, 4) : '',
    'هامش الربح %':         r.margin.marginPct !== null ? round(r.margin.marginPct, 2) : '',
    'نسبة التكلفة %':       r.margin.foodCostPct !== null ? round(r.margin.foodCostPct, 2) : '',
    'حالة التكلفة':         !r.hasRecipe ? 'بلا تكلفة' : r.issueCount > 0 ? 'تسعير ناقص' : 'مسعّر',
    'حالة الربح':           MARGIN_STATUS_LABELS[r.margin.status],
  }));
}

export const MEAL_REPORT_HEADERS = [
  COLS.prices.meal, COLS.prices.mealType, COLS.prices.entity, COLS.prices.snack,
  'عدد المكوّنات', 'تكلفة الحصة', COLS.prices.price, 'الربح للحصة',
  'هامش الربح %', 'نسبة التكلفة %', 'حالة التكلفة', 'حالة الربح',
];

/**
 * تقرير المواد الأولية من تبويبها — نفس رؤوس ورقة «المواد الأولية» فيُستورد
 * مباشرة، مع عمود «مستخدَمة في» للاطلاع (يُتجاهل عند الاستيراد).
 */
export function buildMaterialReportRows(
  materials: RawMaterial[],
  units: CostUnitDef[],
  usageByMaterial: Record<string, number>,
) {
  const usage = new Map(materials.map(m => [m.name, usageByMaterial[m.id] ?? 0]));
  return buildMaterialRows(materials, units).map(r => ({
    ...r,
    [MATERIAL_USAGE_COL]: usage.get(String(r[COLS.materials.name])) ?? 0,
  }));
}

export const MATERIAL_USAGE_COL = 'مستخدَمة في (وصفات)';
export const MATERIAL_REPORT_HEADERS = [
  COLS.materials.name, COLS.materials.unit, COLS.materials.price, MATERIAL_USAGE_COL, COLS.materials.notes,
];

/** أمر تشغيل محسوب — يطابق OrderCostResult في lib/costs-server.ts */
export interface OrderReportInput {
  date: string;
  meal_type: MealType;
  entity_type: EntityType;
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
  noData: boolean;
}

export const ORDER_SHEETS = {
  summary: 'ملخّص الأوامر',
  items:   'تفصيل الأصناف',
} as const;

export const ORDER_SUMMARY_HEADERS = [
  'التاريخ', 'الوجبة', 'الفئة', 'عدد الحصص', 'متوسط تكلفة الحصة', 'إجمالي الأمر',
  'التغطية %', 'الاعتماد', 'تاريخ الاعتماد', 'اعتمدها', 'أصناف بدون تسعير', 'أصناف تسعيرها ناقص',
];

export const ORDER_ITEM_HEADERS = [
  'التاريخ', 'الوجبة', 'الفئة', 'الصنف', 'الكمية', 'تكلفة الحصة', 'الإجمالي', 'الحالة', 'الاعتماد',
];

const orderStatus = (o: OrderReportInput) => (o.frozen ? 'معتمدة' : 'مباشر');

/**
 * تقرير تكلفة أوامر التشغيل: ورقة ملخّص بإجمالي كل أمر كما يعرضه التبويب
 * (لا مجموع أسطر مقرّبة)، وورقة تفصيل الأصناف. الأمر بلا كميات يظهر في
 * الملخّص بصفر بدل ما يختفي من الملف.
 */
export function buildOrderReportRows(orders: OrderReportInput[]) {
  const sorted = orders.slice().sort((a, b) =>
    a.date.localeCompare(b.date)
    || ['breakfast', 'lunch', 'dinner'].indexOf(a.meal_type) - ['breakfast', 'lunch', 'dinner'].indexOf(b.meal_type)
    || a.entity_type.localeCompare(b.entity_type),
  );

  // الفئة بنفس تسمية شارة التبويب (مستفيد/مرافق)
  const summary = sorted.map(o => ({
    'التاريخ':            o.date,
    'الوجبة':             MEAL_TYPE_LABELS[o.meal_type],
    'الفئة':              ENTITY_TYPE_LABELS[o.entity_type],
    'عدد الحصص':          o.totalPortions,
    'متوسط تكلفة الحصة':  round(o.avgPortionCost, 2),
    'إجمالي الأمر':       round(o.total, 2),
    'التغطية %':          o.noData ? '' : round(o.coverage, 2),
    'الاعتماد':           o.noData ? 'بلا كميات' : orderStatus(o),
    'تاريخ الاعتماد':     o.frozen_at ? o.frozen_at.slice(0, 10) : '',
    'اعتمدها':            o.frozen_by_name ?? '',
    'أصناف بدون تسعير':   o.unpricedNames.join('، '),
    'أصناف تسعيرها ناقص': o.partialNames.join('، '),
  }));

  const items = sorted.flatMap(o => o.items.map(item => ({
    'التاريخ':     o.date,
    'الوجبة':      MEAL_TYPE_LABELS[o.meal_type],
    'الفئة':       ENTITY_TYPE_LABELS[o.entity_type],
    'الصنف':       item.meal_name,
    'الكمية':      item.quantity,
    'تكلفة الحصة': round(item.portion_cost, 4),
    'الإجمالي':    round(item.total_cost, 2),
    'الحالة':      item.unpriced ? 'بدون تسعير' : item.partial ? 'تسعير ناقص' : 'مسعّر',
    'الاعتماد':    orderStatus(o),
  })));

  return { summary, items };
}
