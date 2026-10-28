import { describe, it, expect } from 'vitest';
import { colorAt, colorsBackground, colorsInUse, effectiveDietOrder, joinColors, splitColors, moveDiet, moveDietTo, sortByDietOrder, sortByTierAndDiet, stickerColorKey, tierDietGroups } from '@/components/lunch-dinner-stickers/ld-diet-order';

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
    expect(out).toEqual([5, 9, 1, 7, 6, 8, 4, 2, 3]);
  });

  it('saved per-tier order wins, and each tier is ordered independently', () => {
    const items = [
      b(1, 'نظام غذائي عادي'),
      b(2, 'نظام غذائي سكري'),
      b(3, 'نظام غذائي عادي', { low_carb: true }),
      b(4, 'نظام غذائي سكري', { low_carb: true }),
    ];
    // في المرتبة الأولى: السكري قبل العادي — والمرتبة الثانية تبقى افتراضية
    const out = sortByTierAndDiet(items, x => x, ['0|نظام غذائي سكري']).map(x => x.n);
    expect(out).toEqual([2, 1, 3, 4]);
  });
});

describe('tierDietGroups', () => {
  it('lists diets per tier with counts, normal first by default, skipping no-diet', () => {
    const g = tierDietGroups([
      { diet_type: 'نظام غذائي سكري' }, { diet_type: 'نظام غذائي عادي' }, { diet_type: 'نظام غذائي عادي' },
      { diet_type: '' }, { diet_type: 'نظام غذائي عادي', custom_ld_meals: true },
    ], x => x, []);
    expect(g).toEqual([
      [{ diet: 'نظام غذائي عادي', count: 2 }, { diet: 'نظام غذائي سكري', count: 1 }],
      [],
      [{ diet: 'نظام غذائي عادي', count: 1 }],
    ]);
  });
});

// ── الترتيب داخل النظام بالكود/الفيلا + الستيكر متعدد الألوان ─────────────────
describe('الترتيب داخل النظام', () => {
  const bens = [
    { id: 'a', diet_type: 'سكري', code: '10', villa: '3' },
    { id: 'b', diet_type: 'سكري', code: '2', villa: '' },
    { id: 'c', diet_type: 'سكري', code: '7', villa: '1' },
    { id: 'd', diet_type: 'كلوي', code: '1', villa: '9' },
  ];
  const ids = (xs: typeof bens) => xs.map(x => x.id).join('');

  it('الافتراضي يبقي الترتيب الوارد داخل النظام', () => {
    expect(ids(sortByTierAndDiet(bens, b => b, ['0|سكري', '0|كلوي']))).toBe('abcd');
  });
  it('بالكود رقمياً (2 قبل 10) والأنظمة بترتيبها', () => {
    expect(ids(sortByTierAndDiet(bens, b => b, ['0|سكري', '0|كلوي'], 'code'))).toBe('bcad');
  });
  it('بالفيلا والفارغ آخر نظامه', () => {
    expect(ids(sortByTierAndDiet(bens, b => b, ['0|كلوي', '0|سكري'], 'villa'))).toBe('dcab');
  });
});

describe('الستيكر متعدد الألوان', () => {
  it('يفكّ ويجمع الألوان', () => {
    expect(splitColors('#aaa, #bbb')).toEqual(['#aaa', '#bbb']);
    expect(splitColors(undefined)).toEqual([]);
    expect(joinColors(['#a', '', '#b'])).toBe('#a,#b');
    expect(joinColors([])).toBeNull();
  });
  it('لون واحد كما هو، ولونين نصف فوق ونصف تحت', () => {
    expect(colorsBackground('#ff0000')).toBe('#ff0000');
    expect(colorsBackground('')).toBe('#ffffff');
    expect(colorsBackground('#f00,#00f')).toBe('linear-gradient(to bottom, #f00 0% 50%, #00f 50% 100%)');
  });
  it('لون الشريط حسب الارتفاع (لملف Word)', () => {
    expect(colorAt('#f00,#00f', 0.2)).toBe('#f00');
    expect(colorAt('#f00,#00f', 0.7)).toBe('#00f');
    expect(colorAt('#f00,#00f', 1)).toBe('#00f');
    expect(colorAt(undefined, 0.5)).toBeUndefined();
  });
});
