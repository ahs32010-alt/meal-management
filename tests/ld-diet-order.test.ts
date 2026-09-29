import { describe, it, expect } from 'vitest';
import { colorsInUse, effectiveDietOrder, moveDiet, moveDietTo, sortByDietOrder, sortByTierAndDiet, stickerColorKey } from '@/components/lunch-dinner-stickers/ld-diet-order';

describe('effectiveDietOrder', () => {
  it('puts saved diets first and appends new ones in incoming order', () => {
    expect(effectiveDietOrder(['أ', 'ب', 'ج'], ['ج', 'أ'])).toEqual(['ج', 'أ', 'ب']);
  });
  it('drops saved diets that are not present', () => {
    expect(effectiveDietOrder(['أ'], ['ز', 'أ'])).toEqual(['أ']);
  });
});

describe('moveDiet', () => {
  it('swaps with the neighbour and keeps absent saved diets at the end', () => {
    expect(moveDiet(['أ', 'ب'], ['ز', 'أ', 'ب'], 'ب', -1)).toEqual(['ب', 'أ', 'ز']);
  });
  it('is a no-op at the edges', () => {
    const saved = ['أ', 'ب'];
    expect(moveDiet(['أ', 'ب'], saved, 'أ', -1)).toBe(saved);
    expect(moveDiet(['أ', 'ب'], saved, 'ب', 1)).toBe(saved);
  });
});

describe('sortByDietOrder', () => {
  const rows = [
    { n: 1, d: 'ب' }, { n: 2, d: '' }, { n: 3, d: 'أ' },
    { n: 4, d: 'ب' }, { n: 5, d: 'أ' }, { n: 6, d: 'جديد' },
  ];
  it('groups by order, keeps original order within a group, no-diet last', () => {
    const out = sortByDietOrder(rows, r => r.d, ['أ', 'ب']).map(r => r.n);
    expect(out).toEqual([3, 5, 1, 4, 6, 2]);
  });
});

describe('moveDietTo', () => {
  it('moves a diet to an exact position and keeps absent saved diets at the end', () => {
    expect(moveDietTo(['أ', 'ب', 'ج'], ['ز', 'أ', 'ب', 'ج'], 'ج', 0)).toEqual(['ج', 'أ', 'ب', 'ز']);
  });
  it('clamps the index and is a no-op when already there', () => {
    expect(moveDietTo(['أ', 'ب'], [], 'أ', 99)).toEqual(['ب', 'أ']);
    const saved = ['أ', 'ب'];
    expect(moveDietTo(['أ', 'ب'], saved, 'أ', 0)).toBe(saved);
  });
});

describe('colorsInUse', () => {
  it('groups stickers by colour (case-insensitive) with white first', () => {
    const items = ['سكري', 'حمية', '', 'سكري', 'قلب'];
    const colors = { 'سكري': '#FF0000', 'حمية': '#ff0000', 'قلب': '#00B050' };
    expect(colorsInUse(items, d => d, colors)).toEqual([
      { key: '', count: 1, diets: [] },
      { key: '#ff0000', count: 3, diets: ['سكري', 'حمية'] },
      { key: '#00b050', count: 1, diets: ['قلب'] },
    ]);
  });
  it('a diet without a colour counts as white', () => {
    expect(stickerColorKey('عادي', {})).toBe('');
  });
});

describe('sortByTierAndDiet', () => {
  const b = (n: number, diet_type: string, extra: { low_carb?: boolean; custom_ld_meals?: boolean } = {}) =>
    ({ n, diet_type, ...extra });
  it('all diets (normal first) → carbs (Ⓡ flag) → custom meals last (even with Ⓡ)', () => {
    const items = [
      b(1, 'نظام غذائي سكري'),
      b(2, 'نظام غذائي عادي', { custom_ld_meals: true }),
      b(3, 'نظام غذائي عادي - قليل الكاربوهيدرات', { low_carb: true, custom_ld_meals: true }),
      b(4, 'نظام غذائي عادي - قليل الكاربوهيدرات', { low_carb: true }),
      b(5, 'نظام غذائي عادي'),
      b(6, ''),
      b(7, 'نظام غذائي قليل الكربوهيدرات (شبه مهروس)'), // الاسم وحده لا يكفي — بلا Ⓡ
      b(8, 'نظام غذائي سكري', { low_carb: true }),
      b(9, 'نظام غذائي عادي'),
    ];
    const out = sortByTierAndDiet(items, x => x, []).map(x => x.n);
    expect(out).toEqual([5, 9, 1, 7, 6, 4, 8, 2, 3]);
  });
});
