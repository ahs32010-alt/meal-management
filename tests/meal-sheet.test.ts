import { describe, expect, it } from 'vitest';
import type { Meal } from '@/lib/types';
import {
  MEAL_COL_CATEGORY,
  MEAL_COL_ENGLISH,
  MEAL_COL_SNACK,
  MEAL_COL_TYPE,
  MEAL_HEADERS,
  MEAL_REQUIRED_HEADERS,
  MEAL_TEMPLATE_ROW,
  buildMealRow,
  parseMealRow,
} from '@/lib/meal-sheet';

const meal = (p: Partial<Meal>): Meal => ({
  id: 'm', name: 'كبسة', english_name: 'Kabsa', type: 'lunch', is_snack: false, category: 'hot', entity_type: 'beneficiary', created_at: '', ...p,
});

describe('ملف الأصناف', () => {
  it('القالب والتصدير بنفس الرؤوس والترتيب', () => {
    expect(Object.keys(buildMealRow(meal({})))).toEqual(MEAL_HEADERS);
    expect(MEAL_TEMPLATE_ROW).toHaveLength(MEAL_HEADERS.length);
    for (const h of MEAL_REQUIRED_HEADERS) expect(MEAL_HEADERS).toContain(h);
  });

  it('القالب نفسه يُستورد بلا خطأ', () => {
    const row = Object.fromEntries(MEAL_HEADERS.map((h, i) => [h, MEAL_TEMPLATE_ROW[i]]));
    expect(parseMealRow(row, 'beneficiary', 'صف 2').error).toBeNull();
  });

  it('دورة تصدير ← استيراد بلا فقد لكل التركيبات', () => {
    const cases: Partial<Meal>[] = [
      { type: 'breakfast', is_snack: false, category: 'cold' },
      { type: 'lunch', is_snack: false, category: 'hot' },
      { type: 'dinner', is_snack: true, category: 'snack', english_name: undefined },
    ];
    for (const c of cases) {
      const m = meal(c);
      const { payload, error } = parseMealRow(buildMealRow(m), 'companion', 'صف 2');
      expect(error).toBeNull();
      expect(payload).toEqual({
        name: m.name, english_name: m.english_name ?? null, type: m.type,
        is_snack: m.is_snack, category: m.category, entity_type: 'companion',
      });
    }
  });

  it('صنف قديم بلا category يُصدَّر حاراً، والسناك سناك دائماً', () => {
    expect(buildMealRow(meal({ category: undefined }))[MEAL_COL_CATEGORY]).toBe('حار');
    expect(buildMealRow(meal({ is_snack: true, category: 'hot' }))[MEAL_COL_CATEGORY]).toBe('سناك');
  });

  it('غياب عمود الاسم الإنجليزي لا يمسح القيمة الحالية', () => {
    const row = buildMealRow(meal({}));
    delete row[MEAL_COL_ENGLISH];
    expect(parseMealRow(row, 'beneficiary', 'صف 2').payload).not.toHaveProperty('english_name');
  });

  it('الفئة «سناك» تجعل الصنف سناكاً حتى لو «سناك» = لا', () => {
    const row = { ...buildMealRow(meal({})), [MEAL_COL_SNACK]: 'لا', [MEAL_COL_CATEGORY]: 'سناك' };
    expect(parseMealRow(row, 'beneficiary', 'صف 2').payload).toMatchObject({ is_snack: true, category: 'snack' });
  });

  it('رسائل خطأ عربية واضحة', () => {
    expect(parseMealRow({ ...buildMealRow(meal({})), [MEAL_COL_TYPE]: 'غدا' }, 'beneficiary', 'صف 4').error)
      .toContain('صف 4 (كبسة): نوع الوجبة "غدا" غير صحيح');
    expect(parseMealRow({ ...buildMealRow(meal({})), [MEAL_COL_CATEGORY]: 'دافئ' }, 'beneficiary', 'صف 4').error)
      .toContain('الفئة "دافئ" غير صحيحة');
    expect(parseMealRow({ [MEAL_COL_TYPE]: 'غداء' }, 'beneficiary', 'صف 5').error).toBe('صف 5: الاسم مطلوب');
  });
});
