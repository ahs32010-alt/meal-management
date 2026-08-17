import { describe, expect, it } from 'vitest';
import type { ItemCategory, Meal, MealType, MenuItem } from '@/lib/types';
import {
  MAIN_ROWS_PER_MEAL,
  SNACK_ROWS_PER_MEAL,
  buildSlotMap,
  effectiveCategory,
  mainPosition,
  normalizeSlot,
  positionRowIndex,
  isSnackPosition,
  snackPosition,
  splitSlot,
} from '@/lib/menu-utils';

function meal(id: string, name: string, category: ItemCategory, type: MealType = 'lunch'): Meal {
  return { id, name, type, is_snack: category === 'snack', category, created_at: '' };
}

function item(id: string, m: Meal, position: number, category: ItemCategory = m.category!): MenuItem {
  return {
    id,
    week_number: 1,
    day_of_week: 6,
    meal_type: m.type,
    meal_id: m.id,
    category,
    position,
    multiplier: 1,
    extra_quantity: 0,
    created_at: '',
    meals: m,
  };
}

describe('اصطلاح ترتيب أصناف المنيو', () => {
  it('يفصل الصفوف الأساسية عن السناك حسب فئة الصنف لا حسب النسخة المخزّنة', () => {
    const rice  = meal('m1', 'رز', 'hot');
    const salad = meal('m2', 'سلطة', 'cold');
    const juice = meal('m3', 'عصير', 'snack');

    // الصف مخزّن بفئة قديمة 'hot' بينما الصنف نفسه صار سناكاً
    const items = [item('a', rice, 0), item('b', salad, 1), item('c', juice, 2, 'hot')];
    const { mains, snacks } = splitSlot(items);

    expect(mains.map(i => i.id)).toEqual(['a', 'b']);
    expect(snacks.map(i => i.id)).toEqual(['c']);
  });

  it('يرتّب حاراً ثم بارداً ثم سناك', () => {
    const items = [
      item('a', meal('m1', 'سلطة', 'cold'), 0),
      item('b', meal('m2', 'رز', 'hot'), 0),
      item('c', meal('m3', 'تمر', 'snack'), 0),
    ];
    expect(splitSlot(items).mains.map(i => i.id)).toEqual(['b', 'a']);
  });

  it('لا يتبادل صفان لهما نفس الـposition ترتيبهما بين تحميل وآخر', () => {
    const a = item('id-a', meal('m1', 'أ', 'hot'), 3);
    const b = item('id-b', meal('m2', 'ب', 'hot'), 3);

    // نفس البيانات بترتيب وصول مختلف من قاعدة البيانات
    const first  = splitSlot([a, b]).mains.map(i => i.id);
    const second = splitSlot([b, a]).mains.map(i => i.id);
    expect(first).toEqual(second);
  });

  it('normalizeSlot يعطي أرقاماً متسلسلة بلا فجوات دون تغيير الترتيب المعروض', () => {
    const items = [
      item('a', meal('m1', 'رز', 'hot'), 5),
      item('b', meal('m2', 'سلطة', 'cold'), 2),
      item('c', meal('m3', 'تمر', 'snack'), 0),   // اصطلاح الاستيراد القديم
      item('d', meal('m4', 'عصير', 'snack'), 101), // اصطلاح التحرير اليدوي
    ];
    const before = splitSlot(items);
    const norm = normalizeSlot(items);

    expect(norm.map(n => [n.item.id, n.category, n.position])).toEqual([
      ['a', 'hot', 0],
      ['b', 'cold', 1],
      ['c', 'snack', 100],
      ['d', 'snack', 101],
    ]);

    // الترتيب بعد التطبيع = الترتيب قبله بالضبط
    const after = splitSlot(norm.map(n => ({ ...n.item, category: n.category, position: n.position })));
    expect(after.mains.map(i => i.id)).toEqual(before.mains.map(i => i.id));
    expect(after.snacks.map(i => i.id)).toEqual(before.snacks.map(i => i.id));
  });

  it('التطبيع عملية ثابتة (تشغيلها مرتين لا يغيّر شيئاً)', () => {
    const items = [
      item('a', meal('m1', 'رز', 'hot'), 7),
      item('b', meal('m2', 'تمر', 'snack'), 3),
    ];
    const once = normalizeSlot(items).map(n => ({ ...n.item, category: n.category, position: n.position }));
    const twice = normalizeSlot(once);
    expect(twice.every(n => n.item.position === n.position && n.item.category === n.category)).toBe(true);
  });

  it('دوال الـposition متطابقة مع سعة الشبكة', () => {
    expect(mainPosition(0)).toBe(0);
    expect(mainPosition(MAIN_ROWS_PER_MEAL - 1)).toBe(7);
    expect(isSnackPosition(mainPosition(MAIN_ROWS_PER_MEAL - 1))).toBe(false);
    expect(isSnackPosition(snackPosition(0))).toBe(true);
    expect(positionRowIndex(snackPosition(SNACK_ROWS_PER_MEAL - 1))).toBe(3);
    expect(positionRowIndex(mainPosition(2))).toBe(2);
  });
});

describe('effectiveCategory', () => {
  it('فئة الصنف تسبق النسخة المخزّنة في menu_items', () => {
    expect(effectiveCategory({ category: 'hot', meals: { category: 'cold' } })).toBe('cold');
  });

  it('يحافظ على «بارد» المخزّنة لو عمود meals.category غير موجود', () => {
    expect(effectiveCategory({ category: 'cold', meals: { is_snack: false } })).toBe('cold');
  });

  it('is_snack كافٍ لاعتبار الصنف سناكاً', () => {
    expect(effectiveCategory({ category: 'hot', meals: { is_snack: true } })).toBe('snack');
  });
});

describe('buildSlotMap', () => {
  it('يجمع الأصناف بمفتاح (أسبوع|يوم|وجبة) بترتيب ثابت', () => {
    const a = item('a', meal('m1', 'رز', 'hot'), 1);
    const b = item('b', meal('m2', 'مرق', 'hot'), 0);
    const map = buildSlotMap([a, b]);
    expect(map.get('1|6|lunch')?.map(i => i.id)).toEqual(['b', 'a']);
  });
});
