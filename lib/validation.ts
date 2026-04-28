import { z } from 'zod';
import type { PageKey, PermissionAction } from '@/lib/permissions';

const PAGE_KEYS: readonly PageKey[] = [
  'dashboard',
  'beneficiaries',
  'companions',
  'meals',
  'menu',
  'orders',
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
