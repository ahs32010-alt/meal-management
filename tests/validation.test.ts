import { describe, expect, it } from 'vitest';
import {
  createUserSchema,
  updateUserSchema,
  replaceOrderSchema,
  uuidSchema,
  parseJson,
} from '@/lib/validation';

describe('createUserSchema', () => {
  it('accepts a valid payload', () => {
    const r = createUserSchema.safeParse({
      email: 'test@example.com',
      password: 'secret123',
      full_name: 'Ahmad',
      is_admin: true,
      permissions: {},
    });
    expect(r.success).toBe(true);
  });

  it('rejects short password', () => {
    const r = createUserSchema.safeParse({ email: 'a@b.com', password: '123' });
    expect(r.success).toBe(false);
  });

  it('rejects invalid email', () => {
    const r = createUserSchema.safeParse({ email: 'not-an-email', password: '123456' });
    expect(r.success).toBe(false);
  });

  it('defaults is_admin and permissions', () => {
    const r = createUserSchema.parse({ email: 'a@b.com', password: '123456' });
    expect(r.is_admin).toBe(false);
    expect(r.permissions).toEqual({});
  });

  it('caps password at 72 chars', () => {
    const r = createUserSchema.safeParse({
      email: 'a@b.com',
      password: 'x'.repeat(100),
    });
    expect(r.success).toBe(false);
  });
});

describe('updateUserSchema', () => {
  it('accepts partial updates', () => {
    expect(updateUserSchema.safeParse({}).success).toBe(true);
    expect(updateUserSchema.safeParse({ full_name: 'New' }).success).toBe(true);
  });

  it('still validates email format when present', () => {
    expect(updateUserSchema.safeParse({ email: 'bad' }).success).toBe(false);
  });
});

describe('replaceOrderSchema', () => {
  const validItem = {
    meal_id: '11111111-1111-1111-1111-111111111111',
    extra_quantity: 0,
  };

  it('accepts a valid payload', () => {
    const r = replaceOrderSchema.safeParse({
      date: '2026-04-25',
      meal_type: 'lunch',
      items: [validItem],
    });
    expect(r.success).toBe(true);
  });

  it('rejects invalid date', () => {
    const r = replaceOrderSchema.safeParse({
      date: '25-04-2026',
      meal_type: 'lunch',
      items: [validItem],
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty items', () => {
    const r = replaceOrderSchema.safeParse({
      date: '2026-04-25',
      meal_type: 'lunch',
      items: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown meal_type', () => {
    const r = replaceOrderSchema.safeParse({
      date: '2026-04-25',
      meal_type: 'snack',
      items: [validItem],
    });
    expect(r.success).toBe(false);
  });

  it('rejects out-of-range week_of_month', () => {
    const r = replaceOrderSchema.safeParse({
      date: '2026-04-25',
      meal_type: 'lunch',
      week_of_month: 5,
      items: [validItem],
    });
    expect(r.success).toBe(false);
  });

  it('allows negative extra_quantity (offset reduces auto-calculated total)', () => {
    const r = replaceOrderSchema.safeParse({
      date: '2026-04-25',
      meal_type: 'lunch',
      items: [{ meal_id: validItem.meal_id, extra_quantity: -5 }],
    });
    expect(r.success).toBe(true);
  });

  it('rejects extra_quantity below -1_000_000', () => {
    const r = replaceOrderSchema.safeParse({
      date: '2026-04-25',
      meal_type: 'lunch',
      items: [{ meal_id: validItem.meal_id, extra_quantity: -10_000_000 }],
    });
    expect(r.success).toBe(false);
  });
});

describe('uuidSchema', () => {
  it('accepts valid uuid', () => {
    expect(uuidSchema.safeParse('11111111-1111-1111-1111-111111111111').success).toBe(true);
  });
  it('rejects garbage', () => {
    expect(uuidSchema.safeParse('xyz').success).toBe(false);
  });
});

describe('parseJson', () => {
  it('returns ok=true with data on success', () => {
    const r = parseJson(uuidSchema, '11111111-1111-1111-1111-111111111111');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toBe('11111111-1111-1111-1111-111111111111');
  });
  it('returns ok=false with error on failure', () => {
    const r = parseJson(uuidSchema, 'nope');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });
});
