import { describe, expect, it } from 'vitest';
import type { DailyOrder, OrderItem } from '@/lib/types';
import { buildOrdersSheetRows, orderItemFinalCount, orderWeekday, type EntityCounts } from '@/components/orders/order-list-export';

const item = (meal_id: string, name: string, extra: Partial<OrderItem> = {}): OrderItem =>
  ({ id: `i_${meal_id}`, order_id: 'o', meal_id, meals: { id: meal_id, name, is_snack: false }, ...extra } as OrderItem);

const counts: EntityCounts = {
  total: 10,
  exclusions: { fish: 2 },
  altCounts: { chicken: { fish: 2 } }, // اثنان يأخذان دجاج بدل السمك
};
const empty: EntityCounts = { total: 0, exclusions: {}, altCounts: {} };

describe('orderItemFinalCount', () => {
  it('الحساب الحيّ: (العدد − المحظورين) × المضاعف + الإضافي + البدائل × مضاعف المحظور', () => {
    const order = {
      id: 'o', date: '2026-10-01', meal_type: 'lunch', created_at: '',
      order_items: [item('fish', 'سمك', { multiplier: 2 }), item('chicken', 'دجاج', { extra_quantity: 3 })],
    } as DailyOrder;
    expect(orderItemFinalCount(order, order.order_items![0], counts)).toEqual({ count: 16, frozen: false });
    // دجاج: 10 × 1 + 3 + (2 بدائل × مضاعف السمك 2)
    expect(orderItemFinalCount(order, order.order_items![1], counts)).toEqual({ count: 17, frozen: false });
  });

  it('رقم اللقطة المحفوظة يغلب', () => {
    const order = { id: 'o', date: '2026-10-01', meal_type: 'lunch', created_at: '', order_items: [item('fish', 'سمك')], itemFinalCounts: { fish: 42 } };
    expect(orderItemFinalCount(order as DailyOrder, order.order_items[0], counts)).toEqual({ count: 42, frozen: true });
  });
});

describe('buildOrdersSheetRows', () => {
  it('صف لكل صنف بعناوين عربية — الاسم في الأمر والتصنيف والمضاعف والفئة والأسبوع', () => {
    const rows = buildOrdersSheetRows([{
      id: 'o', date: '2026-10-01', meal_type: 'dinner', week_number: 2, entity_type: 'companion', created_at: '',
      order_items: [item('rice', 'رز', { display_name: 'رز بخاري', category: 'hot', multiplier: 2, extra_quantity: 1 })],
      itemFinalCounts: { rice: 9 },
    } as DailyOrder], { beneficiary: empty, companion: empty });
    expect(rows).toEqual([{
      'التاريخ': '2026-10-01', 'اليوم': 'الخميس', 'الأسبوع': 2, 'الفئة': 'المرافقون', 'الوجبة': 'عشاء',
      'الصنف': 'رز بخاري', 'الاسم الأصلي': 'رز', 'التصنيف': 'حار', 'المضاعف': 2, 'الكمية الإضافية': 1,
      'العدد النهائي': 9, 'مصدر العدد': 'محفوظ مع الأمر',
    }]);
  });

  it('أمر بلا أصناف يبقى في الملف', () => {
    const rows = buildOrdersSheetRows([{ id: 'o', date: '2026-10-03', meal_type: 'breakfast', created_at: '', order_items: [] } as DailyOrder],
      { beneficiary: empty, companion: empty });
    expect(rows).toHaveLength(1);
    expect(rows[0]['الفئة']).toBe('المستفيدون');
    expect(rows[0]['اليوم']).toBe('السبت');
  });

  it('يوم الأسبوع لا يتأثر بالمنطقة الزمنية', () => {
    expect(orderWeekday('2026-10-01')).toBe(4);
  });
});
