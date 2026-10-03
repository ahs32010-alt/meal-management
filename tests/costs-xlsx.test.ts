import { describe, expect, it } from 'vitest';
import {
  COLS,
  MATERIAL_REPORT_HEADERS,
  MEAL_REPORT_HEADERS,
  ORDER_SUMMARY_HEADERS,
  PRICE_HEADERS,
  RECIPE_HEADERS,
  SHEETS,
  UNIT_HEADERS,
  MATERIAL_HEADERS,
  buildMaterialReportRows,
  buildMealReportRows,
  buildOrderReportRows,
  buildMaterialRows,
  buildPriceRows,
  buildRecipeRows,
  buildUnitRows,
  nameKey,
  parseBool,
  parseEntity,
  parseMealType,
  planImport,
  summarizePlan,
  templateSamples,
  type ImportContext,
  type OrderReportInput,
} from '@/lib/costs-xlsx';
import * as XLSX from 'xlsx';
import { costRecipe, mealMargin, type CostUnitDef, type MealPrice, type RawMaterial, type RecipeItem } from '@/lib/costs';
import type { Meal } from '@/lib/types';

// ── بيانات ثابتة تحاكي القاعدة بعد الترقيتين ────────────────────────────────

const G:   CostUnitDef = { id: 'u-g',  name: 'جم',  family: 'weight', factor: 1,    is_builtin: true };
const KG:  CostUnitDef = { id: 'u-kg', name: 'كجم', family: 'weight', factor: 1000, is_builtin: true };
const ML:  CostUnitDef = { id: 'u-ml', name: 'مل',  family: 'volume', factor: 1,    is_builtin: true };
const L:   CostUnitDef = { id: 'u-l',  name: 'لتر', family: 'volume', factor: 1000, is_builtin: true };
const PCS: CostUnitDef = { id: 'u-pc', name: 'حبة', family: 'count',  factor: 1,    is_builtin: true };
const UNITS = [G, KG, ML, L, PCS];

const OIL:   RawMaterial = { id: 'm-oil',   name: 'زيت',  unit_id: L.id,  unit_cost: 100, notes: null };
const LIVER: RawMaterial = { id: 'm-liver', name: 'كبدة', unit_id: KG.id, unit_cost: 25,  notes: null };
const MATERIALS = [OIL, LIVER];

const meal = (over: Partial<Meal> & { id: string; name: string }): Meal => ({
  type: 'lunch', is_snack: false, entity_type: 'beneficiary', created_at: '', ...over,
});

const LIVER_DISH = meal({ id: 'x-liver', name: 'كبدة' });
// اسم مكرّر على صنفين — يختبر التمييز بالوجبة/الفئة/سناك
const BISCUIT_A  = meal({ id: 'x-b1', name: 'بسكويت', type: 'breakfast', is_snack: false });
const BISCUIT_B  = meal({ id: 'x-b2', name: 'بسكويت', type: 'breakfast', is_snack: true });
const MEALS = [LIVER_DISH, BISCUIT_A, BISCUIT_B];

const ctx: ImportContext = { units: UNITS, materials: MATERIALS, meals: MEALS };

/** يبني أوراق ملف بالشكل الذي يقرأه planImport */
const sheet = {
  units: (rows: Record<string, string>[]) => ({ [SHEETS.units]: rows }),
  materials: (rows: Record<string, string>[]) => ({ [SHEETS.materials]: rows }),
  recipes: (rows: Record<string, string>[]) => ({ [SHEETS.recipes]: rows }),
  prices: (rows: Record<string, string>[]) => ({ [SHEETS.prices]: rows }),
};

const priceRow = (mealName: string, price: string, extra: Partial<Record<string, string>> = {}) => ({
  [COLS.prices.meal]: mealName,
  [COLS.prices.mealType]: '',
  [COLS.prices.entity]: '',
  [COLS.prices.snack]: '',
  [COLS.prices.price]: price,
  ...extra,
});

const matRow = (name: string, unit: string, price: string, notes = '') => ({
  [COLS.materials.name]: name,
  [COLS.materials.unit]: unit,
  [COLS.materials.price]: price,
  [COLS.materials.notes]: notes,
});

const recRow = (
  mealName: string, material: string, qty: string, unit: string,
  extra: Partial<Record<string, string>> = {},
) => ({
  [COLS.recipes.meal]: mealName,
  [COLS.recipes.mealType]: '',
  [COLS.recipes.entity]: '',
  [COLS.recipes.snack]: '',
  [COLS.recipes.material]: material,
  [COLS.recipes.qty]: qty,
  [COLS.recipes.unit]: unit,
  ...extra,
});

// ── محوّلات القيم ───────────────────────────────────────────────────────────

describe('محوّلات القيم العربية', () => {
  it('يقرأ نعم/لا بصيغ متعددة', () => {
    expect(parseBool('نعم')).toBe(true);
    expect(parseBool('لا')).toBe(false);
    expect(parseBool('YES')).toBe(true);
    expect(parseBool('0')).toBe(false);
    expect(parseBool('')).toBeNull();
    expect(parseBool('ربما')).toBeNull();
  });

  it('يقرأ نوع الوجبة', () => {
    expect(parseMealType('غداء')).toBe('lunch');
    expect(parseMealType('فطور')).toBe('breakfast');
    expect(parseMealType('إفطار')).toBe('breakfast');
    expect(parseMealType('dinner')).toBe('dinner');
    expect(parseMealType('عشا')).toBeNull();
  });

  it('يقرأ الفئة', () => {
    expect(parseEntity('مستفيدون')).toBe('beneficiary');
    expect(parseEntity('مرافق')).toBe('companion');
    expect(parseEntity('')).toBeNull();
  });

  it('يطابق الأسماء رغم فروق المسافات', () => {
    expect(nameKey('  زيت  الذرة ')).toBe(nameKey('زيت الذرة'));
  });
});

// ── التصدير ─────────────────────────────────────────────────────────────────

describe('التصدير', () => {
  it('يترك مرجع الوحدة الأساسية فارغاً ويحسبه لغيرها', () => {
    const rows = buildUnitRows(UNITS);
    const kg = rows.find(r => r[COLS.units.name] === 'كجم')!;
    const g  = rows.find(r => r[COLS.units.name] === 'جم')!;
    expect(g[COLS.units.qty]).toBe('');          // الأساس
    expect(kg[COLS.units.qty]).toBe(1000);
    expect(kg[COLS.units.reference]).toBe('جم');
  });

  it('يصدّر المواد باسم وحدتها لا معرّفها', () => {
    const rows = buildMaterialRows(MATERIALS, UNITS);
    const oil = rows.find(r => r[COLS.materials.name] === 'زيت')!;
    expect(oil[COLS.materials.unit]).toBe('لتر');
    expect(oil[COLS.materials.price]).toBe(100);
  });

  it('يصدّر الوصفات بأعمدة التمييز كاملة', () => {
    const recipes: RecipeItem[] = [
      { id: 'r1', meal_id: LIVER_DISH.id, raw_material_id: OIL.id, quantity: 2, unit_id: ML.id },
    ];
    const rows = buildRecipeRows({ units: UNITS, materials: MATERIALS, meals: MEALS, recipes, prices: [] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      [COLS.recipes.meal]: 'كبدة',
      [COLS.recipes.mealType]: 'غداء',
      [COLS.recipes.entity]: 'مستفيدون',
      [COLS.recipes.snack]: 'لا',
      [COLS.recipes.material]: 'زيت',
      [COLS.recipes.qty]: 2,
      [COLS.recipes.unit]: 'مل',
    });
  });

  it('يتجاهل أسطر الوصفات المعطوبة بدل ما ينهار', () => {
    const recipes: RecipeItem[] = [
      { id: 'r1', meal_id: 'مفقود', raw_material_id: OIL.id, quantity: 1, unit_id: ML.id },
    ];
    expect(buildRecipeRows({ units: UNITS, materials: MATERIALS, meals: MEALS, recipes, prices: [] })).toHaveLength(0);
  });
});

// ── الاستيراد: المسار السليم ────────────────────────────────────────────────

describe('استيراد الوحدات', () => {
  it('يشتق معامل وحدة جديدة من وحدة مرجعية', () => {
    const p = planImport(sheet.units([
      { [COLS.units.name]: 'رطل', [COLS.units.qty]: '0.4536', [COLS.units.reference]: 'كجم' },
    ]), ctx);
    expect(p.errors).toEqual([]);
    expect(p.newUnits).toHaveLength(1);
    expect(p.newUnits[0].family).toBe('weight');
    expect(p.newUnits[0].factor).toBeCloseTo(453.6, 6);
  });

  it('الوحدة بلا مرجع تصير مستقلة بمجموعة خاصة', () => {
    const p = planImport(sheet.units([
      { [COLS.units.name]: 'ربطة', [COLS.units.qty]: '', [COLS.units.reference]: '' },
    ]), ctx);
    expect(p.errors).toEqual([]);
    expect(p.newUnits[0].factor).toBe(1);
    expect(p.newUnits[0].family.startsWith('custom:')).toBe(true);
  });

  it('يتجاهل الوحدات الموجودة مسبقاً', () => {
    const p = planImport(sheet.units([
      { [COLS.units.name]: 'كجم', [COLS.units.qty]: '1000', [COLS.units.reference]: 'جم' },
    ]), ctx);
    expect(p.newUnits).toHaveLength(0);
    expect(p.errors).toEqual([]);
  });

  it('يرفض مرجعاً غير معروف', () => {
    const p = planImport(sheet.units([
      { [COLS.units.name]: 'صاع', [COLS.units.qty]: '3', [COLS.units.reference]: 'برميل' },
    ]), ctx);
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0]).toContain('برميل');
  });

  it('وحدة معرّفة في الملف تصلح مرجعاً لوحدة بعدها', () => {
    const p = planImport(sheet.units([
      { [COLS.units.name]: 'كرتون', [COLS.units.qty]: '24', [COLS.units.reference]: 'حبة' },
      { [COLS.units.name]: 'صندوق', [COLS.units.qty]: '2',  [COLS.units.reference]: 'كرتون' },
    ]), ctx);
    expect(p.errors).toEqual([]);
    expect(p.newUnits[1].factor).toBe(48);       // 2 كرتون = 48 حبة
    expect(p.newUnits[1].family).toBe('count');
  });
});

describe('استيراد المواد الأولية', () => {
  it('يميّز الجديد عن المحدَّث عن غير المتغيّر', () => {
    const p = planImport(sheet.materials([
      matRow('زيت',  'لتر', '100'),   // مطابق للموجود
      matRow('كبدة', 'كجم', '30'),    // سعر جديد
      matRow('بصل',  'كجم', '6'),     // جديدة
    ]), ctx);
    expect(p.errors).toEqual([]);
    expect(p.stats).toMatchObject({ materialsNew: 1, materialsUpdated: 1, materialsUnchanged: 1 });
  });

  it('يرفض المادة المكرّرة في نفس الملف', () => {
    const p = planImport(sheet.materials([
      matRow('بصل', 'كجم', '6'),
      matRow('بصل', 'كجم', '7'),
    ]), ctx);
    expect(p.errors.some(e => e.includes('مكرّرة'))).toBe(true);
  });

  it('يرفض وحدة غير معروفة ويرفض سعراً غير صالح', () => {
    const p = planImport(sheet.materials([
      matRow('بصل',  'برميل', '6'),
      matRow('فلفل', 'كجم',   'غالي'),
    ]), ctx);
    expect(p.errors).toHaveLength(2);
  });

  it('ينبّه على السعر صفر بلا ما يمنع الاستيراد', () => {
    const p = planImport(sheet.materials([matRow('ملح', 'كجم', '0')]), ctx);
    expect(p.errors).toEqual([]);
    expect(p.warnings.some(w => w.includes('صفر'))).toBe(true);
  });
});

describe('استيراد الوصفات', () => {
  it('يبني وصفة كاملة ويقبل الوحدة الصغيرة', () => {
    const p = planImport({
      ...sheet.recipes([
        recRow('كبدة', 'زيت',  '2',   'مل'),
        recRow('كبدة', 'كبدة', '150', 'جم'),
      ]),
    }, ctx);
    expect(p.errors).toEqual([]);
    expect(p.recipes).toHaveLength(1);
    expect(p.recipes[0].meal.id).toBe(LIVER_DISH.id);
    expect(p.recipes[0].lines).toHaveLength(2);
    expect(p.stats.recipeLines).toBe(2);
  });

  it('يرفض الصنف غير الموجود برسالة توجّه للحل', () => {
    const p = planImport(sheet.recipes([recRow('مندي', 'زيت', '2', 'مل')]), ctx);
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0]).toContain('الأصناف');
  });

  it('يرفض الاسم المكرّر بلا أعمدة تمييز', () => {
    const p = planImport(sheet.recipes([recRow('بسكويت', 'زيت', '2', 'مل')]), ctx);
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0]).toContain('مكرّر');
  });

  it('يميّز الاسم المكرّر بالوجبة والفئة وسناك', () => {
    const p = planImport(sheet.recipes([
      recRow('بسكويت', 'زيت', '2', 'مل', {
        [COLS.recipes.mealType]: 'فطور',
        [COLS.recipes.entity]: 'مستفيدون',
        [COLS.recipes.snack]: 'نعم',
      }),
    ]), ctx);
    expect(p.errors).toEqual([]);
    expect(p.recipes[0].meal.id).toBe(BISCUIT_B.id);   // النسخة السناك
  });

  it('يمنع خلط الوزن بالحجم — أهم تحقّق', () => {
    const p = planImport(sheet.recipes([recRow('كبدة', 'زيت', '100', 'جم')]), ctx);
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0]).toContain('لا تتحوّل');
  });

  it('يرفض تكرار المادة داخل نفس الصنف', () => {
    const p = planImport(sheet.recipes([
      recRow('كبدة', 'زيت', '2', 'مل'),
      recRow('كبدة', 'زيت', '3', 'مل'),
    ]), ctx);
    expect(p.errors.some(e => e.includes('مكرّرة'))).toBe(true);
  });

  it('يرفض الكمية غير الصالحة', () => {
    const p = planImport(sheet.recipes([recRow('كبدة', 'زيت', '-5', 'مل')]), ctx);
    expect(p.errors).toHaveLength(1);
  });

  it('مادة معرّفة في ورقة المواد تصلح للوصفة في نفس الملف', () => {
    const p = planImport({
      ...sheet.materials([matRow('بصل', 'كجم', '6')]),
      ...sheet.recipes([recRow('كبدة', 'بصل', '40', 'جم')]),
    }, ctx);
    expect(p.errors).toEqual([]);
    expect(p.recipes[0].lines[0].materialName).toBe('بصل');
    expect(p.stats.materialsNew).toBe(1);
  });

  it('يرفض مادة غير موجودة ولا معرّفة في الملف', () => {
    const p = planImport(sheet.recipes([recRow('كبدة', 'زعفران', '1', 'جم')]), ctx);
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0]).toContain('زعفران');
  });
});

describe('سلوك عام', () => {
  it('ملف فارغ لا ينتج خطأ ولا تغيير', () => {
    const p = planImport({}, ctx);
    expect(p.errors).toEqual([]);
    expect(summarizePlan(p)).toEqual(['ما فيه أي تغيير في الملف']);
  });

  it('يتجاهل الأسطر الفارغة بهدوء', () => {
    const p = planImport(sheet.materials([
      matRow('', '', ''),
      matRow('بصل', 'كجم', '6'),
    ]), ctx);
    expect(p.errors).toEqual([]);
    expect(p.materials).toHaveLength(1);
  });

  it('يجمع كل الأخطاء بدل ما يتوقف عند أولها', () => {
    const p = planImport(sheet.recipes([
      recRow('مندي',  'زيت',    '2', 'مل'),
      recRow('كبدة',  'زعفران', '2', 'جم'),
      recRow('كبدة',  'زيت',    '2', 'برميل'),
    ]), ctx);
    expect(p.errors.length).toBe(3);
  });

  it('أرقام السطر في الأخطاء تطابق ترقيم Excel (الرأس = سطر 1)', () => {
    const p = planImport(sheet.materials([
      matRow('بصل', 'كجم', '6'),
      matRow('فلفل', 'برميل', '9'),
    ]), ctx);
    expect(p.errors[0]).toContain('سطر 3');   // ثاني صف بيانات = السطر الثالث
  });
});

// ── أسعار البيع ─────────────────────────────────────────────────────────────

describe('أسعار البيع', () => {
  it('يصدّر السعر مع أعمدة تمييز الصنف', () => {
    const rows = buildPriceRows(MEALS, [{ meal_id: LIVER_DISH.id, selling_price: 12 }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      [COLS.prices.meal]: 'كبدة',
      [COLS.prices.mealType]: 'غداء',
      [COLS.prices.entity]: 'مستفيدون',
      [COLS.prices.snack]: 'لا',
      [COLS.prices.price]: 12,
    });
  });

  it('يستورد سعر بيع صحيح', () => {
    const p = planImport(sheet.prices([priceRow('كبدة', '12')]), ctx);
    expect(p.errors).toEqual([]);
    expect(p.prices).toHaveLength(1);
    expect(p.prices[0].meal.id).toBe(LIVER_DISH.id);
    expect(p.prices[0].selling_price).toBe(12);
    expect(p.stats.sellingPricesSet).toBe(1);
  });

  it('السعر الفارغ أو الصفر يعني إزالة السعر', () => {
    const p = planImport(sheet.prices([
      priceRow('كبدة', ''),
      priceRow('بسكويت', '0', {
        [COLS.prices.mealType]: 'فطور', [COLS.prices.entity]: 'مستفيدون', [COLS.prices.snack]: 'نعم',
      }),
    ]), ctx);
    expect(p.errors).toEqual([]);
    expect(p.stats.sellingPricesRemoved).toBe(2);
    expect(p.prices.every(x => x.selling_price === null)).toBe(true);
  });

  it('يستخدم نفس تمييز الاسم المكرّر المستخدم في الوصفات', () => {
    const ambiguous = planImport(sheet.prices([priceRow('بسكويت', '5')]), ctx);
    expect(ambiguous.errors[0]).toContain('مكرّر');

    const resolved = planImport(sheet.prices([
      priceRow('بسكويت', '5', {
        [COLS.prices.mealType]: 'فطور', [COLS.prices.entity]: 'مستفيدون', [COLS.prices.snack]: 'لا',
      }),
    ]), ctx);
    expect(resolved.errors).toEqual([]);
    expect(resolved.prices[0].meal.id).toBe(BISCUIT_A.id);
  });

  it('يرفض الصنف المكرّر داخل ورقة الأسعار', () => {
    const p = planImport(sheet.prices([priceRow('كبدة', '12'), priceRow('كبدة', '15')]), ctx);
    expect(p.errors.some(e => e.includes('مكرّر'))).toBe(true);
  });

  it('يرفض السعر غير الصالح والصنف غير الموجود', () => {
    const p = planImport(sheet.prices([
      priceRow('كبدة', 'غالي'),
      priceRow('مندي', '20'),
    ]), ctx);
    expect(p.errors).toHaveLength(2);
  });

  it('الملخّص يذكر الأسعار المضبوطة والمُزالة', () => {
    const p = planImport(sheet.prices([priceRow('كبدة', '12')]), ctx);
    expect(summarizePlan(p).some(l => l.includes('سعر بيع'))).toBe(true);
  });
});

// ── الدورة الكاملة: تصدير ← ملف Excel حقيقي ← استيراد ──────────────────────

/**
 * يكتب الأوراق بنفس خيارات exportWorkbook ويقرأها بنفس خيارات parseWorkbook
 * (raw: false) — فيختبر تحويل الأرقام إلى نص والعكس كما يصير في المتصفح.
 */
function roundTrip(sheets: { name: string; rows: Record<string, unknown>[]; headers: string[] }[]) {
  const wb = XLSX.utils.book_new();
  for (const sh of sheets) {
    const ws = sh.rows.length > 0
      ? XLSX.utils.json_to_sheet(sh.rows, { header: sh.headers })
      : XLSX.utils.aoa_to_sheet([sh.headers]);
    XLSX.utils.book_append_sheet(wb, ws, sh.name);
  }
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const back = XLSX.read(new Uint8Array(buf), { type: 'array' });
  const out: Record<string, Record<string, string>[]> = {};
  for (const name of back.SheetNames) {
    out[name] = XLSX.utils.sheet_to_json<Record<string, string>>(back.Sheets[name], { defval: '', raw: false });
  }
  return out;
}

describe('الدورة الكاملة تصدير ← استيراد', () => {
  // وحدة بمعامل كسري طويل ومادة بسعر بأربع خانات — أصعب حالات الأرقام
  const OZ: CostUnitDef = { id: 'u-oz', name: 'أوقية', family: 'weight', factor: 28.34952312 };
  const SAFFRON: RawMaterial = { id: 'm-saf', name: 'زعفران', unit_id: G.id, unit_cost: 12.3456, notes: 'مستورد' };
  const units = [...UNITS, OZ];
  const materials = [...MATERIALS, SAFFRON];
  const recipes: RecipeItem[] = [
    { id: 'r1', meal_id: LIVER_DISH.id, raw_material_id: LIVER.id, quantity: 150, unit_id: G.id },
    { id: 'r2', meal_id: LIVER_DISH.id, raw_material_id: OIL.id, quantity: 2.5, unit_id: ML.id },
    { id: 'r3', meal_id: BISCUIT_B.id, raw_material_id: SAFFRON.id, quantity: 0.0125, unit_id: G.id },
  ];
  const prices: MealPrice[] = [
    { meal_id: LIVER_DISH.id, selling_price: 12.5 },
    { meal_id: BISCUIT_B.id, selling_price: 3 },
  ];
  const fullCtx: ImportContext = { units, materials, meals: MEALS, recipes, prices };

  const exported = () => roundTrip([
    { name: SHEETS.units,     rows: buildUnitRows(units),                headers: UNIT_HEADERS },
    { name: SHEETS.materials, rows: buildMaterialRows(materials, units), headers: MATERIAL_HEADERS },
    { name: SHEETS.recipes,   rows: buildRecipeRows({ units, materials, meals: MEALS, recipes, prices }), headers: RECIPE_HEADERS },
    { name: SHEETS.prices,    rows: buildPriceRows(MEALS, prices),       headers: PRICE_HEADERS },
  ]);

  it('ملف مصدَّر بلا تعديل يُستورد بلا أخطاء ولا كتابة', () => {
    const p = planImport(exported(), fullCtx);
    expect(p.errors).toEqual([]);
    expect(p.warnings).toEqual([]);
    expect(p.newUnits).toEqual([]);
    expect(p.recipes).toEqual([]);
    expect(p.prices).toEqual([]);
    expect(p.stats).toMatchObject({
      materialsNew: 0, materialsUpdated: 0, materialsUnchanged: 3,
      recipesUnchanged: 2, sellingPricesUnchanged: 2,
    });
    expect(summarizePlan(p)[0]).toBe('ما فيه أي تغيير في الملف');
  });

  it('تعديل خلية واحدة يكتب ذلك فقط', () => {
    const sheets = exported();
    sheets[SHEETS.prices].find(r => r[COLS.prices.meal] === 'كبدة')![COLS.prices.price] = '14';
    sheets[SHEETS.recipes].find(r => r[COLS.recipes.material] === 'زيت')![COLS.recipes.qty] = '3';
    const p = planImport(sheets, fullCtx);
    expect(p.errors).toEqual([]);
    expect(p.prices).toEqual([{ meal: LIVER_DISH, selling_price: 14 }]);
    expect(p.recipes.map(r => r.meal.id)).toEqual([LIVER_DISH.id]);
    expect(p.recipes[0].lines).toHaveLength(2);
    expect(p.stats.recipesUnchanged).toBe(1);
  });

  it('الأرقام تبقى أرقاماً في الملف لا نصاً', () => {
    const rows = buildMaterialRows([SAFFRON], units);
    expect(typeof rows[0][COLS.materials.price]).toBe('number');
    const oz = buildUnitRows(units).find(r => r[COLS.units.name] === 'أوقية')!;
    expect(oz[COLS.units.qty]).toBe(28.34952312);
  });
});

describe('تحقّق شكل الملف', () => {
  it('يرفض ورقة ينقصها عمود لازم بدل تجاهل صفوفها بصمت', () => {
    const p = planImport({ [SHEETS.materials]: [{ 'المادة': 'بصل', 'وحدة الشراء': 'كجم', 'السعر (ريال/وحدة)': '6' }] }, ctx);
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0]).toContain(COLS.materials.name);
    expect(p.errors[0]).toContain(COLS.materials.price);
  });

  it('يرفض ملفاً بلا أي ورقة معروفة', () => {
    const p = planImport({ 'تكاليف أوامر التشغيل': [{ 'الصنف': 'كبدة' }] }, ctx);
    expect(p.errors[0]).toContain('لا يحتوي أي ورقة معروفة');
  });

  it('يتسامح مع مسافات زائدة في اسم الورقة ورؤوس الأعمدة', () => {
    const p = planImport({
      [` ${SHEETS.materials} `]: [{
        [`${COLS.materials.name} `]: 'بصل', [COLS.materials.unit]: 'كجم', [` ${COLS.materials.price}`]: '6',
      }],
    }, ctx);
    expect(p.errors).toEqual([]);
    expect(p.stats.materialsNew).toBe(1);
  });

  it('غياب عمود الملاحظات يُبقي الملاحظات الحالية', () => {
    const withNotes = { ...LIVER, notes: 'طازجة' };
    const p = planImport({
      [SHEETS.materials]: [{ [COLS.materials.name]: 'كبدة', [COLS.materials.unit]: 'كجم', [COLS.materials.price]: '25' }],
    }, { ...ctx, materials: [OIL, withNotes] });
    expect(p.errors).toEqual([]);
    expect(p.materials[0]).toMatchObject({ notes: 'طازجة', changed: false });
  });

  it('الملاحظة الفارغة تساوي null فلا تُحسب تغييراً', () => {
    const p = planImport(sheet.materials([matRow('زيت', 'لتر', '100', '')]), {
      ...ctx, materials: [{ ...OIL, notes: '' }, LIVER],
    });
    expect(p.materials[0].changed).toBe(false);
  });
});

describe('تحقّقات الوحدات الإضافية', () => {
  it('يرفض الوحدة الجديدة المكرّرة في الملف', () => {
    const p = planImport(sheet.units([
      { [COLS.units.name]: 'صاع', [COLS.units.qty]: '3', [COLS.units.reference]: 'كجم' },
      { [COLS.units.name]: 'صاع', [COLS.units.qty]: '2', [COLS.units.reference]: 'كجم' },
    ]), ctx);
    expect(p.errors.some(e => e.includes('مكرّرة'))).toBe(true);
  });

  it('ينبّه لو عُدّل تعريف وحدة موجودة في الملف (لا يُطبَّق)', () => {
    const p = planImport(sheet.units([
      { [COLS.units.name]: 'كجم', [COLS.units.qty]: '900', [COLS.units.reference]: 'جم' },
    ]), ctx);
    expect(p.errors).toEqual([]);
    expect(p.newUnits).toEqual([]);
    expect(p.warnings[0]).toContain('بتعريف مختلف');
  });

  it('القالب لا يكرّر وحدات المثال الموجودة فعلاً', () => {
    const LB: CostUnitDef = { id: 'u-lb', name: 'رطل', family: 'weight', factor: 453.59237 };
    const s = templateSamples([...UNITS, LB]);
    expect(s.units.map(r => r[COLS.units.name])).toEqual(['كرتون']);
    const p = planImport({ [SHEETS.units]: [...buildUnitRows([...UNITS, LB]), ...s.units] as never }, { ...ctx, units: [...UNITS, LB] });
    expect(p.errors).toEqual([]);
    expect(p.warnings).toEqual([]);
  });
});

describe('تحقّقات الوصفات والأسعار الإضافية', () => {
  it('ينبّه لو تغيّرت مجموعة وحدة شراء مادة تستخدمها وصفات خارج الملف', () => {
    const recipes: RecipeItem[] = [
      { id: 'r1', meal_id: LIVER_DISH.id, raw_material_id: OIL.id, quantity: 2, unit_id: ML.id },
    ];
    const p = planImport(sheet.materials([matRow('زيت', 'كجم', '100')]), { ...ctx, recipes });
    expect(p.errors).toEqual([]);
    expect(p.warnings.some(w => w.includes('زيت') && w.includes('كبدة'))).toBe(true);
  });

  it('يرفض الاسم الذي لا تميّزه حتى أعمدة الوجبة/الفئة/سناك', () => {
    const twin = meal({ id: 'x-b3', name: 'بسكويت', type: 'breakfast', is_snack: true });
    const p = planImport(sheet.prices([
      priceRow('بسكويت', '5', {
        [COLS.prices.mealType]: 'فطور', [COLS.prices.entity]: 'مستفيدون', [COLS.prices.snack]: 'نعم',
      }),
    ]), { ...ctx, meals: [...MEALS, twin] });
    expect(p.errors[0]).toContain('أكثر من صنف');
  });

  it('إزالة سعر غير موجود أصلاً لا تُحسب تغييراً', () => {
    const p = planImport(sheet.prices([priceRow('كبدة', '')]), { ...ctx, prices: [] });
    expect(p.prices).toEqual([]);
    expect(p.stats.sellingPricesUnchanged).toBe(1);
  });
});

// ── تقارير التبويبات ─────────────────────────────────────────────────────────

describe('تقارير التبويبات', () => {
  it('تقرير الأصناف يطابق أرقام التبويب ويُستورد لتعديل أسعار البيع', () => {
    const recipes: RecipeItem[] = [
      { id: 'r1', meal_id: LIVER_DISH.id, raw_material_id: LIVER.id, quantity: 150, unit_id: G.id },
      { id: 'r2', meal_id: LIVER_DISH.id, raw_material_id: OIL.id, quantity: 2, unit_id: ML.id },
    ];
    const byId = Object.fromEntries(MATERIALS.map(m => [m.id, m]));
    const unitsById = Object.fromEntries(UNITS.map(u => [u.id, u]));
    const cost = costRecipe(recipes, byId, unitsById);        // 3.75 + 0.2 = 3.95
    const rows = buildMealReportRows([
      { meal: LIVER_DISH, itemsCount: 2, portionCost: cost.total, hasRecipe: true, issueCount: 0, margin: mealMargin(cost.total, 12) },
      { meal: BISCUIT_A, itemsCount: 0, portionCost: 0, hasRecipe: false, issueCount: 0, margin: mealMargin(0, null) },
    ]);
    expect(rows[0]).toMatchObject({
      'تكلفة الحصة': 3.95, [COLS.prices.price]: 12, 'الربح للحصة': 8.05,
      'هامش الربح %': 67.08, 'حالة التكلفة': 'مسعّر', 'حالة الربح': 'ربح',
      [COLS.prices.entity]: 'مستفيدون', [COLS.prices.snack]: 'لا',
    });
    expect(rows[1]).toMatchObject({ 'تكلفة الحصة': '', [COLS.prices.price]: '', 'حالة الربح': 'بلا سعر بيع' });

    const prices: MealPrice[] = [{ meal_id: LIVER_DISH.id, selling_price: 12 }];
    const file = roundTrip([{ name: SHEETS.prices, rows, headers: MEAL_REPORT_HEADERS }]);
    const same = planImport(file, { ...ctx, prices });
    expect(same.errors).toEqual([]);
    expect(same.prices).toEqual([]);

    file[SHEETS.prices][0][COLS.prices.price] = '13';
    const edited = planImport(file, { ...ctx, prices });
    expect(edited.prices).toEqual([{ meal: LIVER_DISH, selling_price: 13 }]);
  });

  it('تقرير المواد الأولية يُستورد كما هو', () => {
    const rows = buildMaterialReportRows(MATERIALS, UNITS, { [OIL.id]: 3 });
    expect(rows.find(r => r[COLS.materials.name] === 'زيت')).toMatchObject({ 'مستخدَمة في (وصفات)': 3 });
    const file = roundTrip([{ name: SHEETS.materials, rows, headers: MATERIAL_REPORT_HEADERS }]);
    const p = planImport(file, ctx);
    expect(p.errors).toEqual([]);
    expect(p.stats.materialsUnchanged).toBe(2);
  });

  it('تقرير الأوامر: إجمالي كل أمر كما في التبويب، والأمر بلا كميات لا يختفي', () => {
    const base = {
      meal_type: 'lunch' as const, entity_type: 'beneficiary' as const,
      frozen_at: null, frozen_by_name: null, unpricedNames: [], partialNames: [],
    };
    const orders: OrderReportInput[] = [
      {
        ...base, date: '2026-09-02', frozen: true, frozen_at: '2026-09-02T10:00:00Z', frozen_by_name: 'أحمد',
        // ثلاثة أسطر بـ0.335 — مجموعها المقرّب سطراً سطراً 1.02، والإجمالي الحقيقي 1.005 ← 1.01
        total: 1.005, totalPortions: 3, avgPortionCost: 0.335, coverage: 100, noData: false,
        items: [1, 2, 3].map(i => ({
          meal_id: `m${i}`, meal_name: `صنف ${i}`, quantity: 1, portion_cost: 0.335, total_cost: 0.335,
          unpriced: false, partial: false,
        })),
      },
      { ...base, date: '2026-09-01', frozen: false, total: 0, totalPortions: 0, avgPortionCost: 0, coverage: 0, noData: true, items: [] },
    ];
    const { summary, items } = buildOrderReportRows(orders);
    expect(Object.keys(summary[0])).toEqual(ORDER_SUMMARY_HEADERS);
    expect(summary.map(r => r['التاريخ'])).toEqual(['2026-09-01', '2026-09-02']);
    expect(summary[0]).toMatchObject({ 'الاعتماد': 'بلا كميات', 'إجمالي الأمر': 0, 'الفئة': 'مستفيد' });
    expect(summary[1]).toMatchObject({
      'إجمالي الأمر': 1.01, 'الاعتماد': 'معتمدة', 'تاريخ الاعتماد': '2026-09-02', 'اعتمدها': 'أحمد',
    });
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ 'الاعتماد': 'معتمدة', 'تكلفة الحصة': 0.335 });
  });
});
