import { describe, expect, it } from 'vitest';
import type { ItemCategory, Meal, MealType, MenuItem } from '@/lib/types';
import { buildSlotMap, mainPosition, snackPosition } from '@/lib/menu-utils';
import {
  buildPersonalMenuSlot, tallyPersonalMenuRows, slotsContainingMeal, buildOrderOverlay,
} from '@/lib/beneficiary-menu';

function meal(id: string, name: string, category: ItemCategory, type: MealType = 'lunch'): Meal {
  return { id, name, type, is_snack: category === 'snack', category, created_at: '' };
}

function item(id: string, m: Meal, position: number, day = 6, week = 1): MenuItem {
  return {
    id, week_number: week, day_of_week: day, meal_type: m.type, meal_id: m.id,
    category: m.category!, position, multiplier: 1, extra_quantity: 0, created_at: '', meals: m,
  };
}

const rice   = meal('m-rice', 'رز', 'hot');
const fish   = meal('m-fish', 'سمك', 'hot');
const chicken= meal('m-chick', 'دجاج', 'hot');
const salad  = meal('m-salad', 'سلطة', 'cold');
const juice  = meal('m-juice', 'عصير', 'snack');
const dates  = meal('m-dates', 'تمر', 'snack');
const soup   = meal('m-soup', 'شوربة', 'hot');

const ALL = [rice, fish, chicken, salad, juice, dates, soup];
const mealById = (id: string) => ALL.find(m => m.id === id);

const slotMap = buildSlotMap([
  item('i1', rice,  mainPosition(0)),
  item('i2', fish,  mainPosition(1)),
  item('i3', salad, mainPosition(2)),
  item('i4', juice, snackPosition(0)),
]);

const base = { week: 1, day: 6, mealType: 'lunch' as MealType, slotMap, mealById };

describe('المنيو المخصّص للمستفيد', () => {
  it('يعرض المنيو كما هو لمن ما عنده محظورات', () => {
    const { mains, snacks } = buildPersonalMenuSlot({ ...base, exclusions: [], fixed: [] });
    expect(mains.map(r => [r.kind, r.meal?.name])).toEqual([
      ['kept', 'رز'], ['kept', 'سمك'], ['kept', 'سلطة'],
    ]);
    expect(snacks.map(r => [r.kind, r.meal?.name])).toEqual([['kept', 'عصير']]);
  });

  it('يستبدل الصنف المحظور ببديل نفس المستفيد ويحفظ اسم الأصل', () => {
    const { mains } = buildPersonalMenuSlot({
      ...base,
      exclusions: [{ meal_id: fish.id, alternative_meal_id: chicken.id }],
      fixed: [],
    });
    const row = mains[1];
    expect(row.kind).toBe('replaced');
    expect(row.meal?.name).toBe('دجاج');
    expect(row.originalMeal?.name).toBe('سمك');
    // الترتيب ما يتغيّر — البديل يحل في نفس الصف
    expect(mains.map(r => r.meal?.name)).toEqual(['رز', 'دجاج', 'سلطة']);
  });

  it('يخلي الخانة فاضية ويرجّع اسم الصنف الأساسي عند غياب البديل', () => {
    const { mains } = buildPersonalMenuSlot({
      ...base,
      exclusions: [{ meal_id: fish.id, alternative_meal_id: null }],
      fixed: [],
    });
    expect(mains[1].kind).toBe('removed');
    expect(mains[1].meal).toBeNull();
    expect(mains[1].originalMeal?.name).toBe('سمك');
  });

  it('يعامل البديل الفارغ ("") والبديل المحذوف كبلا بديل', () => {
    const empty = buildPersonalMenuSlot({
      ...base, exclusions: [{ meal_id: fish.id, alternative_meal_id: '' }], fixed: [],
    });
    const gone = buildPersonalMenuSlot({
      ...base, exclusions: [{ meal_id: fish.id, alternative_meal_id: 'meal-deleted' }], fixed: [],
    });
    expect(empty.mains[1].kind).toBe('removed');
    expect(gone.mains[1].kind).toBe('removed');
  });

  it('يستبدل سناك محظور ببديل سناك في قسم السناك', () => {
    const { mains, snacks } = buildPersonalMenuSlot({
      ...base,
      exclusions: [{ meal_id: juice.id, alternative_meal_id: dates.id }],
      fixed: [],
    });
    expect(snacks.map(r => [r.kind, r.meal?.name])).toEqual([['replaced', 'تمر']]);
    expect(mains).toHaveLength(3);
  });

  it('يضيف الأصناف الثابتة لليوم والوجبة المطابقين فقط', () => {
    const fixed = [
      { meal_id: soup.id,  meal_type: 'lunch' as MealType,  days: new Set([6]), quantity: 2 },
      { meal_id: dates.id, meal_type: 'lunch' as MealType,  days: new Set([0]), quantity: 1 },
      { meal_id: soup.id,  meal_type: 'dinner' as MealType, days: new Set([6]), quantity: 1 },
    ];
    const { mains, snacks } = buildPersonalMenuSlot({ ...base, exclusions: [], fixed });
    expect(mains.map(r => [r.kind, r.meal?.name, r.quantity])).toEqual([
      ['kept', 'رز', 1], ['kept', 'سمك', 1], ['kept', 'سلطة', 1], ['fixed', 'شوربة', 2],
    ]);
    // ثابت الأحد ما يظهر في السبت، وثابت العشاء ما يظهر في الغداء
    expect(snacks.map(r => r.meal?.name)).toEqual(['عصير']);
  });

  it('الملخّص يحصي المضاف لهذه الخانة', () => {
    const { mains } = buildPersonalMenuSlot({
      ...base, exclusions: [], fixed: [],
      overrides: [{ week_number: 1, day_of_week: 6, meal_type: 'lunch', action: 'add', target_meal_id: soup.id, quantity: 2 }],
    });
    expect(mains.map(r => [r.kind, r.meal?.name, r.quantity])).toEqual([
      ['kept', 'رز', 1], ['kept', 'سمك', 1], ['kept', 'سلطة', 1], ['added', 'شوربة', 2],
    ]);
    expect(tallyPersonalMenuRows(mains)).toEqual({ eats: 4, missing: 0, replaced: 0, added: 1 });
  });

  it('يلغي الصنف الثابت لو أحد أصناف الإلغاء موجود في نفس الوجبة', () => {
    const fixed = [{
      meal_id: soup.id, meal_type: 'lunch' as MealType, days: [6],
      quantity: 1, suppress_if_meal_ids: [rice.id, chicken.id],
    }];
    const { mains } = buildPersonalMenuSlot({ ...base, exclusions: [], fixed });
    const row = mains[3];
    expect(row.kind).toBe('fixed');
    expect(row.suppressedBy.map(m => m.name)).toEqual(['رز']);
    // الملغى لا يُحتسب في «ياكل»
    expect(tallyPersonalMenuRows(mains).eats).toBe(3);
  });

  it('الصنف الثابت السناك يذهب لقسم السناك', () => {
    const fixed = [{ meal_id: dates.id, meal_type: 'lunch' as MealType, days: [6], quantity: 1, is_alternative: true }];
    const { snacks } = buildPersonalMenuSlot({ ...base, exclusions: [], fixed });
    expect(snacks.map(r => [r.kind, r.meal?.name, r.isAlternativeFixed])).toEqual([
      ['kept', 'عصير', false], ['fixed', 'تمر', true],
    ]);
  });

  it('الخانة الفارغة في المنيو ترجّع صفوفاً فارغة بلا انفجار', () => {
    const { mains, snacks } = buildPersonalMenuSlot({
      ...base, day: 3, exclusions: [{ meal_id: fish.id, alternative_meal_id: chicken.id }], fixed: [],
    });
    expect(mains).toEqual([]);
    expect(snacks).toEqual([]);
  });

  it('الملخّص يعدّ المأكول والبدائل والمحظور بلا بديل', () => {
    const { mains, snacks } = buildPersonalMenuSlot({
      ...base,
      exclusions: [
        { meal_id: fish.id, alternative_meal_id: chicken.id },
        { meal_id: salad.id, alternative_meal_id: null },
      ],
      fixed: [{ meal_id: soup.id, meal_type: 'lunch' as MealType, days: [6], quantity: 1 }],
    });
    expect(tallyPersonalMenuRows([...mains, ...snacks])).toEqual({ eats: 4, missing: 1, replaced: 1, added: 0 });
  });

  it('يفصل الأسابيع — منيو الأسبوع الثاني لا يظهر في الأول', () => {
    const map = buildSlotMap([item('w2', rice, mainPosition(0), 6, 2)]);
    const w1 = buildPersonalMenuSlot({ ...base, slotMap: map, exclusions: [], fixed: [] });
    const w2 = buildPersonalMenuSlot({ ...base, week: 2, slotMap: map, exclusions: [], fixed: [] });
    expect(w1.mains).toEqual([]);
    expect(w2.mains.map(r => r.meal?.name)).toEqual(['رز']);
  });
});

// ─── قرارات الخانة الواحدة (beneficiary_menu_overrides) ─────────────────────
describe('قرارات الخانة تتقدّم على المحظور العام', () => {
  // نفس الصنف (سمك) في السبت أ١ وفي الثلاثاء أ١ وفي السبت أ٢
  const multi = buildSlotMap([
    item('a1', rice, mainPosition(0), 6, 1),
    item('a2', fish, mainPosition(1), 6, 1),
    item('b1', fish, mainPosition(0), 2, 1),
    item('c1', fish, mainPosition(0), 6, 2),
  ]);
  const m = { mealType: 'lunch' as MealType, slotMap: multi, mealById };

  it('بديل مختلف لكل يوم لنفس الصنف — وهو ما لا يقدر عليه المحظور العام', () => {
    const overrides = [
      { week_number: 1, day_of_week: 6, meal_type: 'lunch' as const, action: 'replace' as const, base_meal_id: fish.id, target_meal_id: chicken.id },
      { week_number: 1, day_of_week: 2, meal_type: 'lunch' as const, action: 'replace' as const, base_meal_id: fish.id, target_meal_id: soup.id },
      { week_number: 2, day_of_week: 6, meal_type: 'lunch' as const, action: 'remove' as const, base_meal_id: fish.id },
    ];
    const sat1 = buildPersonalMenuSlot({ ...m, week: 1, day: 6, exclusions: [], fixed: [], overrides });
    const tue1 = buildPersonalMenuSlot({ ...m, week: 1, day: 2, exclusions: [], fixed: [], overrides });
    const sat2 = buildPersonalMenuSlot({ ...m, week: 2, day: 6, exclusions: [], fixed: [], overrides });

    expect(sat1.mains.map(r => [r.kind, r.meal?.name, r.scope])).toEqual([
      ['kept', 'رز', 'menu'], ['replaced', 'دجاج', 'slot'],
    ]);
    expect(tue1.mains.map(r => [r.kind, r.meal?.name, r.scope])).toEqual([['replaced', 'شوربة', 'slot']]);
    expect(sat2.mains.map(r => [r.kind, r.meal, r.originalMeal?.name, r.scope])).toEqual([
      ['removed', null, 'سمك', 'slot'],
    ]);
  });

  it('الخانة بلا قرار ترجع للمحظور العام، والخانة ذات القرار تتقدّم عليه', () => {
    const exclusions = [{ meal_id: fish.id, alternative_meal_id: chicken.id }];
    const overrides = [
      { week_number: 1, day_of_week: 2, meal_type: 'lunch' as const, action: 'replace' as const, base_meal_id: fish.id, target_meal_id: soup.id },
    ];
    const sat = buildPersonalMenuSlot({ ...m, week: 1, day: 6, exclusions, fixed: [], overrides });
    const tue = buildPersonalMenuSlot({ ...m, week: 1, day: 2, exclusions, fixed: [], overrides });
    // السبت: لا قرار خانة → المحظور العام (دجاج) بنطاق global
    expect(sat.mains.map(r => [r.meal?.name, r.scope])).toEqual([['رز', 'menu'], ['دجاج', 'global']]);
    // الثلاثاء: قرار الخانة (شوربة) يتقدّم
    expect(tue.mains.map(r => [r.meal?.name, r.scope])).toEqual([['شوربة', 'slot']]);
  });

  it('قرار الخانة يقدر يحذف صنفاً ثابتاً أسبوعياً من أسبوع واحد فقط', () => {
    const fixed = [{ meal_id: soup.id, meal_type: 'lunch' as MealType, days: [6], quantity: 1 }];
    const overrides = [
      { week_number: 2, day_of_week: 6, meal_type: 'lunch' as const, action: 'remove' as const, base_meal_id: soup.id },
    ];
    const w1 = buildPersonalMenuSlot({ ...m, week: 1, day: 6, exclusions: [], fixed, overrides });
    const w2 = buildPersonalMenuSlot({ ...m, week: 2, day: 6, exclusions: [], fixed, overrides });
    expect(w1.mains.filter(r => r.kind === 'fixed').map(r => r.meal?.name)).toEqual(['شوربة']);
    expect(w2.mains.filter(r => r.kind === 'fixed')).toEqual([]);
    expect(w2.mains.some(r => r.kind === 'removed' && r.originalMeal?.name === 'شوربة')).toBe(true);
  });

  it('الإضافة تخص أسبوعها ويومها فقط', () => {
    const overrides = [
      { week_number: 2, day_of_week: 6, meal_type: 'lunch' as const, action: 'add' as const, target_meal_id: soup.id, quantity: 3, is_alternative: true },
    ];
    const w1 = buildPersonalMenuSlot({ ...m, week: 1, day: 6, exclusions: [], fixed: [], overrides });
    const w2 = buildPersonalMenuSlot({ ...m, week: 2, day: 6, exclusions: [], fixed: [], overrides });
    expect(w1.mains.some(r => r.kind === 'added')).toBe(false);
    const addRow = w2.mains.find(r => r.kind === 'added')!;
    expect([addRow.meal?.name, addRow.quantity, addRow.isAlternativeFixed, addRow.scope])
      .toEqual(['شوربة', 3, true, 'slot']);
  });

  it('الصنف المضاف لا يُحسب مرتين لو له صنف ثابت بنفس الاسم في نفس الخانة', () => {
    const fixed = [{ meal_id: soup.id, meal_type: 'lunch' as MealType, days: [6], quantity: 1 }];
    const overrides = [
      { week_number: 1, day_of_week: 6, meal_type: 'lunch' as const, action: 'add' as const, target_meal_id: soup.id, quantity: 5 },
    ];
    const { mains } = buildPersonalMenuSlot({ ...m, week: 1, day: 6, exclusions: [], fixed, overrides });
    const soups = mains.filter(r => r.meal?.id === soup.id);
    expect(soups).toHaveLength(1);
    expect([soups[0].kind, soups[0].quantity]).toEqual(['added', 5]);
  });

  it('البديل المحذوف من القاعدة يُعامل كحذف بلا بديل لا كصف فارغ', () => {
    const overrides = [
      { week_number: 1, day_of_week: 6, meal_type: 'lunch' as const, action: 'replace' as const, base_meal_id: fish.id, target_meal_id: 'meal-deleted' },
    ];
    const { mains } = buildPersonalMenuSlot({ ...m, week: 1, day: 6, exclusions: [], fixed: [], overrides });
    expect(mains.map(r => [r.kind, r.originalMeal?.name])).toEqual([['kept', 'رز'], ['removed', 'سمك']]);
  });

  it('قرارات وجبة أخرى أو يوم آخر لا تتسرّب لهذه الخانة', () => {
    const overrides = [
      { week_number: 1, day_of_week: 6, meal_type: 'dinner' as const, action: 'remove' as const, base_meal_id: fish.id },
      { week_number: 1, day_of_week: 0, meal_type: 'lunch' as const, action: 'remove' as const, base_meal_id: fish.id },
    ];
    const { mains } = buildPersonalMenuSlot({ ...m, week: 1, day: 6, exclusions: [], fixed: [], overrides });
    expect(mains.map(r => [r.kind, r.meal?.name])).toEqual([['kept', 'رز'], ['kept', 'سمك']]);
  });

  it('يعدّ خانات الصنف — لتحذير المستخدم من أثر المحظور العام', () => {
    const slots = slotsContainingMeal(multi, fish.id);
    expect(slots).toHaveLength(3);
    expect(slots.map(s => `${s.week}|${s.day}|${s.mealType}`).sort()).toEqual([
      '1|2|lunch', '1|6|lunch', '2|6|lunch',
    ]);
  });
});

// ─── طبقة أمر التشغيل ────────────────────────────────────────────────────────
describe('انعكاس القرارات على أمر التشغيل', () => {
  const orderMealIds = [rice.id, fish.id, juice.id];
  const baseOrder = { week: 1, day: 6, mealType: 'lunch' as MealType, orderMealIds };

  it('الأمر القديم بلا رقم أسبوع لا يتأثر بقرارات الخانات إطلاقاً', () => {
    const overrides = [
      { week_number: 1, day_of_week: 6, meal_type: 'lunch' as const, action: 'replace' as const, base_meal_id: fish.id, target_meal_id: soup.id },
      { week_number: 1, day_of_week: 6, meal_type: 'lunch' as const, action: 'add' as const, target_meal_id: dates.id, quantity: 2 },
    ];
    const exclusions = [{ meal_id: fish.id, alternative_meal_id: chicken.id }];

    for (const week of [null, undefined, 0, 9]) {
      const r = buildOrderOverlay({ ...baseOrder, week: week as number | null | undefined, exclusions, overrides });
      // المحظور العام وحده — نفس سلوك النظام قبل الميزة
      expect(r.excluded).toEqual([{ meal_id: fish.id, alternative_meal_id: chicken.id, scope: 'global' }]);
      expect(r.added).toEqual([]);
      expect(r.fixedDecisions.size).toBe(0);
    }
  });

  it('قرار الخانة يتقدّم على المحظور العام لنفس الصنف', () => {
    const r = buildOrderOverlay({
      ...baseOrder,
      exclusions: [{ meal_id: fish.id, alternative_meal_id: chicken.id }],
      overrides: [{ week_number: 1, day_of_week: 6, meal_type: 'lunch', action: 'replace', base_meal_id: fish.id, target_meal_id: soup.id }],
    });
    expect(r.excluded).toEqual([{ meal_id: fish.id, alternative_meal_id: soup.id, scope: 'slot' }]);
  });

  it('المحظور العام يبقى شغّالاً للأصناف التي لا قرار خانة لها', () => {
    const r = buildOrderOverlay({
      ...baseOrder,
      exclusions: [
        { meal_id: fish.id, alternative_meal_id: chicken.id },
        { meal_id: juice.id, alternative_meal_id: null },
      ],
      overrides: [{ week_number: 1, day_of_week: 6, meal_type: 'lunch', action: 'remove', base_meal_id: fish.id }],
    });
    expect(r.excluded).toEqual([
      { meal_id: fish.id, alternative_meal_id: null, scope: 'slot' },
      { meal_id: juice.id, alternative_meal_id: null, scope: 'global' },
    ]);
  });

  it('قرار على صنف غير موجود في الأمر لا يضيف استبعاداً وهمياً', () => {
    const r = buildOrderOverlay({
      ...baseOrder, exclusions: [{ meal_id: salad.id, alternative_meal_id: chicken.id }],
      overrides: [{ week_number: 1, day_of_week: 6, meal_type: 'lunch', action: 'remove', base_meal_id: soup.id }],
    });
    expect(r.excluded).toEqual([]);
    // لكن القرار يبقى متاحاً للأصناف الثابتة (شوربة قد تكون صنفاً ثابتاً)
    expect(r.fixedDecisions.get(soup.id)).toEqual({ removed: true, replacedWith: null });
  });

  it('الإضافة ترجع بكميتها وعلامة «بديل» لتُحتسب في الجدول الصحيح', () => {
    const r = buildOrderOverlay({
      ...baseOrder, exclusions: [],
      overrides: [
        { week_number: 1, day_of_week: 6, meal_type: 'lunch', action: 'add', target_meal_id: soup.id, quantity: 3, is_alternative: true },
        { week_number: 1, day_of_week: 6, meal_type: 'lunch', action: 'add', target_meal_id: dates.id },
      ],
    });
    expect(r.added).toEqual([
      { meal_id: soup.id, quantity: 3, is_alternative: true },
      { meal_id: dates.id, quantity: 1, is_alternative: false },
    ]);
  });

  it('قرارات خانة أخرى (يوم/أسبوع/وجبة) لا تتسرّب للأمر', () => {
    const r = buildOrderOverlay({
      ...baseOrder, exclusions: [],
      overrides: [
        { week_number: 2, day_of_week: 6, meal_type: 'lunch', action: 'remove', base_meal_id: fish.id },
        { week_number: 1, day_of_week: 0, meal_type: 'lunch', action: 'remove', base_meal_id: fish.id },
        { week_number: 1, day_of_week: 6, meal_type: 'dinner', action: 'remove', base_meal_id: fish.id },
        { week_number: 1, day_of_week: 6, meal_type: 'lunch', action: 'add', target_meal_id: soup.id },
      ],
    });
    expect(r.excluded).toEqual([]);
    expect(r.added).toEqual([{ meal_id: soup.id, quantity: 1, is_alternative: false }]);
  });

  it('تبديل صنف ثابت في خانة واحدة يرجع كقرار استبدال لا حذف', () => {
    const r = buildOrderOverlay({
      ...baseOrder, exclusions: [],
      overrides: [{ week_number: 1, day_of_week: 6, meal_type: 'lunch', action: 'replace', base_meal_id: soup.id, target_meal_id: dates.id }],
    });
    expect(r.fixedDecisions.get(soup.id)).toEqual({ removed: false, replacedWith: dates.id });
  });
});
