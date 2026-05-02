import { z } from 'zod';
import type { PageKey, PermissionAction } from '@/lib/permissions';

const PAGE_KEYS: readonly PageKey[] = [
  'dashboard',
  'beneficiaries',
  'companions',
  'meals',
  'menu',
  'orders',
  'delivery_orders',
  'reports',
  'stickers',
  'settings',
] as const;

const ACTIONS: readonly PermissionAction[] = ['view', 'add', 'edit', 'delete'] as const;

const pagePermissionSchema = z.object({
  view: z.boolean(),
  add: z.boolean(),
  edit: z.boolean(),
  delete: z.boolean(),
});

export const permissionsMapSchema = z
  .record(z.enum(PAGE_KEYS as unknown as [PageKey, ...PageKey[]]), pagePermissionSchema)
  .refine(
    (val) => Object.values(val).every((p) => Object.keys(p).every((k) => (ACTIONS as readonly string[]).includes(k))),
    { message: 'Invalid permission action key' }
  );

// خريطة "يحتاج موافقة" — view ما تدخل هنا (قراءة فقط)
const approvalActionSchema = z.object({
  add: z.boolean().optional(),
  edit: z.boolean().optional(),
  delete: z.boolean().optional(),
});
export const approvalRequiredMapSchema = z
  .record(z.enum(PAGE_KEYS as unknown as [PageKey, ...PageKey[]]), approvalActionSchema);

const trimmedString = (min: number, max: number) =>
  z.string().trim().min(min).max(max);

export const createUserSchema = z.object({
  email: z.string().trim().email('بريد إلكتروني غير صالح').max(254),
  password: z.string().min(6, 'كلمة السر يجب أن تكون 6 أحرف على الأقل').max(72),
  full_name: trimmedString(1, 120).optional().nullable(),
  is_admin: z.boolean().optional().default(false),
  permissions: permissionsMapSchema.optional().default({}),
  approval_required: approvalRequiredMapSchema.optional().default({}),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  email: z.string().trim().email().max(254).optional(),
  password: z.string().min(6).max(72).optional(),
  full_name: trimmedString(1, 120).optional().nullable(),
  is_admin: z.boolean().optional(),
  permissions: permissionsMapSchema.optional(),
  approval_required: approvalRequiredMapSchema.optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const uuidSchema = z.string().uuid('معرّف غير صالح');

const mealTypeSchema = z.enum(['breakfast', 'lunch', 'dinner']);

const orderItemInputSchema = z.object({
  meal_id: uuidSchema,
  display_name: trimmedString(1, 200).nullable().optional(),
  // extra_quantity is an offset that can be negative (reduces auto-calculated total)
  extra_quantity: z.number().int().min(-1_000_000).max(1_000_000).default(0),
});

export const replaceOrderSchema = z.object({
  order_id: uuidSchema.optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صالح'),
  meal_type: mealTypeSchema,
  week_of_month: z
    .number()
    .int()
    .min(1)
    .max(4)
    .nullable()
    .optional(),
  items: z.array(orderItemInputSchema).min(1, 'يرجى اختيار صنف واحد على الأقل').max(200),
});
export type ReplaceOrderInput = z.infer<typeof replaceOrderSchema>;

export interface ParseResult<T> {
  ok: true;
  data: T;
}
export interface ParseError {
  ok: false;
  error: string;
  status: 400;
}

export function parseJson<T>(schema: z.ZodType<T>, body: unknown): ParseResult<T> | ParseError {
  const result = schema.safeParse(body);
  if (result.success) return { ok: true, data: result.data };
  const first = result.error.issues[0];
  const path = first.path.length ? first.path.join('.') + ': ' : '';
  return { ok: false, error: `${path}${first.message}`, status: 400 };
}

// ── أوامر التسليم ────────────────────────────────────────────────────────────

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صالح');
const timeStringSchema = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'وقت غير صالح');

export const citySchema = z.object({
  name: trimmedString(1, 120),
});
export type CityInput = z.infer<typeof citySchema>;

export const deliveryLocationSchema = z.object({
  name: trimmedString(1, 200),
  city_id: uuidSchema.nullable().optional(),
});
export type DeliveryLocationInput = z.infer<typeof deliveryLocationSchema>;

export const deliveryCreatorSchema = z.object({
  name: trimmedString(1, 200),
  phone: trimmedString(1, 40).nullable().optional(),
});
export type DeliveryCreatorInput = z.infer<typeof deliveryCreatorSchema>;

export const deliveryMealSchema = z.object({
  name: trimmedString(1, 200),
  meal_type: mealTypeSchema,
  is_snack: z.boolean().default(false),
});
export type DeliveryMealInput = z.infer<typeof deliveryMealSchema>;

const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional();

export const deliveryPrintHeaderSchema = z.object({
  company_name_en: optionalText(200),
  company_name_ar: optionalText(200),
  address_line1:   optionalText(300),
  address_line2:   optionalText(300),
  cr_number:       optionalText(60),
  vat_number:      optionalText(60),
  logo_url:        optionalText(2048),
  title_ar:        optionalText(120),
  title_en:        optionalText(120),
});
export type DeliveryPrintHeaderInput = z.infer<typeof deliveryPrintHeaderSchema>;

const deliveryMealTypeSchema = z.enum(['breakfast', 'lunch', 'dinner', 'all']);

const deliveryOrderItemSchema = z.object({
  display_name: trimmedString(1, 300),
  meal_type: deliveryMealTypeSchema,
  quantity: z.number().int().min(0).max(1_000_000),
  receiver_signature_url: z.string().trim().max(2048).nullable().optional(),
});

export const deliveryOrderSchema = z.object({
  source_order_id: uuidSchema.nullable().optional(),
  date: dateStringSchema,
  meal_type: deliveryMealTypeSchema,
  delivery_location_id: uuidSchema.nullable().optional(),
  creator_id: uuidSchema.nullable().optional(),
  created_by_name: trimmedString(1, 200).nullable().optional(),
  created_by_phone: trimmedString(1, 40).nullable().optional(),
  delivery_date: dateStringSchema.nullable().optional(),
  delivery_time: timeStringSchema.nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  creator_signature_url: z.string().trim().max(2048).nullable().optional(),
  receiver_signature_url: z.string().trim().max(2048).nullable().optional(),
  items: z.array(deliveryOrderItemSchema).min(1, 'يرجى إضافة صنف واحد على الأقل').max(500),
});
export type DeliveryOrderInput = z.infer<typeof deliveryOrderSchema>;
