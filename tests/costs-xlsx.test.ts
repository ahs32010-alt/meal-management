import { describe, expect, it } from 'vitest';
import {
  COLS,
  SHEETS,
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
  type ImportContext,
} from '@/lib/costs-xlsx';
import type { CostUnitDef, RawMaterial, RecipeItem } from '@/lib/costs';
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
