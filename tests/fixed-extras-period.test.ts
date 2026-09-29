import { describe, expect, it } from 'vitest';
import { computeFixedExtras, datesInRange, weekdayOf, type FixedExtrasBen } from '@/lib/fixed-extras-period';
import type { Meal } from '@/lib/types';

const meal = (id: string, name: string): Meal => ({ id, name, type: 'main', is_snack: false } as unknown as Meal);
const meals = { dates: meal('dates', 'تمر'), soup: meal('soup', 'شوربة'), rice: meal('rice', 'رز'), milk: meal('milk', 'حليب') };

// 2026-09-26 سبت (6)، 2026-09-27 أحد (0)
const ben = (id: string, fixed: FixedExtrasBen['fixed_meals'], entity_type: 'beneficiary' | 'companion' = 'beneficiary'): FixedExtrasBen =>
  ({ id, name: id, code: id, entity_type, fixed_meals: fixed });

describe('datesInRange', () => {
  it('يشمل الطرفين', () => {
    expect(datesInRange('2026-09-29', '2026-10-02')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
  });
  it('يرجّع فاضي لو النهاية قبل البداية', () => {
    expect(datesInRange('2026-10-02', '2026-10-01')).toEqual([]);
  });
  it('يوم الأسبوع بترقيم JS (السبت = 6)', () => {
    expect(weekdayOf('2026-09-26')).toBe(6);
  });
});

describe('computeFixedExtras', () => {
  const base = { mealTypes: ['lunch' as const], orders: [], overrides: [], meals };

  it('يحصر غير البديل فقط، حسب يوم الأسبوع وبالكمية', () => {
    const r = computeFixedExtras({
      ...base, from: '2026-09-26', to: '2026-10-03', // سبتان
      beneficiaries: [ben('a', [
        { day_of_week: 6, meal_type: 'lunch', meal_id: 'dates', quantity: 2 },
        { day_of_week: 6, meal_type: 'lunch', meal_id: 'soup', quantity: 1, is_alternative: true },
        { day_of_week: 6, meal_type: 'dinner', meal_id: 'milk', quantity: 1 },
      ])],
    });
    expect(r.rows.map(x => [x.meal.id, x.total])).toEqual([['dates', 4]]);
    expect(r.grandTotal).toBe(4);
    expect(r.slotsFromRegistration).toBe(8);
  });

  it('يوم له أمر: يطبّق «لا يُصرف لو وُجد» وقرارات الخانة', () => {
    const r = computeFixedExtras({
      ...base, from: '2026-09-26', to: '2026-09-26',
      beneficiaries: [ben('a', [
        { day_of_week: 6, meal_type: 'lunch', meal_id: 'dates', quantity: 1, suppress_if_meal_ids: ['rice'] },
        { day_of_week: 6, meal_type: 'lunch', meal_id: 'milk', quantity: 1 },
      ])],
      orders: [{ date: '2026-09-26', meal_type: 'lunch', entity_type: 'beneficiary', week_number: 2, day_of_week: 6, meal_ids: ['rice'] }],
      overrides: [
        { beneficiary_id: 'a', week_number: 2, day_of_week: 6, meal_type: 'lunch', action: 'replace', base_meal_id: 'milk', target_meal_id: 'soup' },
        { beneficiary_id: 'a', week_number: 2, day_of_week: 6, meal_type: 'lunch', action: 'add', target_meal_id: 'rice', quantity: 3 },
      ],
    });
    expect(Object.fromEntries(r.rows.map(x => [x.meal.id, x.total]))).toEqual({ soup: 1, rice: 3 });
    expect(r.slotsFromOrders).toBe(1);
  });

  it('يفلتر حسب الفئة', () => {
    const r = computeFixedExtras({
      ...base, from: '2026-09-26', to: '2026-09-26', entityType: 'companion',
      beneficiaries: [
        ben('a', [{ day_of_week: 6, meal_type: 'lunch', meal_id: 'dates', quantity: 1 }]),
        ben('c', [{ day_of_week: 6, meal_type: 'lunch', meal_id: 'milk', quantity: 1 }], 'companion'),
      ],
    });
    expect(r.rows.map(x => x.meal.id)).toEqual(['milk']);
  });

  it('يحسب السعر: الكمية × سعر الحبة، والصنف بلا سعر لا يدخل المجموع', () => {
    const r = computeFixedExtras({
      ...base, from: '2026-09-26', to: '2026-10-03', // سبتان
      beneficiaries: [
        ben('a', [
          { day_of_week: 6, meal_type: 'lunch', meal_id: 'dates', quantity: 3 },
          { day_of_week: 6, meal_type: 'lunch', meal_id: 'milk', quantity: 1 },
        ]),
        ben('b', [{ day_of_week: 6, meal_type: 'lunch', meal_id: 'dates', quantity: 1 }]),
      ],
      prices: { dates: 1.1 },
    });
    const dates = r.rows.find(x => x.meal.id === 'dates')!;
    expect(dates.total).toBe(8);
    expect(dates.unitPrice).toBe(1.1);
    expect(dates.totalPrice).toBe(8.8);
    const milk = r.rows.find(x => x.meal.id === 'milk')!;
    expect(milk.unitPrice).toBeNull();
    expect(milk.totalPrice).toBe(0);
    expect(r.grandTotalPrice).toBe(8.8);
    expect(r.unpricedCount).toBe(1);
    expect(r.byBeneficiary.find(b => b.id === 'a')!.totalPrice).toBe(6.6);
  });

  it('الإضافات اليدوية تُجمع مع المحسوب وتدخل السعر، ولا تُنسب لمستفيد', () => {
    const r = computeFixedExtras({
      ...base, mealTypes: ['lunch', 'dinner'], from: '2026-09-26', to: '2026-09-26',
      beneficiaries: [ben('a', [{ day_of_week: 6, meal_type: 'lunch', meal_id: 'dates', quantity: 2 }])],
      prices: { dates: 2, soup: 5 },
      manual: [
        { meal_id: 'dates', meal_type: 'lunch', quantity: 10 },  // يُجمع مع صنف موجود
        { meal_id: 'soup', meal_type: 'dinner', quantity: 3 },   // صنف جديد كلياً
        { meal_id: 'milk', meal_type: 'breakfast', quantity: 4 }, // وجبة غير مختارة → لا يُحسب
      ],
    });
    const dates = r.rows.find(x => x.meal.id === 'dates')!;
    expect(dates.total).toBe(12);
    expect(dates.manual).toBe(10);
    expect(dates.beneficiaries).toBe(1);
    expect(dates.totalPrice).toBe(24);
    const soup = r.rows.find(x => x.meal.id === 'soup')!;
    expect(soup.byMealType.dinner).toBe(3);
    expect(soup.beneficiaries).toBe(0);
    expect(r.rows.some(x => x.meal.id === 'milk')).toBe(false);
    expect(r.grandTotal).toBe(15);
    expect(r.grandTotalPrice).toBe(39);
    expect(r.byBeneficiary.map(b => [b.id, b.total])).toEqual([['a', 2]]);
  });
});
