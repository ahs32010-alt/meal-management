import { describe, it, expect } from 'vitest';
import { effectiveDietOrder, moveDiet, sortByDietOrder } from '@/components/lunch-dinner-stickers/ld-diet-order';

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
