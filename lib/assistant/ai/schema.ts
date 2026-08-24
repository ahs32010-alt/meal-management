/**
 * التحقّق من مخرجات النموذج قبل تنفيذ أي أداة.
 *
 * النموذج — أياً كان مزوّده — يرجّع كائن معاملات حرّاً. قبل هذه الطبقة كان
 * يُقرأ بقسر يدوي متساهل (`str()`)، فأي حقل غريب يُتجاهَل بصمت وأي حقل ناقص
 * يظهر أثره متأخّراً داخل الاستعلام. هنا نفحصه مرة واحدة، بمخطط صريح لكل أداة.
 *
 * ── قاعدة الفشل ────────────────────────────────────────────────────────────
 * فشل التحقّق **ليس استثناءً** — يرجع للنموذج كنتيجة أداة فيها سبب الرفض،
 * فيصحّح نفسه في الدورة التالية. النموذج يخطئ في شكل المعاملات أحياناً؛ وهذا
 * ليس سبباً لإسقاط طلب المستخدم.
 *
 * ── متساهل حيث لا ضرر، صارم حيث يهمّ ──────────────────────────────────────
 * النماذج ترسل «15» بدل 15 و«true» بدل true. نقبل ذلك ونحوّله. لكن المعرّفات
 * والقوائم المغلقة (نوع الوجبة، نوع الكيان) صارمة: قيمة خاطئة هناك تعني
 * استعلاماً على بيانات غير التي قصدها المستخدم.
 */

import { z } from 'zod';

/** أقصى طول لنص الأمر المقترح — نفس سقف المسار الحتمي في /api/assistant. */
export const MAX_COMMAND_LENGTH = 300;

/** حدّ صفوف أي أداة — سقف تكلفة قبل أن يكون سقف أداء. */
export const MAX_ROWS = 40;

/**
 * نص اختياري: الفراغ يعني «غير محدّد» لا «ابحث عن سلسلة فارغة».
 * هذا يطابق سلوك `str()` السابق حرفياً فما ينكسر شيء كان يعمل.
 */
const optionalText = z
  .string()
  .transform((v) => v.trim())
  .refine((v) => v.length <= 200, { message: 'النص طويل جداً' })
  .transform((v) => (v.length ? v : undefined))
  .optional();

/** منطقي متسامح: النماذج ترسل "true"/"false" نصّاً أحياناً. */
const flexibleBoolean = z
  .union([z.boolean(), z.literal('true'), z.literal('false')])
  .transform((v) => v === true || v === 'true')
  .optional();

/** عدد صفوف: يقبل النص الرقمي، ويُقصّ داخل [1, MAX_ROWS]. */
const rowLimit = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === 'number' ? v : Number(v)))
  .refine((v) => Number.isFinite(v), { message: 'الحد يجب أن يكون رقماً' })
  .transform((v) => Math.min(Math.max(Math.floor(v), 1), MAX_ROWS))
  .optional();

/** عدد صحيح ضمن مدى مغلق. */
const intInRange = (min: number, max: number, label: string) =>
  z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === 'number' ? v : Number(v)))
    .refine((v) => Number.isInteger(v) && v >= min && v <= max, {
      message: `${label} يجب أن يكون عدداً بين ${min} و${max}`,
    })
    .optional();

const mealType = z.enum(['breakfast', 'lunch', 'dinner']).optional();
const entityType = z.enum(['beneficiary', 'companion']).optional();

/** تاريخ ISO فقط — أي شكل آخر يعني استعلاماً على يوم غير مقصود. */
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ يجب أن يكون بصيغة YYYY-MM-DD')
  .optional();

/** معرّف مطلوب — نتحقّق أنه UUID لأن كل معرّفاتنا كذلك. */
const requiredId = z
  .string()
  .trim()
  .uuid('المعرّف يجب أن يكون UUID كما رجّعته أداة البحث');

// ── مخطط لكل أداة ──────────────────────────────────────────────────────────

export const TOOL_SCHEMAS = {
  search_people: z.object({
    query: optionalText,
    entity_type: entityType,
    active_only: flexibleBoolean,
    limit: rowLimit,
  }),

  get_person: z.object({ id: requiredId }),

  search_meals: z.object({
    query: optionalText,
    type: mealType,
    limit: rowLimit,
  }),

  get_menu: z.object({
    week_number: intInRange(1, 4, 'رقم الأسبوع'),
    day_of_week: intInRange(0, 6, 'اليوم'),
    meal_type: mealType,
  }),

  list_orders: z.object({
    meal_type: mealType,
    from_date: isoDate,
    to_date: isoDate,
    limit: rowLimit,
  }),

  get_order: z.object({ id: requiredId }),

  count_people: z.object({
    entity_type: entityType,
    active_only: flexibleBoolean,
    group_by: z.enum(['villa', 'diet_type', 'category']).optional(),
  }),

  list_fixed_meals: z.object({
    person: optionalText,
    meal: optionalText,
    day_of_week: intInRange(0, 6, 'اليوم'),
    meal_type: mealType,
    entity_type: entityType,
    limit: rowLimit,
  }),

  order_summary: z.object({
    date: isoDate,
    meal_type: mealType,
    entity_type: entityType,
  }),

  list_pages: z.object({}),

  propose_change: z.object({
    command: z
      .string()
      .trim()
      .min(1, 'نص الأمر مفقود')
      .max(MAX_COMMAND_LENGTH, `نص الأمر طويل جداً (الحد ${MAX_COMMAND_LENGTH} حرف)`),
  }),

  open_page: z.object({
    href: z.string().trim().min(1, 'المسار مفقود'),
  }),
} as const;

export type ToolName = keyof typeof TOOL_SCHEMAS;

export function isToolName(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(TOOL_SCHEMAS, name);
}

export type ValidationResult =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * يفحص معاملات نداء أداة. لا يرمي أبداً — الفشل رسالة عربية تُعاد للنموذج.
 *
 * @example
 * const check = validateToolInput('get_person', { id: 'not-a-uuid' });
 * // { ok: false, error: 'id: المعرّف يجب أن يكون UUID...' }
 */
export function validateToolInput(name: string, raw: unknown): ValidationResult {
  if (!isToolName(name)) {
    return { ok: false, error: `أداة غير معروفة: ${name}` };
  }

  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const parsed = TOOL_SCHEMAS[name].safeParse(input);

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => {
        const path = issue.path.join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .join('؛ ');
    return { ok: false, error: `معاملات غير صالحة لأداة ${name} — ${detail}` };
  }

  // نحذف المفاتيح غير المحدّدة حتى تبقى فحوص `'x' in args` صادقة في الأدوات.
  const args: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed.data as Record<string, unknown>)) {
    if (value !== undefined) args[key] = value;
  }
  return { ok: true, args };
}
