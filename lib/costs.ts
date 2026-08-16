// ============================================================================
// حساب التكاليف — النواة الحسابية
//
// وحدة نقية (بدون 'use client' وبدون أي استدعاء لقاعدة البيانات) عشان يستخدمها
// الخادم (app/api/costs) والواجهة معاً بنفس المعادلة بالضبط — أي اختلاف بين
// الاثنين يعني رقمين مختلفين لنفس الأمر، وهذا آخر شي نبيه في صفحة تكاليف.
//
// المعادلة:
//   تكلفة السطر  = (الكمية بعد التحويل لوحدة شراء المادة) × سعر وحدة المادة
//   تكلفة الحصة  = مجموع أسطر الوصفة   (الكميات في الوصفة *لحصة واحدة*)
//   تكلفة الأمر  = مجموع (تكلفة حصة الصنف × الكمية النهائية للصنف في الأمر)
//
// الوحدات بيانات لا كود: كل وحدة لها «مجموعة» (family) و«معامل» (factor) نسبةً
// للوحدة الأساسية في مجموعتها. التحويل مسموح داخل المجموعة فقط — فما نقدر نحوّل
// لتراً إلى كيلو بالغلط. المستخدم يضيف وحداته بنفسه (رطل، كرتون، صاع…).
//
// الدقة: كل الحسابات الوسيطة تبقى بدقة كاملة (double) والتقريب يصير في آخر
// خطوة فقط — تقريب كل سطر على حدة يراكم فروقات هلّلات على مئات الحصص.
// ============================================================================

/** تعريف وحدة قياس — صفّ في جدول cost_units */
export interface CostUnitDef {
  id: string;
  name: string;
  /** مجموعة التحويل — التحويل مسموح داخلها فقط */
  family: string;
  /** كم وحدة أساسية من نفس المجموعة تساوي هذه الوحدة (كجم = 1000 جم) */
  factor: number;
  /** وحدة مدمجة مع النظام — لا تُحذف */
  is_builtin?: boolean;
}

/** المجموعات المدمجة — أي مجموعة غير هذي ينشئها المستخدم */
export const BUILTIN_FAMILIES = ['weight', 'volume', 'count'] as const;

export const BUILTIN_FAMILY_LABELS: Record<string, string> = {
  weight: 'وزن',
  volume: 'حجم',
  count:  'عدد',
};

/**
 * اسم المجموعة للعرض. المجموعات المخصّصة ما لها اسم مخزّن — نسمّيها باسم
 * وحدتها الأساسية (أصغر معامل)، مثلاً مجموعة «كرتون/حبة» تظهر باسم «حبة».
 */
export function familyLabel(family: string, units: CostUnitDef[]): string {
  const builtin = BUILTIN_FAMILY_LABELS[family];
  if (builtin) return builtin;
  const base = units
    .filter(u => u.family === family)
    .sort((a, b) => a.factor - b.factor)[0];
  return base ? `مجموعة ${base.name}` : 'مجموعة مخصّصة';
}

/** وحدات نفس مجموعة الوحدة المعطاة — تُستخدم لبناء قوائم الوحدات في الواجهة */
export function unitsInFamily(unit: CostUnitDef | undefined, units: CostUnitDef[]): CostUnitDef[] {
  if (!unit) return [];
  return units
    .filter(u => u.family === unit.family)
    .sort((a, b) => a.factor - b.factor);
}

/**
 * أصغر وحدة في مجموعة الوحدة المعطاة (مل للحجم، جم للوزن، حبة للعدّ).
 * هذي الوحدة الافتراضية لأسطر الوصفات: المطبخ يشتري باللتر والكيلو لكن
 * يصرف في الصحن الواحد بالمل والجرام، فنبدأ من الوحدة الصغيرة.
 */
export function baseUnitOf(
  unit: CostUnitDef | undefined,
  units: CostUnitDef[],
): CostUnitDef | undefined {
  return unitsInFamily(unit, units)[0] ?? unit;
}

/**
 * معامل وحدة جديدة تُعرَّف نسبةً لوحدة قائمة.
 * مثال: رطل = 0.4536 كجم → 0.4536 × 1000 = 453.6 (بالجرام، أساس مجموعة الوزن)
 */
export function deriveFactor(qtyOfReference: number, reference: CostUnitDef): number {
  return qtyOfReference * reference.factor;
}

/** مجموعة جديدة مستقلة — لوحدة لا تتحوّل إلى أي شيء آخر */
export function newCustomFamily(seed: string): string {
  return `custom:${seed}`;
}

/**
 * تحويل كمية بين وحدتين. يرجّع null لو الوحدتان من مجموعتين مختلفتين —
 * إشارة خطأ صريحة بدل رقم مغلوط بصمت.
 */
export function convertQuantity(
  qty: number,
  from: CostUnitDef,
  to: CostUnitDef,
): number | null {
  if (!Number.isFinite(qty)) return null;
  if (from.family !== to.family) return null;
  if (from.id === to.id) return qty;
  if (!(to.factor > 0) || !(from.factor > 0)) return null;
  return (qty * from.factor) / to.factor;
}

/**
 * تقريب بعدد خانات محدّد، مع تصحيح شذوذ الفاصلة العائمة.
 * مثال: 1.005 × 100 = 100.49999999999999 في الـdouble، والتقريب المباشر
 * يعطي 1.00 بدل 1.01. نثبّت الرقم على 9 خانات قبل التقريب فينضبط.
 */
export function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0;
  const f = 10 ** digits;
  const sign = value < 0 ? -1 : 1;
  const scaled = Number((Math.abs(value) * f).toFixed(9));
  return (sign * Math.round(scaled)) / f;
}

/** تنسيق مبلغ بالريال — خانتان دائماً، بأرقام لاتينية عشان تنقرأ في التقارير */
export function formatMoney(value: number): string {
  return round(value, 2).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** تنسيق كمية — يشيل الأصفار الزائدة (1.5000 → 1.5) */
export function formatQty(value: number): string {
  return String(round(value, 4));
}

// ── أنواع البيانات ──────────────────────────────────────────────────────────

export interface RawMaterial {
  id: string;
  name: string;
  /** وحدة الشراء — مفتاح في cost_units */
  unit_id: string;
  unit_cost: number;
  notes?: string | null;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

/** سطر في وصفة صنف — الكمية *لحصة واحدة* */
export interface RecipeItem {
  id: string;
  meal_id: string;
  raw_material_id: string;
  quantity: number;
  unit_id: string;
}

/** سبب تعذّر تسعير سطر — null يعني السطر مسعّر صح */
export type LineIssue = 'missing_material' | 'missing_unit' | 'unit_mismatch' | 'no_price';

export const LINE_ISSUE_LABELS: Record<LineIssue, string> = {
  missing_material: 'المادة الأولية محذوفة أو غير موجودة',
  missing_unit:     'وحدة القياس محذوفة أو غير موجودة',
  unit_mismatch:    'وحدة الكمية من مجموعة غير مجموعة وحدة شراء المادة',
  no_price:         'سعر المادة الأولية = 0 — لم يُدخل بعد',
};

export interface CostedLine {
  raw_material_id: string;
  name: string;
  /** الكمية كما أُدخلت في الوصفة */
  quantity: number;
  unit_id: string;
  unit_name: string;
  /** وحدة شراء المادة وسعرها وقت الحساب */
  material_unit_name: string | null;
  unit_cost: number;
  /** الكمية بعد التحويل لوحدة الشراء — null عند تعذّر التحويل */
  converted_qty: number | null;
  /** تكلفة السطر لحصة واحدة (0 عند وجود issue مانع) */
  cost: number;
  issue: LineIssue | null;
}

export interface RecipeCost {
  lines: CostedLine[];
  /** تكلفة الحصة الواحدة — مجموع الأسطر السليمة */
  total: number;
  /** أسطر تعذّر تسعيرها — وجودها يعني الرقم ناقص */
  issues: CostedLine[];
  /** هل الوصفة موجودة أصلاً (فيها سطر واحد على الأقل) */
  hasRecipe: boolean;
}

// ── تسعير وصفة صنف ──────────────────────────────────────────────────────────

export interface RecipeLineInput {
  raw_material_id: string;
  quantity: number;
  unit_id: string;
}

/**
 * يحسب تكلفة حصة واحدة من صنف بناءً على أسطر وصفته وأسعار المواد الحالية.
 * الأسطر التي يتعذّر تسعيرها تُحسب صفراً لكن تُرجَّع في issues — الواجهة
 * تعرضها بوضوح بدل ما تعطي المستخدم رقماً ناقصاً يظنه صحيحاً.
 */
export function costRecipe(
  items: RecipeLineInput[],
  materialsById: Record<string, RawMaterial | undefined>,
  unitsById: Record<string, CostUnitDef | undefined>,
): RecipeCost {
  const lines: CostedLine[] = items.map(item => {
    const material = materialsById[item.raw_material_id];
    const lineUnit = unitsById[item.unit_id];

    const base = {
      raw_material_id: item.raw_material_id,
      name: material?.name ?? '—',
      quantity: item.quantity,
      unit_id: item.unit_id,
      unit_name: lineUnit?.name ?? '—',
      material_unit_name: null as string | null,
      unit_cost: 0,
      converted_qty: null as number | null,
      cost: 0,
    };

    if (!material) return { ...base, issue: 'missing_material' as LineIssue };

    const materialUnit = unitsById[material.unit_id];
    if (!lineUnit || !materialUnit) return { ...base, issue: 'missing_unit' as LineIssue };

    base.material_unit_name = materialUnit.name;
    base.unit_cost = material.unit_cost;

    const converted = convertQuantity(item.quantity, lineUnit, materialUnit);
    if (converted === null) return { ...base, issue: 'unit_mismatch' as LineIssue };

    return {
      ...base,
      converted_qty: converted,
      cost: converted * material.unit_cost,
      issue: material.unit_cost > 0 ? null : ('no_price' as LineIssue),
    };
  });

  return {
    lines,
    total: lines.reduce((sum, l) => sum + l.cost, 0),
    issues: lines.filter(l => l.issue !== null),
    hasRecipe: items.length > 0,
  };
}

// ── تسعير أمر تشغيل ─────────────────────────────────────────────────────────

/** كمية صنف داخل أمر تشغيل — تجي من itemFinalCounts في تقرير الأمر */
export interface OrderQuantity {
  meal_id: string;
  meal_name: string;
  quantity: number;
}

export interface CostedOrderItem extends OrderQuantity {
  /** تكلفة الحصة الواحدة */
  portion_cost: number;
  /** تكلفة الصنف كاملاً في هذا الأمر = portion_cost × quantity */
  total_cost: number;
  /** الصنف ما له وصفة أصلاً — تكلفته 0 والرقم الكلي ناقص */
  unpriced: boolean;
  /** وصفته موجودة لكن فيها أسطر معطوبة */
  partial: boolean;
}

export interface OrderCost {
  items: CostedOrderItem[];
  /** إجمالي تكلفة الأمر */
  total: number;
  /** إجمالي الحصص (لحساب متوسط تكلفة الحصة) */
  totalPortions: number;
  /** متوسط تكلفة الحصة الواحدة في هذا الأمر */
  avgPortionCost: number;
  /** أصناف بلا وصفة — تحذير للمستخدم */
  unpricedItems: CostedOrderItem[];
  /** أصناف وصفتها ناقصة */
  partialItems: CostedOrderItem[];
  /** نسبة التغطية: كم % من الحصص لها تسعير كامل */
  coverage: number;
}

/**
 * يحسب تكلفة أمر تشغيل من كميات أصنافه النهائية + تكلفة حصة كل صنف.
 * recipeCosts: خريطة meal_id → RecipeCost (ناتج costRecipe لكل صنف).
 */
export function costOrder(
  quantities: OrderQuantity[],
  recipeCosts: Record<string, RecipeCost | undefined>,
): OrderCost {
  const items: CostedOrderItem[] = quantities.map(q => {
    const recipe = recipeCosts[q.meal_id];
    const hasRecipe = !!recipe?.hasRecipe;
    const portionCost = hasRecipe ? recipe!.total : 0;
    return {
      ...q,
      portion_cost: portionCost,
      total_cost: portionCost * q.quantity,
      unpriced: !hasRecipe,
      partial: hasRecipe && (recipe!.issues.length > 0),
    };
  });

  const total = items.reduce((s, i) => s + i.total_cost, 0);
  const totalPortions = items.reduce((s, i) => s + i.quantity, 0);
  const unpricedItems = items.filter(i => i.unpriced);
  const partialItems = items.filter(i => i.partial);
  const pricedPortions = items
    .filter(i => !i.unpriced && !i.partial)
    .reduce((s, i) => s + i.quantity, 0);

  return {
    items: items.slice().sort((a, b) => b.total_cost - a.total_cost),
    total,
    totalPortions,
    avgPortionCost: totalPortions > 0 ? total / totalPortions : 0,
    unpricedItems,
    partialItems,
    coverage: totalPortions > 0 ? (pricedPortions / totalPortions) * 100 : 0,
  };
}

// ── تحليل نص الكمية ─────────────────────────────────────────────────────────

/**
 * يقرأ رقماً من إدخال المستخدم بأمان: يقبل الأرقام العربية والفاصلة العربية،
 * ويرفض ما ليس رقماً موجباً. يرجّع null عند الرفض بدل NaN المتسلّل للحساب.
 */
export function parsePositiveNumber(raw: string): number | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw
    .trim()
    // الأرقام العربية-الهندية ٠-٩ والفارسية ۰-۹
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
    .replace(/٫/g, '.')          // الفاصلة العشرية العربية → نقطة
    .replace(/[\s,،٬]/g, '');    // فواصل الآلاف (لاتينية/عربية) والمسافات
  if (normalized === '') return null;
  if (!/^\d*\.?\d+$/.test(normalized)) return null;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
