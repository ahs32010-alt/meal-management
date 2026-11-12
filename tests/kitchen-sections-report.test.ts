import { describe, expect, it } from 'vitest';
import { aggregateKitchenSections, orderedDays } from '@/lib/kitchen-sections-report';
import type { MenuPeriodReport } from '@/lib/menu-period-report';
import type { KitchenSection, Meal } from '@/lib/types';

const meal = (id: string, name: string, type: Meal['type'] = 'lunch', is_snack = false): Meal =>
  ({ id, name, type, is_snack, created_at: '' });

function rep(items: Array<[Meal, number]>, alts: Array<[Meal, number]> = [], fixed: Array<[Meal, number]> = []): MenuPeriodReport {
  return {
    selections: {}, weeksSummary: [], processedSlots: 1,
    aggregated: {
      mainMealsSummary: [], snackMealsSummary: [], snackAltSummary: [],
      altSummary: alts.map(([m, qty]) => ({ meal: m, qty })),
      fixedSummary: fixed.map(([m, qty]) => ({ meal: m, qty })),
      itemsSummary: items.map(([m, quantity]) => ({ meal: m, quantity })),
    },
  };
}

const sections: KitchenSection[] = [
  { id: 'app', name: 'المقبلات', color: '#0f0', sort_order: 2 },
  { id: 'hot', name: 'الطبخ الحار', color: '#f00', sort_order: 1 },
];

describe('حصر أقسام المطبخ', () => {
  it('ترتيب الأيام: الأسبوع ثم السبت أولاً', () => {
    expect(orderedDays({ '2': [0, 6], '1': [1] }).map(d => d.key)).toEqual(['1-1', '2-6', '2-0']);
  });

  it('يجمّع تحت القسم، البديل تحت قسمه هو، ونفس الاسم بوجبتين سطر واحد', () => {
    const riceL = meal('r1', 'رز أصفر', 'lunch');
    const riceD = meal('r2', 'رز أصفر ', 'dinner');
    const salad = meal('s1', 'سلطة خضراء');
    const odd = meal('x1', 'صنف بلا قسم');
    const days = orderedDays({ '1': [6, 0] });
    const res = aggregateKitchenSections(
      days,
      [
        rep([[riceL, 10], [riceD, 5], [salad, 3]], [[salad, 3]]), // السلطة بديل للرز
        rep([[riceL, 7], [odd, 2]], [], [[riceL, 1]]),
      ],
      sections,
      { r1: 'hot', r2: 'hot', s1: 'app', x1: 'deleted-section' },
    );

    expect(res.sections.map(b => b.section?.name ?? null)).toEqual(['الطبخ الحار', 'المقبلات', null]);
    const rice = res.sections[0].rows[0];
    expect(rice.name).toBe('رز أصفر');
    expect(rice.mealTypes).toEqual(['lunch', 'dinner']);
    expect(rice.perDay['1-6'].qty).toBe(15);
    expect(rice.perDay['1-0']).toEqual({ qty: 7, alt: 0, fixed: 1 });
    expect(rice.total).toBe(22);

    const saladRow = res.sections[1].rows[0];
    expect(saladRow).toMatchObject({ total: 3, altTotal: 3 });
    expect(res.sections[2].rows[0]).toMatchObject({ name: 'صنف بلا قسم', total: 2 });
    expect(res.grandTotal).toBe(27);
  });

  it('يوم بلا منيو لا يكسر الحساب، والأقسام الفارغة تبقى بمجموع صفر', () => {
    const res = aggregateKitchenSections(orderedDays({ '1': [6] }), [null], sections, {});
    expect(res.grandTotal).toBe(0);
    expect(res.sections).toHaveLength(2);
  });
});
