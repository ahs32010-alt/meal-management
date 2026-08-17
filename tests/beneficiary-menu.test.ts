import { describe, expect, it } from 'vitest';
import type { ItemCategory, Meal, MealType, MenuItem } from '@/lib/types';
import { buildSlotMap, mainPosition, snackPosition } from '@/lib/menu-utils';
import { buildPersonalMenuSlot, tallyPersonalMenuRows } from '@/lib/beneficiary-menu';

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
    expect(tallyPersonalMenuRows([...mains, ...snacks])).toEqual({ eats: 4, missing: 1, replaced: 1 });
  });

  it('يفصل الأسابيع — منيو الأسبوع الثاني لا يظهر في الأول', () => {
    const map = buildSlotMap([item('w2', rice, mainPosition(0), 6, 2)]);
    const w1 = buildPersonalMenuSlot({ ...base, slotMap: map, exclusions: [], fixed: [] });
    const w2 = buildPersonalMenuSlot({ ...base, week: 2, slotMap: map, exclusions: [], fixed: [] });
    expect(w1.mains).toEqual([]);
    expect(w2.mains.map(r => r.meal?.name)).toEqual(['رز']);
  });
});
