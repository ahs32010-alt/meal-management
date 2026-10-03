import { describe, expect, it } from 'vitest';
import type { DietSystem, Meal } from '@/lib/types';
import {
  DIET_COL_ALT,
  DIET_COL_ENTITY,
  DIET_COL_MEAL,
  DIET_COL_MEAL_TYPE,
  DIET_COL_NAME,
  DIET_COL_SNACK,
  DIET_HEADERS,
  DIET_REQUIRED_HEADERS,
  DIET_TEMPLATE_ROW,
  buildDietRows,
  parseDietRows,
} from '@/lib/diet-sheet';

const m = (id: string, name: string, type: Meal['type'], is_snack = false, entity_type: Meal['entity_type'] = 'beneficiary') =>
  ({ id, name, type, is_snack, entity_type });

const MEALS = [
  m('cake-d', 'كيكة', 'dinner', true),
  m('fruit-d', 'فاكهة', 'dinner', true),
  m('fruit-b', 'فاكهة', 'breakfast', true),
  m('pickle', 'مخلل', 'lunch'),
  m('salad', 'سلطة', 'lunch'),
  m('pickle-c', 'مخلل', 'lunch', false, 'companion'),
  m('salad-c', 'سلطة', 'lunch', false, 'companion'),
];

const DIETS: Pick<DietSystem, 'name' | 'description' | 'exclusions'>[] = [
  { name: 'سكري', description: 'بلا حلى', exclusions: [{ meal_id: 'cake-d', alternative_meal_id: 'fruit-d' }] },
  { name: 'قليل ملح', description: null, exclusions: [
    { meal_id: 'pickle-c', alternative_meal_id: 'salad-c' },
    { meal_id: 'pickle', alternative_meal_id: null },
  ] },
  { name: 'فارغ', description: null, exclusions: [] },
];

describe('ملف الأنظمة الغذائية', () => {
  it('القالب بنفس رؤوس التصدير ويُستورد', () => {
    expect(Object.keys(buildDietRows(DIETS, MEALS)[0])).toEqual(DIET_HEADERS);
    expect(DIET_TEMPLATE_ROW).toHaveLength(DIET_HEADERS.length);
    for (const h of DIET_REQUIRED_HEADERS) expect(DIET_HEADERS).toContain(h);
    const row = Object.fromEntries(DIET_HEADERS.map((h, i) => [h, DIET_TEMPLATE_ROW[i]]));
    expect(parseDietRows([row], MEALS).errors).toEqual([]);
  });

  it('صف لكل استبعاد، والنظام الفارغ صف واحد', () => {
    const rows = buildDietRows(DIETS, MEALS);
    expect(rows).toHaveLength(4);
    expect(rows.find(r => r[DIET_COL_NAME] === 'فارغ')![DIET_COL_MEAL]).toBe('');
    expect(rows[0]).toMatchObject({ [DIET_COL_MEAL]: 'كيكة', [DIET_COL_MEAL_TYPE]: 'عشاء', [DIET_COL_SNACK]: 'نعم', [DIET_COL_ALT]: 'فاكهة' });
  });

  it('دورة تصدير ← استيراد بلا فقد — حتى مع تكرار الاسم بين المستفيدين والمرافقين', () => {
    const { diets, errors } = parseDietRows(buildDietRows(DIETS, MEALS), MEALS);
    expect(errors).toEqual([]);
    const norm = (d: { name: string; description?: string | null; exclusions?: { meal_id: string; alternative_meal_id?: string | null }[] }) => ({
      name: d.name,
      description: d.description ?? null,
      exclusions: (d.exclusions ?? []).map(x => `${x.meal_id}>${x.alternative_meal_id ?? ''}`).sort(),
    });
    expect(diets.map(norm)).toEqual(DIETS.map(norm));
  });

  it('اسم صنف ملتبس بلا تحديد الوجبة يُرفض بدل التخمين', () => {
    const { errors } = parseDietRows([{ [DIET_COL_NAME]: 'س', [DIET_COL_MEAL]: 'فاكهة' }], MEALS);
    expect(errors[0]).toContain('موجود في أكثر من وجبة أو فئة');
  });

  it('صنف أو بديل غير موجود → خطأ عربي برقم الصف', () => {
    const r1 = parseDietRows([{ [DIET_COL_NAME]: 'س', [DIET_COL_MEAL]: 'بيتزا' }], MEALS);
    expect(r1.errors[0]).toContain('صف 2 (س): الصنف "بيتزا"');
    const r2 = parseDietRows([{ [DIET_COL_NAME]: 'س', [DIET_COL_MEAL]: 'كيكة', [DIET_COL_ALT]: 'سلطة' }], MEALS);
    expect(r2.errors[0]).toContain('البديل "سلطة" غير موجود');
  });

  it('يجمّع صفوف النظام الواحد ويرفض تكرار الصنف وقيم غير مفهومة', () => {
    const rows: Record<string, string>[] = [
      { [DIET_COL_NAME]: 'سكري', [DIET_COL_MEAL]: 'كيكة' },
      { [DIET_COL_NAME]: ' سكري ', [DIET_COL_MEAL]: 'كيكة' },
      { [DIET_COL_NAME]: 'سكري', [DIET_COL_MEAL]: 'مخلل', [DIET_COL_ENTITY]: 'زوار' },
    ];
    const { diets, errors } = parseDietRows(rows, MEALS);
    expect(diets).toHaveLength(1);
    expect(errors.some(e => e.includes('مكرر'))).toBe(true);
    expect(errors.some(e => e.includes('فئة الصنف "زوار"'))).toBe(true);
  });

  it('غياب عمود الوصف لا يمسح الوصف الحالي', () => {
    const { diets } = parseDietRows([{ [DIET_COL_NAME]: 'سكري', [DIET_COL_MEAL]: '' }], MEALS);
    expect(diets[0].description).toBeUndefined();
  });
});
