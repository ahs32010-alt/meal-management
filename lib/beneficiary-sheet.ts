import type { ItemCategory, MealType } from '@/lib/types';
import { DAYS_ORDER, MEAL_TYPE_LABELS } from '@/lib/types';
import { STICKER_FLAGS } from '@/lib/sticker-flags';
import { ALT_MARK, ALT_MARK_RE, CAT_AR, CAT_FROM_AR, CATEGORY_MARK_RE, DAY_FROM_AR, DAY_SHORT } from '@/lib/sheet-marks';

/**
 * صيغة ورقة المستفيدين/المرافقين — **مصدر واحد** يستعمله:
 *   • تصدير/استيراد صفحة المستفيدين (components/beneficiaries/BeneficiaryList)
 *   • ورقة المستفيدين داخل النسخة الاحتياطية (lib/backup-export)
 *
 * كانت الصيغة مكتوبة مرّتين فتباعدتا: النسخة الاحتياطية ما كانت تعرف أعمدة
 * أضيفت للصفحة. وكلتاهما كانتا تُسقطان حقولاً يحرّرها المستخدم فعلاً:
 *   • «مفعّل» (is_active) — المعطّل مستبعَد من كل الأعداد، وغيابه من الملف
 *     يعني أن أي استيراد يُعيد تفعيل الجميع فتقفز أعداد أوامر التشغيل.
 *   • خيارات الستيكر الثلاثة (لا يفضل السمك…) — تختفي من الستيكرات.
 *   • علامة «صنف بديل» على الصنف الثابت — تنقل الكمية بين خانتين في التقرير.
 *
 * كل الأعمدة الجديدة **اختيارية عند القراءة**: الملفات القديمة تُقرأ كما كانت
 * تماماً (مفعّل = نعم، الخيارات = لا، بديل = لا).
 *
 * وأُضيف لاحقاً عمودان لحقول تحرّرها نافذة المستفيد وكانت تضيع مع أي استبدال:
 *   • «النظام الغذائي الأساسي» — الأنظمة المسندة (beneficiary_diets) بأسمائها.
 *   • «تعديلات المنيو لخانات محددة» — قرارات تبويب «المنيو المخصّص»
 *     (beneficiary_menu_overrides).
 */

// ─── الأعمدة ────────────────────────────────────────────────────────────────

export const COL_ACTIVE = 'مفعّل';

/** «وجبات غداء وعشاء مخصصة» — علامة فرز لا تُطبع على الستيكر؛ عمود اختياري */
export const COL_CUSTOM_LD = 'وجبات غداء وعشاء مخصصة';

/**
 * الأنظمة الغذائية المسندة (diet_systems) بأسمائها، مفصولة بـ" - ".
 * غير «النظام الغذائي» (diet_type) الذي هو نص حر — التسمية هي نفسها في النافذة.
 */
export const COL_DIETS = 'النظام الغذائي الأساسي';

/** قرارات «المنيو المخصّص» على خانة محددة (أسبوع/يوم/وجبة) — عمود اختياري */
export const COL_MENU_OVERRIDES = 'تعديلات المنيو لخانات محددة';

/** عمود لكل خيار ستيكر، بنفس تسميته في واجهة تخصيص المستفيد */
export const STICKER_FLAG_COLUMNS = STICKER_FLAGS.map(f => ({ key: f.key, col: f.label }));

const MEAL_COLS = [
  { label: 'الفطور', type: 'breakfast' as MealType },
  { label: 'الغداء', type: 'lunch'     as MealType },
  { label: 'العشاء', type: 'dinner'    as MealType },
];

export const EXCLUSION_COLUMNS = MEAL_COLS.flatMap(m => ([
  { col: `محظورات ${m.label}`,        type: m.type, isSnack: false },
  { col: `محظورات سناكات ${m.label}`, type: m.type, isSnack: true  },
]));

export const FIXED_COLUMNS = MEAL_COLS.flatMap(m => ([
  { col: `ثابتة ${m.label}`,        type: m.type, isSnack: false },
  { col: `ثابتة سناكات ${m.label}`, type: m.type, isSnack: true  },
]));

/** ترتيب أعمدة الملف — التصدير والقالب والاستيراد كلها تقرأ من هنا */
export const BENEFICIARY_HEADERS: string[] = [
  'الاسم', 'الاسم الإنجليزي', 'الكود', 'الفئة', 'الفيلا', 'النظام الغذائي',
  COL_DIETS,
  ...EXCLUSION_COLUMNS.map(c => c.col),
  ...FIXED_COLUMNS.map(c => c.col),
  COL_MENU_OVERRIDES,
  'ملاحظات',
  COL_ACTIVE,
  ...STICKER_FLAG_COLUMNS.map(c => c.col),
  COL_CUSTOM_LD,
];

/**
 * صف المثال في قالب الاستيراد — مبني بالاسم لا بالموضع، فإضافة عمود جديد
 * لا تُزيح الأمثلة تحت رؤوس غير رؤوسها (كان القالب مصفوفة مواضع يدوية).
 */
const TEMPLATE_SAMPLE: Record<string, string> = {
  'الاسم': 'محمد أحمد',
  'الاسم الإنجليزي': 'Mohammad Ahmad',
  'الكود': 'B001',
  'الفئة': 'عائلة',
  'الفيلا': '5',
  'النظام الغذائي': '',
  // أسماء أنظمة موجودة في صفحة «النظام الغذائي»، مفصولة بـ" - "
  [COL_DIETS]: '',
  // محظور؛بديله — والمحظورات مفصولة بـ" - "
  'محظورات الفطور': 'فول؛كبدة - شكشوكة؛تونة',
  // أمثلة الأصناف الثابتة:
  //   فول×2؛سبت احد اربعاء  → كمية 2 (تصنيف افتراضي حار)
  //   سلطة؛سبت احد@بارد       → فئة بارد بدل الافتراضي
  //   مكرونة؛سبت↛فول,بيض     → تُلغى لو وُجد "فول" أو "بيض" في نفس الأمر
  //   تمر؛سبت@بديل            → يُحتسب مع البدائل بدل الأصناف الثابتة
  'ثابتة الفطور': 'فول×2؛سبت احد اربعاء - سلطة؛سبت احد@بارد - مكرونة؛سبت↛فول,بيض',
  // أسبوع؛يوم؛وجبة؛إجراء؛الصنف — الإجراء: استبدال (قديم←جديد) / حذف / إضافة
  [COL_MENU_OVERRIDES]: 'أسبوع1؛سبت؛فطور؛استبدال؛فول←بيض - أسبوع2؛احد؛فطور؛حذف؛شكشوكة - أسبوع3؛خميس؛فطور؛إضافة؛فول×2',
  'ملاحظات': '',
  // مفعّل + خيارات الستيكر — أعمدة اختيارية، غيابها يعني مفعّل/لا
  [COL_ACTIVE]: 'نعم',
};

export const BENEFICIARY_TEMPLATE_ROW: string[] =
  BENEFICIARY_HEADERS.map(h => TEMPLATE_SAMPLE[h] ?? (h === COL_CUSTOM_LD || STICKER_FLAG_COLUMNS.some(f => f.col === h) ? 'لا' : ''));

/**
 * يوحّد رؤوس صف مقروء من ملف: مسافة زائدة أو مزدوجة في رأس العمود كانت
 * تجعل العمود «غير موجود» فيُسقط بصمت (ImportModal يتسامح معها في فحص
 * الأعمدة الإلزامية، فيمرّ الملف ثم تُقرأ خلاياه فارغة).
 */
export function normalizeSheetRow(row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/\s+/g, ' ').trim()] = v == null ? '' : String(v);
  }
  return out;
}

// ─── نعم/لا ─────────────────────────────────────────────────────────────────

export function formatYesNo(v: boolean): string {
  return v ? 'نعم' : 'لا';
}

/** يقرأ نعم/لا بتسامح. القيمة الفارغة (عمود غير موجود في ملف قديم) → الافتراضي. */
export function parseYesNo(raw: string | undefined | null, fallback: boolean): boolean {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return fallback;
  if (['نعم', 'yes', 'true', '1', 'y', '✓'].includes(s)) return true;
  if (['لا', 'no', 'false', '0', 'n', '✗', '-'].includes(s)) return false;
  return fallback;
}

// ─── رموز داخل خلايا الأصناف الثابتة ────────────────────────────────────────
// الرموز نفسها في lib/sheet-marks — مشتركة مع ملف قائمة الطعام.

export {
  CAT_AR, CAT_FROM_AR, CATEGORY_MARK_RE,
  ALT_MARK, ALT_MARK_RE,
  DAY_SHORT, DAY_FROM_AR,
} from '@/lib/sheet-marks';

// ─── بناء الصف ──────────────────────────────────────────────────────────────

export interface SheetMeal { id: string; name: string; type: MealType; is_snack: boolean }

export interface SheetExclusion { meal_id: string; alternative_meal_id?: string | null }

export interface SheetFixedMeal {
  meal_id: string;
  day_of_week: number;
  meal_type: MealType;
  quantity?: number | null;
  category?: ItemCategory | null;
  suppress_if_meal_ids?: string[] | null;
  is_alternative?: boolean | null;
}

export interface SheetBeneficiary {
  name: string;
  english_name?: string | null;
  code: string;
  category?: string | null;
  villa?: string | null;
  diet_type?: string | null;
  notes?: string | null;
  is_active?: boolean | null;
  no_fish?: boolean | null;
  no_pasta_sandwich?: boolean | null;
  low_carb?: boolean | null;
  custom_ld_meals?: boolean | null;
  /** أسماء الأنظمة الغذائية المسندة — غيابها = عمود فارغ */
  diet_names?: string[] | null;
}

/** قرار «المنيو المخصّص» على خانة واحدة — نفس أعمدة beneficiary_menu_overrides */
export interface SheetMenuOverride {
  week_number: number;
  day_of_week: number;
  meal_type: MealType;
  action: 'replace' | 'remove' | 'add';
  base_meal_id?: string | null;
  target_meal_id?: string | null;
  quantity?: number | null;
  is_alternative?: boolean | null;
}

function buildExclusionCell(
  exclusions: SheetExclusion[],
  mealsById: Map<string, SheetMeal>,
  type: MealType,
  isSnack: boolean,
): string {
  return exclusions
    .map(e => {
      const m = mealsById.get(e.meal_id);
      if (!m || m.type !== type || m.is_snack !== isSnack) return '';
      const alt = e.alternative_meal_id ? mealsById.get(e.alternative_meal_id) : null;
      return alt ? `${m.name}؛${alt.name}` : m.name;
    })
    .filter(Boolean)
    .join(' - ');
}

function buildFixedCell(
  fixed: SheetFixedMeal[],
  mealsById: Map<string, SheetMeal>,
  type: MealType,
  isSnack: boolean,
): string {
  const sectionDefault: ItemCategory = isSnack ? 'snack' : 'hot';
  // نجمع حسب (صنف|فئة|بديل) — نفس الصنف بفئتين مختلفتين يظهر رمزين منفصلين
  const groups = new Map<string, { name: string; days: number[]; quantity: number; category: ItemCategory; isAlt: boolean; suppressIds: string[] }>();

  for (const fm of fixed) {
    if (fm.meal_type !== type) continue;
    const m = mealsById.get(fm.meal_id);
    if (!m || m.is_snack !== isSnack) continue;
    const category = (fm.category ?? sectionDefault) as ItemCategory;
    const isAlt = fm.is_alternative === true;
    const key = `${fm.meal_id}|${category}|${isAlt ? '1' : '0'}`;
    const g = groups.get(key);
    if (g) { g.days.push(fm.day_of_week); continue; }
    groups.set(key, {
      name: m.name,
      days: [fm.day_of_week],
      quantity: fm.quantity ?? 1,
      category,
      isAlt,
      suppressIds: Array.isArray(fm.suppress_if_meal_ids) ? [...fm.suppress_if_meal_ids] : [],
    });
  }

  return Array.from(groups.values())
    .map(({ name, days, quantity, category, isAlt, suppressIds }) => {
      const nameStr = quantity > 1 ? `${name}×${quantity}` : name;
      const daysStr = days.map(d => DAY_SHORT[d]).join(' ');
      const catSuffix = category !== sectionDefault ? `@${CAT_AR[category]}` : '';
      const altSuffix = isAlt ? ALT_MARK : '';
      const suppressNames = suppressIds.map(id => mealsById.get(id)?.name ?? '').filter(Boolean);
      const suppressSuffix = suppressNames.length ? `↛${suppressNames.join(',')}` : '';
      return `${nameStr}؛${daysStr}${catSuffix}${altSuffix}${suppressSuffix}`;
    })
    .join(' - ');
}

// ─── قرارات المنيو المخصّص ──────────────────────────────────────────────────

const OVERRIDE_ACTION_AR: Record<SheetMenuOverride['action'], string> = {
  replace: 'استبدال', remove: 'حذف', add: 'إضافة',
};
const OVERRIDE_ACTION_FROM_AR: Record<string, SheetMenuOverride['action']> = {
  'استبدال': 'replace', 'تبديل': 'replace',
  'حذف': 'remove', 'إزالة': 'remove', 'ازالة': 'remove',
  'إضافة': 'add', 'اضافة': 'add',
};
const MEAL_TYPE_FROM_AR: Record<string, MealType> = {
  'فطور': 'breakfast', 'الفطور': 'breakfast',
  'غداء': 'lunch', 'الغداء': 'lunch',
  'عشاء': 'dinner', 'العشاء': 'dinner',
};
const MEAL_TYPE_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner'];
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** `اسم` أو `اسم×2` أو `اسم×2@بديل` */
function formatOverrideTarget(name: string, quantity: number, isAlt: boolean): string {
  return `${name}${quantity > 1 ? `×${quantity}` : ''}${isAlt ? ALT_MARK : ''}`;
}

function buildOverridesCell(overrides: SheetMenuOverride[], mealsById: Map<string, SheetMeal>): string {
  return [...overrides]
    .sort((a, b) =>
      a.week_number - b.week_number ||
      DAYS_ORDER.indexOf(a.day_of_week) - DAYS_ORDER.indexOf(b.day_of_week) ||
      MEAL_TYPE_ORDER.indexOf(a.meal_type) - MEAL_TYPE_ORDER.indexOf(b.meal_type))
    .map(ov => {
      const base = ov.base_meal_id ? mealsById.get(ov.base_meal_id)?.name : undefined;
      const target = ov.target_meal_id ? mealsById.get(ov.target_meal_id)?.name : undefined;
      const qty = ov.quantity ?? 1;
      const isAlt = ov.is_alternative === true;
      let body: string | undefined;
      if (ov.action === 'remove') body = base;
      else if (ov.action === 'add') body = target ? formatOverrideTarget(target, qty, isAlt) : undefined;
      else body = base && target ? `${base}←${formatOverrideTarget(target, qty, isAlt)}` : undefined;
      if (!body) return '';
      const slot = `أسبوع${ov.week_number}؛${DAY_SHORT[ov.day_of_week]}؛${MEAL_TYPE_LABELS[ov.meal_type]}`;
      return `${slot}؛${OVERRIDE_ACTION_AR[ov.action]}؛${body}`;
    })
    .filter(Boolean)
    .join(' - ');
}

export interface ParsedOverrideToken {
  week_number: number;
  day_of_week: number;
  meal_type: MealType;
  action: SheetMenuOverride['action'];
  baseName: string | null;
  targetName: string | null;
  quantity: number;
  isAlternative: boolean;
}

/**
 * يفكّ رمزاً مثل: `أسبوع2؛سبت؛غداء؛استبدال؛رز←برغل×2@بديل`
 * يرجّع نص خطأ عربي واضح بدل null — الاستيراد يعرضه كما هو.
 */
export function parseOverrideToken(raw: string): ParsedOverrideToken | string {
  const parts = raw.split('؛').map(s => s.trim());
  if (parts.length !== 5 || parts.some(p => !p)) {
    return `الرمز «${raw}» غير مكتمل — الصيغة: أسبوع1؛سبت؛غداء؛استبدال؛قديم←جديد`;
  }
  const [weekStr, dayStr, mealStr, actionStr, body] = parts;

  const weekMatch = weekStr.replace(/[٠-٩]/g, d => String(ARABIC_DIGITS.indexOf(d)))
    .match(/^(?:ال)?[أا]سبوع\s*([1-4])$/);
  if (!weekMatch) return `الأسبوع «${weekStr}» غير صحيح — اكتب أسبوع1 إلى أسبوع4`;
  const day = DAY_FROM_AR[dayStr];
  if (day === undefined) return `اليوم «${dayStr}» غير معروف`;
  const mealType = MEAL_TYPE_FROM_AR[mealStr];
  if (!mealType) return `الوجبة «${mealStr}» غير معروفة — اكتب فطور أو غداء أو عشاء`;
  const action = OVERRIDE_ACTION_FROM_AR[actionStr];
  if (!action) return `الإجراء «${actionStr}» غير معروف — اكتب استبدال أو حذف أو إضافة`;

  const parseTarget = (s: string) => {
    let part = s.trim();
    const isAlternative = ALT_MARK_RE.test(part);
    if (isAlternative) part = part.replace(ALT_MARK_RE, '').trim();
    const qtyMatch = part.match(/^(.+?)×(\d+)$/);
    return {
      name: (qtyMatch ? qtyMatch[1] : part).trim(),
      quantity: qtyMatch ? parseInt(qtyMatch[2], 10) : 1,
      isAlternative,
    };
  };

  const base = { week_number: Number(weekMatch[1]), day_of_week: day, meal_type: mealType, action };
  if (action === 'remove') {
    return { ...base, baseName: body, targetName: null, quantity: 1, isAlternative: false };
  }
  if (action === 'add') {
    const t = parseTarget(body);
    if (!t.name) return `الرمز «${raw}» بلا اسم صنف`;
    return { ...base, baseName: null, targetName: t.name, quantity: t.quantity, isAlternative: t.isAlternative };
  }
  const [baseName, targetRaw] = body.split(/[←→]/).map(s => s.trim());
  if (!baseName || !targetRaw) return `الاستبدال «${raw}» يحتاج الصنفين: قديم←جديد`;
  const t = parseTarget(targetRaw);
  return { ...base, baseName, targetName: t.name, quantity: t.quantity, isAlternative: t.isAlternative };
}

/** صف واحد كامل بترتيب BENEFICIARY_HEADERS */
export function buildBeneficiaryRow(
  ben: SheetBeneficiary,
  exclusions: SheetExclusion[],
  fixed: SheetFixedMeal[],
  mealsById: Map<string, SheetMeal>,
  /** اختياري — من لا يمرّره (النسخة الاحتياطية) يحصل على عمود فارغ */
  overrides: SheetMenuOverride[] = [],
): Record<string, string> {
  const row: Record<string, string> = {
    'الاسم': ben.name,
    'الاسم الإنجليزي': ben.english_name ?? '',
    'الكود': ben.code,
    'الفئة': ben.category ?? '',
    'الفيلا': ben.villa ?? '',
    'النظام الغذائي': ben.diet_type ?? '',
    [COL_DIETS]: (ben.diet_names ?? []).filter(Boolean).join(' - '),
  };
  for (const c of EXCLUSION_COLUMNS) row[c.col] = buildExclusionCell(exclusions, mealsById, c.type, c.isSnack);
  for (const c of FIXED_COLUMNS)     row[c.col] = buildFixedCell(fixed, mealsById, c.type, c.isSnack);
  row[COL_MENU_OVERRIDES] = buildOverridesCell(overrides, mealsById);
  row['ملاحظات'] = ben.notes ?? '';
  // `is_active` غير محدّد = مفعّل (الترقية ما اتشغّلت) — نفس ما تفترضه كل الصفحات
  row[COL_ACTIVE] = formatYesNo(ben.is_active !== false);
  for (const f of STICKER_FLAG_COLUMNS) row[f.col] = formatYesNo(ben[f.key] === true);
  row[COL_CUSTOM_LD] = formatYesNo(ben.custom_ld_meals === true);
  return row;
}

// ─── تفكيك رمز الصنف الثابت عند الاستيراد ───────────────────────────────────

export interface ParsedFixedToken {
  mealName: string;
  quantity: number;
  category: ItemCategory;
  isAlternative: boolean;
  suppressNames: string[];
  dayTokens: string[];
}

/**
 * يفكّ رمزاً مثل: `فول×2؛سبت احد@بارد@بديل↛بيض,شكشوكة`
 * يرجّع null لو الرمز ناقص (بلا اسم أو بلا أيام).
 */
export function parseFixedToken(raw: string, sectionDefault: ItemCategory): ParsedFixedToken | null {
  let part = raw.trim();
  if (!part) return null;

  let category = sectionDefault;
  const catMatch = part.match(CATEGORY_MARK_RE);
  if (catMatch) {
    category = CAT_FROM_AR[catMatch[1]] ?? sectionDefault;
    part = part.replace(catMatch[0], '').trim();
  }

  const isAlternative = ALT_MARK_RE.test(part);
  if (isAlternative) part = part.replace(ALT_MARK_RE, '').trim();

  let suppressNames: string[] = [];
  const suppressMatch = part.match(/↛\s*([^@]+?)\s*$/);
  if (suppressMatch) {
    suppressNames = suppressMatch[1].split(/[,،]/).map(s => s.trim()).filter(Boolean);
    part = part.replace(suppressMatch[0], '').trim();
  }

  const [mealPart, daysStr] = part.split('؛').map(s => s.trim());
  if (!mealPart || !daysStr) return null;

  const qtyMatch = mealPart.match(/^(.+?)×(\d+)$/);
  return {
    mealName: (qtyMatch ? qtyMatch[1] : mealPart).trim(),
    quantity: qtyMatch ? parseInt(qtyMatch[2], 10) : 1,
    category,
    isAlternative,
    suppressNames,
    dayTokens: daysStr.split(/[\s،,]+/).filter(Boolean),
  };
}

/** يقسّم خلية إلى رموزها المفصولة بـ" - " (نفس الفاصل المستخدم في التصدير) */
export function splitCellTokens(raw: string): string[] {
  return raw.split(/ - | -|- /).map(s => s.trim()).filter(Boolean);
}

// ─── تحقّق الدورة ────────────────────────────────────────────────────────────

export interface SheetRoundTripResult {
  ok: boolean;
  /** عدد المستفيدين الذين عبروا الدورة سليمين */
  matched: number;
  issues: string[];
}

/**
 * ⚠️ **قراءة فقط**: لا يكتب ولا يحذف ولا ينزّل شيئاً. يبني صف الملف في
 * الذاكرة، يعيد قراءته، ويقارن. كل ما يرجّعه هو تقرير عن **ماذا سيحدث لو
 * صدّرت الآن** — لا وصف لشيء حدث. لهذا كل رسائله بصيغة الشرط.
 *
 * يقارن: حالة التفعيل، خيارات الستيكر، المحظورات مع بدائلها، والأصناف الثابتة
 * بكمياتها وفئاتها وعلامة البديل وقائمة الإلغاء.
 */
export function verifyBeneficiaryRoundTrip(
  bens: Array<{
    ben: SheetBeneficiary;
    exclusions: SheetExclusion[];
    fixed: SheetFixedMeal[];
    overrides?: SheetMenuOverride[];
  }>,
  mealsById: Map<string, SheetMeal>,
): SheetRoundTripResult {
  const issues: string[] = [];
  let matched = 0;

  // البحث بالاسم كما يفعل الاستيراد بالضبط: (اسم|نوع|سناك)
  const idByNameKey = new Map<string, string>();
  for (const m of mealsById.values()) {
    idByNameKey.set(`${m.name.trim()}|${m.type}|${m.is_snack ? '1' : '0'}`, m.id);
  }
  const lookup = (name: string, type: MealType, isSnack: boolean) =>
    idByNameKey.get(`${name.trim()}|${type}|${isSnack ? '1' : '0'}`);

  for (const { ben, exclusions, fixed, overrides = [] } of bens) {
    const before = issues.length;
    const row = buildBeneficiaryRow(ben, exclusions, fixed, mealsById, overrides);
    const who = `${ben.name} (${ben.code})`;

    // ① التفعيل وخيارات الستيكر
    if (parseYesNo(row[COL_ACTIVE], true) !== (ben.is_active !== false)) {
      issues.push(`${who}: حالة التفعيل لا تعبر الملف`);
    }
    for (const f of STICKER_FLAG_COLUMNS) {
      if (parseYesNo(row[f.col], false) !== (ben[f.key] === true)) {
        issues.push(`${who}: الخيار «${f.col}» لا يعبر الملف`);
      }
    }
    if (parseYesNo(row[COL_CUSTOM_LD], false) !== (ben.custom_ld_meals === true)) {
      issues.push(`${who}: العلامة «${COL_CUSTOM_LD}» لا تعبر الملف`);
    }

    // ② المحظورات — نقارن المجموعات لا الترتيب
    const expExcl = new Set<string>();
    for (const e of exclusions) {
      const m = mealsById.get(e.meal_id);
      if (!m) {
        // صنف محظور غير موجود في قائمة الأصناف → لا يُكتب في الملف إطلاقاً.
        // تجاهله هنا كان يعني أن الفحص يقول «سليم» لبيانات تُفقد فعلاً.
        issues.push(`${who}: محظور مرتبط بصنف غير موجود في قائمة الأصناف — لو صدّرت الآن ما راح ينزل في الملف`);
        continue;
      }
      const alt = e.alternative_meal_id ? mealsById.get(e.alternative_meal_id) : null;
      if (e.alternative_meal_id && !alt) {
        issues.push(`${who}: بديل «${m.name}» مرتبط بصنف غير موجود — لو صدّرت الآن ما راح ينزل في الملف`);
      }
      expExcl.add(`${m.id}|${alt?.id ?? ''}`);
    }
    const gotExcl = new Set<string>();
    for (const c of EXCLUSION_COLUMNS) {
      for (const token of splitCellTokens(row[c.col] ?? '')) {
        const [name, altName] = token.split('؛').map(s => s.trim());
        const id = lookup(name, c.type, c.isSnack);
        if (!id) { issues.push(`${who}: المحظور «${name}» لا يُعرَف عند القراءة`); continue; }
        const altId = altName ? lookup(altName, c.type, c.isSnack) : undefined;
        if (altName && !altId) issues.push(`${who}: البديل «${altName}» لا يُعرَف عند القراءة`);
        gotExcl.add(`${id}|${altId ?? ''}`);
      }
    }
    for (const k of expExcl) {
      if (!gotExcl.has(k)) {
        const [id, altId] = k.split('|');
        issues.push(`${who}: المحظور «${mealsById.get(id)?.name ?? id}»${altId ? ` (بديله «${mealsById.get(altId)?.name ?? altId}»)` : ''} لو صدّرت الآن ما راح ينزل في الملف`);
      }
    }

    // ③ الأصناف الثابتة — مفتاح لكل (صنف|يوم|كمية|فئة|بديل|إلغاء)
    const fixedKey = (
      mealId: string, day: number, qty: number,
      cat: ItemCategory, isAlt: boolean, suppress: string[],
    ) => `${mealId}|${day}|${qty}|${cat}|${isAlt ? '1' : '0'}|${[...suppress].sort().join(',')}`;

    const expFixed = new Set<string>();
    for (const fm of fixed) {
      const m = mealsById.get(fm.meal_id);
      if (!m) {
        issues.push(`${who}: صنف ثابت مرتبط بصنف غير موجود في قائمة الأصناف — لو صدّرت الآن ما راح ينزل في الملف`);
        continue;
      }
      const sectionDefault: ItemCategory = m.is_snack ? 'snack' : 'hot';
      expFixed.add(fixedKey(
        fm.meal_id, fm.day_of_week, fm.quantity ?? 1,
        (fm.category ?? sectionDefault) as ItemCategory,
        fm.is_alternative === true,
        (fm.suppress_if_meal_ids ?? []).filter(id => {
          if (mealsById.has(id)) return true;
          issues.push(`${who}: قائمة إلغاء «${m.name}» فيها صنف غير موجود — لو صدّرت الآن ما راح ينزل في الملف`);
          return false;
        }),
      ));
    }

    const gotFixed = new Set<string>();
    for (const c of FIXED_COLUMNS) {
      const sectionDefault: ItemCategory = c.isSnack ? 'snack' : 'hot';
      for (const raw of splitCellTokens(row[c.col] ?? '')) {
        const token = parseFixedToken(raw, sectionDefault);
        if (!token) { issues.push(`${who}: الرمز «${raw}» غير مقروء`); continue; }
        const id = lookup(token.mealName, c.type, c.isSnack);
        if (!id) { issues.push(`${who}: الصنف الثابت «${token.mealName}» لا يُعرَف عند القراءة`); continue; }
        const suppressIds = token.suppressNames
          .map(n => [...mealsById.values()].filter(m => m.name.trim() === n.trim()).map(m => m.id))
          .flat();
        for (const dayTok of token.dayTokens) {
          const day = DAY_FROM_AR[dayTok];
          if (day === undefined) { issues.push(`${who}: اليوم «${dayTok}» غير معروف`); continue; }
          gotFixed.add(fixedKey(id, day, token.quantity, token.category, token.isAlternative, suppressIds));
        }
      }
    }
    for (const k of expFixed) {
      if (!gotFixed.has(k)) {
        const mealId = k.split('|')[0];
        issues.push(`${who}: الصنف الثابت «${mealsById.get(mealId)?.name ?? mealId}» لو صدّرت الآن ونزّلته ثم رفعته يرجع بقيم مختلفة`);
      }
    }

    // ④ الأنظمة الغذائية المسندة
    const gotDiets = new Set(splitCellTokens(row[COL_DIETS] ?? ''));
    for (const d of ben.diet_names ?? []) {
      if (!gotDiets.has(d.trim())) issues.push(`${who}: النظام الغذائي «${d}» لو صدّرت الآن ما راح ينزل في الملف`);
    }

    // ⑤ قرارات المنيو المخصّص — مفتاح لكل (خانة|إجراء|أساس|هدف|كمية|بديل)
    const ovKey = (o: { week_number: number; day_of_week: number; meal_type: string; action: string;
      base: string; target: string; quantity: number; isAlt: boolean }) =>
      `${o.week_number}|${o.day_of_week}|${o.meal_type}|${o.action}|${o.base}|${o.target}|${o.quantity}|${o.isAlt ? 1 : 0}`;
    const nameOf = (id?: string | null) => (id ? mealsById.get(id)?.name.trim() ?? '' : '');
    const gotOv = new Set<string>();
    for (const raw of splitCellTokens(row[COL_MENU_OVERRIDES] ?? '')) {
      const t = parseOverrideToken(raw);
      if (typeof t === 'string') { issues.push(`${who}: ${t}`); continue; }
      gotOv.add(ovKey({ ...t, base: t.baseName ?? '', target: t.targetName ?? '', isAlt: t.isAlternative }));
    }
    for (const ov of overrides) {
      const isRemove = ov.action === 'remove';
      const k = ovKey({
        ...ov,
        base: ov.action === 'add' ? '' : nameOf(ov.base_meal_id),
        target: isRemove ? '' : nameOf(ov.target_meal_id),
        quantity: isRemove ? 1 : ov.quantity ?? 1,
        isAlt: !isRemove && ov.is_alternative === true,
      });
      if (!gotOv.has(k)) {
        issues.push(`${who}: تعديل المنيو (أسبوع${ov.week_number} ${DAY_SHORT[ov.day_of_week]}) لو صدّرت الآن ونزّلته ثم رفعته يرجع بقيم مختلفة`);
      }
    }

    if (issues.length === before) matched++;
  }

  return { ok: issues.length === 0, matched, issues };
}
