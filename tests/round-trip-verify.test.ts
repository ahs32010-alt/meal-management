import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { ItemCategory, Meal, MealType, MenuItem } from '@/lib/types';
import { verifyMenuRoundTrip } from '@/components/menu/menu-xlsx';
import {
  verifyBeneficiaryRoundTrip,
  type SheetFixedMeal,
  type SheetMeal,
} from '@/lib/beneficiary-sheet';
import { BACKUP_TABLES } from '@/lib/backup-snapshot';

/**
 * زر «تحقّق من الملف» هو شبكة الأمان: يصدّر ويستورد في الذاكرة ويقارن.
 * هذه الاختبارات تتأكد أنه يقول «سليم» للحالة السليمة ويكشف الانحراف فعلاً.
 */

let seq = 0;
const meal = (name: string, category: ItemCategory, type: MealType = 'lunch'): Meal =>
  ({ id: `meal-${++seq}`, name, type, is_snack: category === 'snack', category, created_at: '' });

const item = (m: Meal, position: number, multiplier = 1, extra = 0): MenuItem => ({
  id: `item-${++seq}`,
  week_number: 1,
  day_of_week: 6,
  meal_type: m.type,
  meal_id: m.id,
  category: m.category!,
  position,
  multiplier,
  extra_quantity: extra,
  created_at: '',
  meals: m,
});

describe('verifyMenuRoundTrip', () => {
  it('يقول سليم لمنيو عادي', () => {
    const hot = meal('رز بخاري', 'hot');
    const cold = meal('سلطة', 'cold');
    const snack = meal('تمر', 'snack');
    const items = [item(hot, 0, 2), item(cold, 1), item(snack, 100, 1, 40)];
    const res = verifyMenuRoundTrip(XLSX, items, [hot, cold, snack]);
    expect(res.issues).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.matched).toBe(3);
  });

  it('يكشف صنفاً غير موجود في قاعدة الأصناف', () => {
    const known = meal('رز', 'hot');
    const ghost = meal('صنف محذوف', 'hot');
    const res = verifyMenuRoundTrip(XLSX, [item(known, 0), item(ghost, 1)], [known]);
    expect(res.ok).toBe(false);
    expect(res.issues.join(' ')).toContain('صنف محذوف');
  });

  it('يقول سليم لخانة ممتلئة بالكامل (٨ أساسي + ٤ سناك)', () => {
    const mains = Array.from({ length: 8 }, (_, i) => meal(`أساسي ${i + 1}`, i < 5 ? 'hot' : 'cold'));
    const snacks = Array.from({ length: 4 }, (_, i) => meal(`سناك ${i + 1}`, 'snack'));
    const items = [
      ...mains.map((m, i) => item(m, i)),
      ...snacks.map((m, i) => item(m, 100 + i)),
    ];
    const res = verifyMenuRoundTrip(XLSX, items, [...mains, ...snacks]);
    expect(res.issues).toEqual([]);
    expect(res.matched).toBe(12);
  });

  it('يقول سليم حتى لأرقام ترتيب متضاربة (يقارن بالحالة المطبَّعة)', () => {
    const a = meal('أ', 'hot');
    const b = meal('ب', 'hot');
    const res = verifyMenuRoundTrip(XLSX, [item(a, 5), item(b, 5)], [a, b]);
    expect(res.ok).toBe(true);
  });
});

describe('verifyBeneficiaryRoundTrip', () => {
  const sm = (id: string, name: string, type: MealType, is_snack = false): SheetMeal =>
    ({ id, name, type, is_snack });
  const MEALS = [
    sm('m1', 'فول', 'breakfast'),
    sm('m2', 'بيض', 'breakfast'),
    sm('m3', 'سلطة', 'lunch'),
    sm('m4', 'رز', 'lunch'),
    sm('m5', 'تمر', 'lunch', true),
  ];
  const mealsById = new Map(MEALS.map(m => [m.id, m] as const));

  const BEN = { name: 'أحمد', code: 'B001', english_name: 'Ahmad', category: 'عائلة', villa: '1', diet_type: 'عادي' };

  it('يقول سليم لكل الحقول معاً', () => {
    const fixed: SheetFixedMeal[] = [
      { meal_id: 'm3', day_of_week: 6, meal_type: 'lunch', quantity: 2, category: 'cold', is_alternative: true, suppress_if_meal_ids: ['m4'] },
      { meal_id: 'm5', day_of_week: 0, meal_type: 'lunch', quantity: 1, category: 'snack' },
    ];
    const res = verifyBeneficiaryRoundTrip([{
      ben: { ...BEN, is_active: false, no_fish: true },
      exclusions: [{ meal_id: 'm1', alternative_meal_id: 'm2' }],
      fixed,
    }], mealsById);
    expect(res.issues).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.matched).toBe(1);
  });

  it('يعدّ كل مستفيد سليم على حِدة', () => {
    const res = verifyBeneficiaryRoundTrip([
      { ben: BEN, exclusions: [], fixed: [] },
      { ben: { ...BEN, code: 'B002', name: 'سارة' }, exclusions: [{ meal_id: 'm1' }], fixed: [] },
    ], mealsById);
    expect(res.matched).toBe(2);
    expect(res.ok).toBe(true);
  });

  it('يكشف محظوراً يشير لصنف غير موجود في قائمة الأصناف', () => {
    const res = verifyBeneficiaryRoundTrip(
      [{ ben: BEN, exclusions: [{ meal_id: 'm1' }], fixed: [] }],
      new Map(), // قائمة أصناف فارغة
    );
    // بلا أصناف لا يُكتب المحظور في الملف — لازم يظهر كانحراف
    expect(res.ok).toBe(false);
  });

  it('علامة «صنف بديل» تعبر الدورة ولا تُفقد', () => {
    const res = verifyBeneficiaryRoundTrip([{
      ben: BEN,
      exclusions: [],
      fixed: [{ meal_id: 'm4', day_of_week: 3, meal_type: 'lunch', quantity: 1, category: 'hot', is_alternative: true }],
    }], mealsById);
    expect(res.issues).toEqual([]);
  });
});

describe('تغطية النسخة الاحتياطية', () => {
  it('تشمل كل جداول البيانات — لا جدول منسي', () => {
    // الجداول المتوقّعة: كل ما ينتج عن استخدام الصفحات. أي جدول جديد يُضاف
    // للنظام لازم يُضاف هنا وفي BACKUP_TABLES معاً، وإلا يسقط من الاستعادة.
    const expected = [
      'meals', 'beneficiaries', 'daily_orders', 'custom_transliterations',
      'lunch_dinner_diet_colors', 'cost_units', 'cities', 'delivery_meals',
      'delivery_creators', 'delivery_print_header',
      'meal_alternatives', 'exclusions', 'beneficiary_fixed_meals', 'menu_items',
      'order_items', 'sticker_splits',
      'raw_materials', 'meal_recipe_items', 'meal_pricing', 'order_cost_snapshots',
      'delivery_locations', 'delivery_orders', 'delivery_order_items',
    ];
    expect([...BACKUP_TABLES].sort()).toEqual([...expected].sort());
  });

  it('كل جدول يظهر مرة واحدة', () => {
    expect(new Set(BACKUP_TABLES).size).toBe(BACKUP_TABLES.length);
  });

  it('الجدول المرجعي يسبق التابع له (ترتيب الإدراج آمن)', () => {
    const order = (t: string) => BACKUP_TABLES.indexOf(t as never);
    const deps: Array<[string, string]> = [
      ['exclusions', 'beneficiaries'],
      ['exclusions', 'meals'],
      ['beneficiary_fixed_meals', 'beneficiaries'],
      ['menu_items', 'meals'],
      ['order_items', 'daily_orders'],
      ['sticker_splits', 'daily_orders'],
      ['meal_alternatives', 'meals'],
      ['raw_materials', 'cost_units'],
      ['meal_recipe_items', 'raw_materials'],
      ['meal_pricing', 'meals'],
      ['order_cost_snapshots', 'daily_orders'],
      ['delivery_locations', 'cities'],
      ['delivery_orders', 'delivery_locations'],
      ['delivery_order_items', 'delivery_orders'],
    ];
    for (const [child, parent] of deps) {
      expect(order(parent), `${parent} لازم يسبق ${child}`).toBeLessThan(order(child));
    }
  });
});

describe('عقد «قراءة فقط» لزر التحقق', () => {
  it('verifyBeneficiaryRoundTrip لا يعدّل مدخلاته إطلاقاً', () => {
    const sm2 = (id: string, name: string): SheetMeal => ({ id, name, type: 'lunch', is_snack: false });
    const meals = new Map([['m1', sm2('m1', 'رز')]]);
    const exclusions = [{ meal_id: 'm1', alternative_meal_id: null }];
    const fixed: SheetFixedMeal[] = [
      { meal_id: 'm1', day_of_week: 6, meal_type: 'lunch', quantity: 2, category: 'hot', is_alternative: true, suppress_if_meal_ids: [] },
    ];
    const ben = { name: 'أحمد', code: 'B001', is_active: false, no_fish: true };

    const snapshot = JSON.stringify({ ben, exclusions, fixed, meals: [...meals.entries()] });
    verifyBeneficiaryRoundTrip([{ ben, exclusions, fixed }], meals);
    // نفس البيانات حرفياً بعد الفحص — لا حذف ولا تعديل ولا ترتيب مختلف
    expect(JSON.stringify({ ben, exclusions, fixed, meals: [...meals.entries()] })).toBe(snapshot);
  });

  it('verifyMenuRoundTrip لا يعدّل قائمة الأصناف ولا المنيو', () => {
    const m = meal('رز', 'hot');
    const items = [item(m, 3, 2, 15)];
    const snapshot = JSON.stringify({ items, meals: [m] });
    verifyMenuRoundTrip(XLSX, items, [m]);
    expect(JSON.stringify({ items, meals: [m] })).toBe(snapshot);
  });

  it('رسائل الفحص كلها بصيغة الشرط — ما توحي بحذف وقع', () => {
    // مستفيد فيه محظور لصنف مفقود: الرسالة لازم تتكلم عن «الملف» لا عن البيانات
    const res = verifyBeneficiaryRoundTrip(
      [{ ben: { name: 'أحمد', code: 'B001' }, exclusions: [{ meal_id: 'ghost' }], fixed: [] }],
      new Map(),
    );
    expect(res.ok).toBe(false);
    for (const msg of res.issues) {
      expect(msg).toContain('الملف');
      expect(msg).not.toContain('يختفي من الملف'); // الصياغة القديمة المُلبِسة
      expect(msg).not.toMatch(/حُذف|مُسح/);
    }
  });
});
