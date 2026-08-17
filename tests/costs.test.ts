import { describe, expect, it } from 'vitest';
import {
  mealMargin,
  baseUnitOf,
  convertQuantity,
  costOrder,
  costRecipe,
  deriveFactor,
  familyLabel,
  formatMoney,
  formatQty,
  newCustomFamily,
  parsePositiveNumber,
  round,
  unitsInFamily,
  type CostUnitDef,
  type RawMaterial,
} from '@/lib/costs';

// الوحدات المدمجة كما يزرعها costs-units-migration.sql
const G:   CostUnitDef = { id: 'g',   name: 'جم',  family: 'weight', factor: 1,    is_builtin: true };
const KG:  CostUnitDef = { id: 'kg',  name: 'كجم', family: 'weight', factor: 1000, is_builtin: true };
const ML:  CostUnitDef = { id: 'ml',  name: 'مل',  family: 'volume', factor: 1,    is_builtin: true };
const L:   CostUnitDef = { id: 'l',   name: 'لتر', family: 'volume', factor: 1000, is_builtin: true };
const PCS: CostUnitDef = { id: 'pcs', name: 'حبة', family: 'count',  factor: 1,    is_builtin: true };

// وحدات يضيفها المستخدم
const LB:      CostUnitDef = { id: 'lb',   name: 'رطل',   family: 'weight', factor: 453.592 };
const CARTON:  CostUnitDef = { id: 'ctn',  name: 'كرتون', family: 'count',  factor: 24 };
const BUNDLE:  CostUnitDef = { id: 'bnd',  name: 'ربطة',  family: 'custom:x', factor: 1 };

const ALL_UNITS = [G, KG, ML, L, PCS, LB, CARTON, BUNDLE];
const unitsById = Object.fromEntries(ALL_UNITS.map(u => [u.id, u]));

const material = (id: string, name: string, unit: CostUnitDef, cost: number): RawMaterial => ({
  id, name, unit_id: unit.id, unit_cost: cost,
});

describe('convertQuantity', () => {
  it('يحوّل داخل الوزن في الاتجاهين', () => {
    expect(convertQuantity(1, KG, G)).toBe(1000);
    expect(convertQuantity(250, G, KG)).toBe(0.25);
  });

  it('يحوّل داخل الحجم في الاتجاهين', () => {
    expect(convertQuantity(1.5, L, ML)).toBe(1500);
    expect(convertQuantity(500, ML, L)).toBe(0.5);
  });

  it('يحوّل الوحدات التي يضيفها المستخدم', () => {
    // رطل = 453.592 جم
    expect(convertQuantity(1, LB, G)).toBe(453.592);
    expect(round(convertQuantity(2, LB, KG)!, 6)).toBe(0.907184);
    // كرتون = 24 حبة
    expect(convertQuantity(2, CARTON, PCS)).toBe(48);
    expect(convertQuantity(48, PCS, CARTON)).toBe(2);
  });

  it('يرجّع الكمية كما هي لنفس الوحدة', () => {
    expect(convertQuantity(7, PCS, PCS)).toBe(7);
  });

  it('يرفض التحويل بين مجموعتين مختلفتين بدل ما يعطي رقماً مغلوطاً', () => {
    expect(convertQuantity(1, KG, L)).toBeNull();
    expect(convertQuantity(1, PCS, G)).toBeNull();
    expect(convertQuantity(1, ML, KG)).toBeNull();
    // الوحدة المستقلة لا تتحوّل لأي شيء حتى لو تشابه معاملها
    expect(convertQuantity(1, BUNDLE, PCS)).toBeNull();
    expect(convertQuantity(1, PCS, BUNDLE)).toBeNull();
  });

  it('يرفض الأرقام غير المنتهية والمعاملات غير الصالحة', () => {
    expect(convertQuantity(NaN, KG, G)).toBeNull();
    expect(convertQuantity(Infinity, KG, G)).toBeNull();
    expect(convertQuantity(1, { ...KG, factor: 0 }, G)).toBeNull();
  });
});

describe('deriveFactor / newCustomFamily', () => {
  it('يشتق معامل وحدة جديدة من وحدة مرجعية', () => {
    // رطل = 0.4536 كجم → 0.4536 × 1000 = 453.6 جم
    expect(deriveFactor(0.4536, KG)).toBeCloseTo(453.6, 6);
    // كرتون = 24 حبة → 24 × 1 = 24
    expect(deriveFactor(24, PCS)).toBe(24);
    // وحدة معرّفة من وحدة غير أساسية: صندوق = 2 كرتون → 2 × 24 = 48 حبة
    expect(deriveFactor(2, CARTON)).toBe(48);
  });

  it('الوحدة المشتقة تتحوّل صح مع مجموعتها', () => {
    const box: CostUnitDef = { id: 'box', name: 'صندوق', family: CARTON.family, factor: deriveFactor(2, CARTON) };
    expect(convertQuantity(1, box, PCS)).toBe(48);
    expect(convertQuantity(1, box, CARTON)).toBe(2);
  });

  it('المجموعة المستقلة فريدة لكل وحدة', () => {
    expect(newCustomFamily('a')).not.toBe(newCustomFamily('b'));
    expect(newCustomFamily('a').startsWith('custom:')).toBe(true);
  });
});

describe('familyLabel / unitsInFamily', () => {
  it('يسمّي المجموعات المدمجة بالعربي', () => {
    expect(familyLabel('weight', ALL_UNITS)).toBe('وزن');
    expect(familyLabel('volume', ALL_UNITS)).toBe('حجم');
    expect(familyLabel('count', ALL_UNITS)).toBe('عدد');
  });

  it('يسمّي المجموعة المخصّصة بوحدتها الأساسية', () => {
    expect(familyLabel('custom:x', ALL_UNITS)).toBe('مجموعة ربطة');
  });

  it('يعطي أصغر وحدة في المجموعة كوحدة افتراضية للوصفة', () => {
    // الزيت يُشترى باللتر لكن يدخل الصحن بالمل
    expect(baseUnitOf(L, ALL_UNITS)?.name).toBe('مل');
    expect(baseUnitOf(KG, ALL_UNITS)?.name).toBe('جم');
    expect(baseUnitOf(CARTON, ALL_UNITS)?.name).toBe('حبة');
    expect(baseUnitOf(undefined, ALL_UNITS)).toBeUndefined();
  });

  it('يعطي وحدات نفس المجموعة مرتّبة تصاعدياً', () => {
    // مرتّبة بالمعامل: جم(1) ثم رطل(453.6) ثم كجم(1000)
    expect(unitsInFamily(KG, ALL_UNITS).map(u => u.name)).toEqual(['جم', 'رطل', 'كجم']);
    expect(unitsInFamily(PCS, ALL_UNITS).map(u => u.name)).toEqual(['حبة', 'كرتون']);
    expect(unitsInFamily(undefined, ALL_UNITS)).toEqual([]);
  });
});

describe('round', () => {
  it('يعالج شذوذ الفاصلة العائمة', () => {
    expect(round(0.1 + 0.2, 2)).toBe(0.3);
    expect(round(1.005, 2)).toBe(1.01);
    expect(round(2.675, 2)).toBe(2.68);
  });

  it('يحترم عدد الخانات', () => {
    expect(round(3.14159, 4)).toBe(3.1416);
    expect(round(3.14159, 0)).toBe(3);
  });

  it('يرجّع صفراً للقيم غير الصالحة', () => {
    expect(round(NaN)).toBe(0);
    expect(round(Infinity)).toBe(0);
  });
});

describe('costRecipe', () => {
  const materials: Record<string, RawMaterial> = {
    liver:  material('liver',  'كبدة', KG, 25),
    onion:  material('onion',  'بصل',  KG, 6),
    pepper: material('pepper', 'فلفل', KG, 15),
    oil:    material('oil',    'زيت',  L,  12),
    egg:    material('egg',    'بيض',  PCS, 1),
  };

  it('يحسب تكلفة الحصة مع تحويل الوحدات — مثال الكبدة', () => {
    // 150جم كبدة (25 ر/كجم) = 3.75 | 40جم بصل (6 ر/كجم) = 0.24
    // 20جم فلفل (15 ر/كجم) = 0.30 | 10مل زيت (12 ر/لتر) = 0.12
    const r = costRecipe(
      [
        { raw_material_id: 'liver',  quantity: 150, unit_id: G.id },
        { raw_material_id: 'onion',  quantity: 40,  unit_id: G.id },
        { raw_material_id: 'pepper', quantity: 20,  unit_id: G.id },
        { raw_material_id: 'oil',    quantity: 10,  unit_id: ML.id },
      ],
      materials,
      unitsById,
    );
    expect(round(r.total, 2)).toBe(4.41);
    expect(r.issues).toHaveLength(0);
    expect(r.hasRecipe).toBe(true);
    expect(round(r.lines[0].cost, 2)).toBe(3.75);
    expect(r.lines[0].converted_qty).toBe(0.15);
    expect(r.lines[0].unit_name).toBe('جم');
    expect(r.lines[0].material_unit_name).toBe('كجم');
  });

  it('ياخذ جزءاً صغيراً من مادة مسعّرة بالوحدة الكبيرة — زيت 1 لتر ثم 2 مل', () => {
    // الزيت مسجّل: 1 لتر بـ 100 ريال. الصنف ياخذ منه 2 مل فقط.
    const oilPerLiter = { oil: material('oil', 'زيت', L, 100) };
    const r = costRecipe(
      [{ raw_material_id: 'oil', quantity: 2, unit_id: ML.id }],
      oilPerLiter,
      unitsById,
    );
    // 2 ÷ 1000 = 0.002 لتر × 100 = 0.20 ريال
    expect(r.lines[0].converted_qty).toBe(0.002);
    expect(round(r.total, 2)).toBe(0.2);
    expect(r.issues).toHaveLength(0);
    // ولا يتغيّر الرقم لو أدخلها باللتر مباشرة
    const same = costRecipe(
      [{ raw_material_id: 'oil', quantity: 0.002, unit_id: L.id }],
      oilPerLiter,
      unitsById,
    );
    expect(round(same.total, 4)).toBe(round(r.total, 4));
  });

  it('يسعّر بوحدة أضافها المستخدم', () => {
    // نصف رطل كبدة = 226.796 جم = 0.226796 كجم × 25 = 5.6699
    const r = costRecipe(
      [{ raw_material_id: 'liver', quantity: 0.5, unit_id: LB.id }],
      materials,
      unitsById,
    );
    expect(round(r.total, 4)).toBe(5.6699);
    expect(r.issues).toHaveLength(0);
  });

  it('يسعّر وحدة عدّ مضافة (كرتون = 24 حبة)', () => {
    const r = costRecipe(
      [{ raw_material_id: 'egg', quantity: 2, unit_id: CARTON.id }],
      materials,
      unitsById,
    );
    expect(round(r.total, 2)).toBe(48);
  });

  it('يعلّم المادة المفقودة ولا يحتسبها', () => {
    const r = costRecipe(
      [
        { raw_material_id: 'liver',   quantity: 100, unit_id: G.id },
        { raw_material_id: 'deleted', quantity: 50,  unit_id: G.id },
      ],
      materials,
      unitsById,
    );
    expect(round(r.total, 2)).toBe(2.5);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].issue).toBe('missing_material');
  });

  it('يعلّم الوحدة المفقودة', () => {
    const r = costRecipe(
      [{ raw_material_id: 'liver', quantity: 100, unit_id: 'gone' }],
      materials,
      unitsById,
    );
    expect(r.total).toBe(0);
    expect(r.issues[0].issue).toBe('missing_unit');
  });

  it('يعلّم عدم توافق المجموعة بدل ما يخلط وزناً بحجم', () => {
    const r = costRecipe(
      [{ raw_material_id: 'oil', quantity: 100, unit_id: G.id }],
      materials,
      unitsById,
    );
    expect(r.total).toBe(0);
    expect(r.issues[0].issue).toBe('unit_mismatch');
    expect(r.lines[0].converted_qty).toBeNull();
    // نحتفظ باسم وحدة المادة عشان الرسالة تقول للمستخدم وش الصح
    expect(r.lines[0].material_unit_name).toBe('لتر');
  });

  it('الوحدة المستقلة لا تختلط بوحدة العدّ', () => {
    const r = costRecipe(
      [{ raw_material_id: 'egg', quantity: 3, unit_id: BUNDLE.id }],
      materials,
      unitsById,
    );
    expect(r.total).toBe(0);
    expect(r.issues[0].issue).toBe('unit_mismatch');
  });

  it('يعلّم المادة بلا سعر — الرقم صحيح لكن ناقص', () => {
    const withFree = { ...materials, salt: material('salt', 'ملح', KG, 0) };
    const r = costRecipe([{ raw_material_id: 'salt', quantity: 5, unit_id: G.id }], withFree, unitsById);
    expect(r.total).toBe(0);
    expect(r.issues[0].issue).toBe('no_price');
  });

  it('وصفة فارغة = بلا تسعير', () => {
    const r = costRecipe([], materials, unitsById);
    expect(r.hasRecipe).toBe(false);
    expect(r.total).toBe(0);
  });

  it('لا يراكم خطأ تقريب على كميات صغيرة متكرّرة', () => {
    const cheap = { s: material('s', 'بهار', KG, 30) };
    const lines = Array.from({ length: 10 }, () => ({ raw_material_id: 's', quantity: 0.1, unit_id: G.id }));
    const r = costRecipe(lines, cheap, unitsById);
    // 10 × 0.1جم = 1جم × 0.03 ر/جم = 0.03 بالضبط
    expect(round(r.total, 4)).toBe(0.03);
  });
});

describe('costOrder', () => {
  const recipes = {
    liverDish: { lines: [], total: 4.41, issues: [], hasRecipe: true },
    rice:      { lines: [], total: 2.5,  issues: [], hasRecipe: true },
    // وصفة ناقصة — فيها سطر معطوب
    salad:     { lines: [], total: 1.2,  issues: [{ issue: 'no_price' } as never], hasRecipe: true },
    // لا وصفة أصلاً
    juice:     { lines: [], total: 0,    issues: [], hasRecipe: false },
  };

  const quantities = [
    { meal_id: 'liverDish', meal_name: 'كبدة',  quantity: 100 },
    { meal_id: 'rice',      meal_name: 'أرز',   quantity: 100 },
    { meal_id: 'salad',     meal_name: 'سلطة',  quantity: 50 },
    { meal_id: 'juice',     meal_name: 'عصير',  quantity: 50 },
  ];

  it('يجمع تكلفة الأمر = تكلفة الحصة × الكمية', () => {
    const c = costOrder(quantities, recipes);
    // 100×4.41 + 100×2.5 + 50×1.2 + 50×0 = 441 + 250 + 60 = 751
    expect(round(c.total, 2)).toBe(751);
    expect(c.totalPortions).toBe(300);
    expect(round(c.avgPortionCost, 4)).toBe(round(751 / 300, 4));
  });

  it('يفصل الأصناف غير المسعّرة والناقصة', () => {
    const c = costOrder(quantities, recipes);
    expect(c.unpricedItems.map(i => i.meal_id)).toEqual(['juice']);
    expect(c.partialItems.map(i => i.meal_id)).toEqual(['salad']);
  });

  it('يحسب نسبة التغطية على أساس الحصص المسعّرة بالكامل', () => {
    const c = costOrder(quantities, recipes);
    // المسعّر بالكامل: 100 كبدة + 100 أرز = 200 من 300
    expect(round(c.coverage, 2)).toBe(66.67);
  });

  it('يرتّب الأصناف تنازلياً حسب التكلفة', () => {
    const c = costOrder(quantities, recipes);
    expect(c.items.map(i => i.meal_id)).toEqual(['liverDish', 'rice', 'salad', 'juice']);
  });

  it('الصنف بلا وصفة تكلفته صفر ولا يكسر الإجمالي', () => {
    const c = costOrder([{ meal_id: 'juice', meal_name: 'عصير', quantity: 10 }], recipes);
    expect(c.total).toBe(0);
    expect(c.coverage).toBe(0);
    expect(c.avgPortionCost).toBe(0);
  });

  it('أمر فارغ لا يقسم على صفر', () => {
    const c = costOrder([], recipes);
    expect(c.total).toBe(0);
    expect(c.avgPortionCost).toBe(0);
    expect(c.coverage).toBe(0);
  });

  it('صنف بلا وصفة معرّفة في الخريطة يُعامل كغير مسعّر', () => {
    const c = costOrder([{ meal_id: 'unknown', meal_name: 'مجهول', quantity: 5 }], recipes);
    expect(c.unpricedItems).toHaveLength(1);
    expect(c.total).toBe(0);
  });
});

describe('mealMargin', () => {
  it('يحسب الربح والنسب — مثال واضح', () => {
    // تكلفة 4، بيع 10 → ربح 6، هامش 60%، نسبة تكلفة 40%، إضافة 150%
    const m = mealMargin(4, 10);
    expect(m.profit).toBe(6);
    expect(round(m.marginPct!, 2)).toBe(60);
    expect(round(m.foodCostPct!, 2)).toBe(40);
    expect(round(m.markupPct!, 2)).toBe(150);
    expect(m.status).toBe('ok');
  });

  it('الهامش ونسبة التكلفة متكاملتان دائماً', () => {
    for (const [c, p] of [[3, 7], [1.25, 9.99], [8, 8.5]]) {
      const m = mealMargin(c, p);
      expect(round(m.marginPct! + m.foodCostPct!, 6)).toBe(100);
    }
  });

  it('يعلّم الخسارة لما التكلفة أعلى من البيع', () => {
    const m = mealMargin(12, 10);
    expect(m.profit).toBe(-2);
    expect(round(m.marginPct!, 2)).toBe(-20);
    expect(m.status).toBe('loss');
  });

  it('بلا سعر بيع = لا نسب ولا ربح', () => {
    for (const p of [null, undefined, 0, -5]) {
      const m = mealMargin(4, p as number | null);
      expect(m.status).toBe('unpriced');
      expect(m.profit).toBeNull();
      expect(m.marginPct).toBeNull();
    }
  });

  it('سعر بلا تكلفة يُعلَّم بدل ما يظهر هامش 100% مضلّلاً', () => {
    const m = mealMargin(0, 10);
    expect(m.status).toBe('no_cost');
    expect(m.marginPct).toBe(100);
    expect(m.markupPct).toBeNull();   // القسمة على تكلفة صفر
  });

  it('التعادل التام هامشه صفر ويُعدّ ربحاً لا خسارة', () => {
    const m = mealMargin(10, 10);
    expect(m.profit).toBe(0);
    expect(m.marginPct).toBe(0);
    expect(m.status).toBe('ok');
  });

  it('يتجاهل الأرقام غير الصالحة', () => {
    expect(mealMargin(NaN, 10).cost).toBe(0);
    expect(mealMargin(4, NaN as number).status).toBe('unpriced');
  });
});

describe('parsePositiveNumber', () => {
  it('يقرأ الأرقام اللاتينية والعشرية', () => {
    expect(parsePositiveNumber('12')).toBe(12);
    expect(parsePositiveNumber('12.5')).toBe(12.5);
    expect(parsePositiveNumber('.5')).toBe(0.5);
    expect(parsePositiveNumber(' 3 ')).toBe(3);
  });

  it('يقرأ الأرقام العربية والفارسية', () => {
    expect(parsePositiveNumber('١٢٣')).toBe(123);
    expect(parsePositiveNumber('١٢٫٥')).toBe(12.5);
    expect(parsePositiveNumber('۱۲۳')).toBe(123);
  });

  it('يتجاهل فواصل الآلاف', () => {
    expect(parsePositiveNumber('1,250')).toBe(1250);
    expect(parsePositiveNumber('1٬250')).toBe(1250);
  });

  it('يرفض ما ليس رقماً موجباً', () => {
    expect(parsePositiveNumber('')).toBeNull();
    expect(parsePositiveNumber('abc')).toBeNull();
    expect(parsePositiveNumber('-5')).toBeNull();
    expect(parsePositiveNumber('1.2.3')).toBeNull();
    expect(parsePositiveNumber('5kg')).toBeNull();
    expect(parsePositiveNumber('1e5')).toBeNull();
  });

  it('يقبل الصفر (سعر مادة مجانية)', () => {
    expect(parsePositiveNumber('0')).toBe(0);
  });
});

describe('formatMoney / formatQty', () => {
  it('يعرض المبلغ بخانتين دائماً مع فواصل الآلاف', () => {
    expect(formatMoney(1234.5)).toBe('1,234.50');
    expect(formatMoney(0)).toBe('0.00');
    expect(formatMoney(4.409)).toBe('4.41');
  });

  it('يشيل الأصفار الزائدة من الكمية', () => {
    expect(formatQty(1.5)).toBe('1.5');
    expect(formatQty(150)).toBe('150');
    expect(formatQty(0.1234)).toBe('0.1234');
  });
});
