import type { ItemCategory, Meal, MealType, EntityType } from '@/lib/types';
import { MEAL_TYPE_LABELS, CATEGORY_LABELS } from '@/lib/types';

/**
 * صيغة ملف الأصناف — مصدر واحد للتصدير والاستيراد والقالب، فلا تنحرف
 * رؤوس القالب عن رؤوس الملف المُصدَّر. دوال نقيّة لا تعرف قاعدة البيانات.
 */

export const MEAL_COL_NAME     = 'الاسم';
export const MEAL_COL_ENGLISH  = 'الاسم الإنجليزي';
export const MEAL_COL_TYPE     = 'نوع الوجبة';
export const MEAL_COL_SNACK    = 'سناك';
export const MEAL_COL_CATEGORY = 'الفئة';

export const MEAL_HEADERS = [MEAL_COL_NAME, MEAL_COL_ENGLISH, MEAL_COL_TYPE, MEAL_COL_SNACK, MEAL_COL_CATEGORY];
export const MEAL_REQUIRED_HEADERS = [MEAL_COL_NAME, MEAL_COL_TYPE];
export const MEAL_TEMPLATE_ROW = ['أرز بالدجاج', 'Rice with Chicken', 'غداء', 'لا', 'حار'];

const TYPE_FROM_TEXT: Record<string, MealType> = {
  ...Object.fromEntries((Object.entries(MEAL_TYPE_LABELS) as [MealType, string][]).map(([k, v]) => [v, k])),
  breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner',
};
const CATEGORY_FROM_TEXT: Record<string, ItemCategory> = {
  'حار': 'hot', 'بارد': 'cold', 'سناك': 'snack',
  hot: 'hot', cold: 'cold', snack: 'snack',
};
const YES = new Set(['نعم', 'yes', 'true', '1', 'y', '✓']);

const clean = (v: string | undefined | null) => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * الفئة الفعلية للصنف بنفس قاعدة الصفحة: السناك «سناك» دائماً، والرئيسي حار
 * أو بارد (الأصناف القديمة بلا category تُعدّ حاراً). بهذا يرجع الاستيراد
 * نفس القيمة ولا يقلب صنفاً رئيسياً بقيمة قديمة شاذة إلى سناك.
 */
export function mealCategoryOf(m: Pick<Meal, 'category' | 'is_snack'>): ItemCategory {
  if (m.is_snack) return 'snack';
  return m.category === 'cold' ? 'cold' : 'hot';
}

export function buildMealRow(m: Pick<Meal, 'name' | 'english_name' | 'type' | 'is_snack' | 'category'>): Record<string, string> {
  return {
    [MEAL_COL_NAME]:     m.name,
    [MEAL_COL_ENGLISH]:  m.english_name ?? '',
    [MEAL_COL_TYPE]:     MEAL_TYPE_LABELS[m.type] ?? m.type,
    [MEAL_COL_SNACK]:    m.is_snack ? 'نعم' : 'لا',
    [MEAL_COL_CATEGORY]: CATEGORY_LABELS[mealCategoryOf(m)],
  };
}

export interface MealPayload {
  name: string;
  /** غائب = عمود الاسم الإنجليزي غير موجود في الملف، فلا نمسح القيمة الحالية */
  english_name?: string | null;
  type: MealType;
  is_snack: boolean;
  category: ItemCategory;
  entity_type: EntityType;
}

/** يحوّل صف الملف إلى حِمل جاهز للحفظ، أو رسالة خطأ عربية واضحة. */
export function parseMealRow(
  row: Record<string, string>,
  entityType: EntityType,
  rowLabel: string,
): { payload: MealPayload | null; error: string | null } {
  const name = clean(row[MEAL_COL_NAME]);
  if (!name) return { payload: null, error: `${rowLabel}: الاسم مطلوب` };

  const typeRaw = clean(row[MEAL_COL_TYPE]);
  const type = TYPE_FROM_TEXT[typeRaw] ?? TYPE_FROM_TEXT[typeRaw.toLowerCase()];
  if (!type) {
    return { payload: null, error: `${rowLabel} (${name}): نوع الوجبة "${typeRaw}" غير صحيح — القيم المقبولة: فطور، غداء، عشاء` };
  }

  const isSnackRaw = YES.has(clean(row[MEAL_COL_SNACK]).toLowerCase());

  // الفئة: لو محددة في الملف نستخدمها، وإلا نستنتجها (سناك→snack، رئيسي→hot افتراضياً)
  const catRaw = clean(row[MEAL_COL_CATEGORY]);
  let category: ItemCategory = isSnackRaw ? 'snack' : 'hot';
  if (catRaw) {
    const parsed = CATEGORY_FROM_TEXT[catRaw] ?? CATEGORY_FROM_TEXT[catRaw.toLowerCase()];
    if (!parsed) {
      return { payload: null, error: `${rowLabel} (${name}): الفئة "${catRaw}" غير صحيحة — القيم المقبولة: حار، بارد، سناك` };
    }
    category = parsed;
  }
  // اتساق: سناك ↔ category=snack (نفس قاعدة نافذة الصنف)
  const is_snack = isSnackRaw || category === 'snack';
  const finalCategory: ItemCategory = is_snack ? 'snack' : category;

  const payload: MealPayload = { name, type, is_snack, category: finalCategory, entity_type: entityType };
  if (MEAL_COL_ENGLISH in row) payload.english_name = clean(row[MEAL_COL_ENGLISH]) || null;
  return { payload, error: null };
}

/** مفتاح التفرّد في الجدول: (entity_type, type, is_snack, name) */
export function mealKey(m: Pick<MealPayload, 'entity_type' | 'type' | 'is_snack' | 'name'>): string {
  return `${m.entity_type}|${m.type}|${m.is_snack ? 1 : 0}|${m.name}`;
}
