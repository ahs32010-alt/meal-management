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
  deriveFactor,
  newCustomFamily,
  parsePositiveNumber,
  round,
  type CostUnitDef,
  type RawMaterial,
  type RecipeItem,
} from '@/lib/costs';
import { MEAL_TYPE_LABELS, type Meal, type MealType, type EntityType } from '@/lib/types';

// ── أسماء الأوراق والأعمدة ──────────────────────────────────────────────────

export const SHEETS = {
  guide:     'تعليمات',
  units:     'الوحدات',
  materials: 'المواد الأولية',
  recipes:   'الوصفات',
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
} as const;

export const UNIT_HEADERS     = Object.values(COLS.units);
export const MATERIAL_HEADERS = Object.values(COLS.materials);
export const RECIPE_HEADERS   = Object.values(COLS.recipes);

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
    line('ملاحظات مهمة:'),
    line('• الأصناف لازم تكون موجودة مسبقاً في صفحة «الأصناف» — الاستيراد ما ينشئها.'),
    line('• أعمدة الوجبة/الفئة/سناك تلزم فقط لو تكرّر اسم الصنف؛ غير كذا اتركها فارغة.'),
    line('• أي صنف يظهر في ورقة «الوصفات» تُستبدل وصفته بالكامل بأسطره في الملف.'),
    line('• الأصناف غير المذكورة في الملف لا تتأثر إطلاقاً.'),
    line('• لو فيه أي خطأ، يتوقف الاستيراد كاملاً ويعرض لك الأخطاء — ما ينحفظ شي ناقص.'),
  ];
}

// ── الاستيراد: التحليل والتحقّق ─────────────────────────────────────────────

export interface ImportContext {
  units: CostUnitDef[];
  materials: RawMaterial[];
  meals: Meal[];
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

export interface ImportPlan {
  newUnits: NewUnit[];
  materials: MaterialUpsert[];
  recipes: RecipePlan[];
  errors: string[];
  warnings: string[];
  stats: {
    unitsNew: number;
    materialsNew: number;
    materialsUpdated: number;
    materialsUnchanged: number;
    mealsPriced: number;
    recipeLines: number;
  };
}

type Row = Record<string, string>;

/** مفتاح الصنف الفريد: اسم + وجبة + فئة + سناك — تحقّقنا أنه بلا تعارض */
function mealKey(name: string, type: MealType, entity: EntityType, snack: boolean): string {
  return [nameKey(name), type, entity, snack ? '1' : '0'].join('|');
}

/**
 * يبني خطة الاستيراد من أوراق الملف ويتحقّق منها بالكامل.
 * لا يكتب شيئاً — الكتابة تصير في الواجهة بعد موافقة المستخدم، وفقط لو
 * errors فارغة.
 */
export function planImport(
  sheets: Record<string, Row[]>,
  ctx: ImportContext,
): ImportPlan {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── الوحدات ───────────────────────────────────────────────────────────────
  // نبدأ بخريطة الوحدات الحالية ونضيف عليها الجديدة، عشان المواد والوصفات
  // تقدر تشير لوحدة معرّفة في نفس الملف.
  const unitsByName = new Map<string, CostUnitDef>();
  for (const u of ctx.units) unitsByName.set(nameKey(u.name), u);

  const unitsById = new Map<string, CostUnitDef>();
  for (const u of ctx.units) unitsById.set(u.id, u);

  const newUnits: NewUnit[] = [];
  const unitRows = sheets[SHEETS.units] ?? [];

  unitRows.forEach((row, i) => {
    const ln = `«${SHEETS.units}» سطر ${i + 2}`;
    const name = norm(row[COLS.units.name]);
    if (!name) return;                       // سطر فارغ — نتجاهله بهدوء
    if (unitsByName.has(nameKey(name))) return;  // موجودة — لا شيء نعمله

    const qtyRaw = norm(row[COLS.units.qty]);
    const refRaw = norm(row[COLS.units.reference]);

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
  const materialRows = sheets[SHEETS.materials] ?? [];

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

    const notes = norm(row[COLS.materials.notes]) || null;
    const existing = materialsByName.get(nameKey(name));

    const changed = !existing
      || existing.unit_id !== unit.id
      || round(existing.unit_cost, 4) !== round(price, 4)
      || (existing.notes ?? null) !== notes;

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
  const mealsByName = new Map<string, Meal[]>();
  for (const m of ctx.meals) {
    const entity = (m.entity_type as EntityType) ?? 'beneficiary';
    mealsByFullKey.set(mealKey(m.name, m.type, entity, !!m.is_snack), m);
    const list = mealsByName.get(nameKey(m.name)) ?? [];
    list.push(m);
    mealsByName.set(nameKey(m.name), list);
  }

  const byMeal = new Map<string, RecipePlan>();
  const seenPair = new Set<string>();
  const recipeRows = sheets[SHEETS.recipes] ?? [];

  recipeRows.forEach((row, i) => {
    const ln = `«${SHEETS.recipes}» سطر ${i + 2}`;
    const mealName = norm(row[COLS.recipes.meal]);
    if (!mealName) return;

    // ١) حدّد الصنف
    const candidates = mealsByName.get(nameKey(mealName)) ?? [];
    if (candidates.length === 0) {
      errors.push(`${ln}: الصنف «${mealName}» غير موجود — أضفه في صفحة «الأصناف» أولاً.`);
      return;
    }

    let meal: Meal | undefined;
    if (candidates.length === 1) {
      meal = candidates[0];
    } else {
      const type   = parseMealType(row[COLS.recipes.mealType]);
      const entity = parseEntity(row[COLS.recipes.entity]);
      const snack  = parseBool(row[COLS.recipes.snack]);
      if (type === null || entity === null || snack === null) {
        errors.push(
          `${ln}: الاسم «${mealName}» مكرّر على ${candidates.length} أصناف — عبّي أعمدة ` +
          `«${COLS.recipes.mealType}» و«${COLS.recipes.entity}» و«${COLS.recipes.snack}» للتمييز.`,
        );
        return;
      }
      meal = mealsByFullKey.get(mealKey(mealName, type, entity, snack));
      if (!meal) {
        errors.push(`${ln}: ما فيه صنف «${mealName}» بهذه الوجبة/الفئة/سناك.`);
        return;
      }
    }

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

  const recipes = Array.from(byMeal.values());

  return {
    newUnits,
    materials,
    recipes,
    errors,
    warnings,
    stats: {
      unitsNew:           newUnits.length,
      materialsNew:       materials.filter(m => !m.id).length,
      materialsUpdated:   materials.filter(m => m.id && m.changed).length,
      materialsUnchanged: materials.filter(m => m.id && !m.changed).length,
      mealsPriced:        recipes.length,
      recipeLines:        recipes.reduce((s, r) => s + r.lines.length, 0),
    },
  };
}

/** أسطر نموذجية في القالب الفارغ — تشرح الشكل بالمثال */
export function templateSamples() {
  return {
    units: [
      { [COLS.units.name]: 'رطل',   [COLS.units.qty]: 0.4536, [COLS.units.reference]: 'كجم' },
      { [COLS.units.name]: 'كرتون', [COLS.units.qty]: 24,     [COLS.units.reference]: 'حبة' },
    ],
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
  if (out.length === 0)     out.push('ما فيه أي تغيير في الملف');
  return out;
}
