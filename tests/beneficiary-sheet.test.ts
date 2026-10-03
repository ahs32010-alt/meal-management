import { describe, expect, it } from 'vitest';
import type { ItemCategory, MealType } from '@/lib/types';
import { STICKER_FLAGS } from '@/lib/sticker-flags';
import {
  BENEFICIARY_HEADERS,
  BENEFICIARY_TEMPLATE_ROW,
  COL_ACTIVE,
  COL_CUSTOM_LD,
  COL_DIETS,
  COL_MENU_OVERRIDES,
  DAY_FROM_AR,
  EXCLUSION_COLUMNS,
  FIXED_COLUMNS,
  STICKER_FLAG_COLUMNS,
  buildBeneficiaryRow,
  normalizeSheetRow,
  parseFixedToken,
  parseOverrideToken,
  parseYesNo,
  splitCellTokens,
  verifyBeneficiaryRoundTrip,
  type ParsedOverrideToken,
  type SheetFixedMeal,
  type SheetMeal,
  type SheetMenuOverride,
} from '@/lib/beneficiary-sheet';

/**
 * حماية من تكرار العطل: ملف المستفيدين كان يُصدَّر بلا «مفعّل» ولا خيارات
 * الستيكر ولا علامة «صنف بديل». أي تنزيل ثم رفع كان:
 *   • يُعيد تفعيل كل المعطّلين → تقفز أعداد أوامر التشغيل،
 *   • يمسح خيارات الستيكر،
 *   • ينقل كميات من خانة البدائل إلى الأصناف الثابتة في تقرير الأمر.
 */

const meal = (id: string, name: string, type: MealType, is_snack = false): SheetMeal =>
  ({ id, name, type, is_snack });

const MEALS: SheetMeal[] = [
  meal('m-foul', 'فول', 'breakfast'),
  meal('m-egg', 'بيض', 'breakfast'),
  meal('m-salad', 'سلطة', 'lunch'),
  meal('m-rice', 'رز', 'lunch'),
  meal('m-date', 'تمر', 'lunch', true),
];
const mealsById = new Map(MEALS.map(m => [m.id, m] as const));

const BEN = {
  name: 'أحمد', english_name: 'Ahmad', code: 'B001',
  category: 'عائلة', villa: '5', diet_type: 'عادي', notes: 'ملاحظة',
};

describe('أعمدة ملف المستفيدين', () => {
  it('يشمل «مفعّل» وكل خيارات الستيكر', () => {
    expect(BENEFICIARY_HEADERS).toContain(COL_ACTIVE);
    for (const f of STICKER_FLAGS) expect(BENEFICIARY_HEADERS).toContain(f.label);
  });

  it('يشمل ١٢ عمود محظورات/ثوابت (٣ وجبات × أساسي وسناك × نوعين)', () => {
    expect(EXCLUSION_COLUMNS).toHaveLength(6);
    expect(FIXED_COLUMNS).toHaveLength(6);
  });

  it('كل رأس عمود يظهر مرة واحدة', () => {
    expect(new Set(BENEFICIARY_HEADERS).size).toBe(BENEFICIARY_HEADERS.length);
  });
});

describe('buildBeneficiaryRow', () => {
  it('يكتب حالة التفعيل وخيارات الستيكر', () => {
    const row = buildBeneficiaryRow(
      { ...BEN, is_active: false, no_fish: true, low_carb: false },
      [], [], mealsById,
    );
    expect(row[COL_ACTIVE]).toBe('لا');
    expect(row['لا يفضل السمك']).toBe('نعم');
    expect(row['قليل الكاربوهيدرات']).toBe('لا');
  });

  it('is_active غير محدّد = مفعّل (الترقية ما اتشغّلت)', () => {
    const row = buildBeneficiaryRow(BEN, [], [], mealsById);
    expect(row[COL_ACTIVE]).toBe('نعم');
  });

  it('يكتب المحظور مع بديله في الوجبة الصحيحة', () => {
    const row = buildBeneficiaryRow(
      BEN,
      [{ meal_id: 'm-foul', alternative_meal_id: 'm-egg' }],
      [], mealsById,
    );
    expect(row['محظورات الفطور']).toBe('فول؛بيض');
    expect(row['محظورات الغداء']).toBe('');
  });

  it('يكتب الصنف الثابت بكميته وفئته وعلامة البديل وقائمة الإلغاء', () => {
    const fixed: SheetFixedMeal[] = [
      { meal_id: 'm-salad', day_of_week: 6, meal_type: 'lunch', quantity: 2, category: 'cold', is_alternative: true, suppress_if_meal_ids: ['m-rice'] },
      { meal_id: 'm-salad', day_of_week: 0, meal_type: 'lunch', quantity: 2, category: 'cold', is_alternative: true, suppress_if_meal_ids: ['m-rice'] },
    ];
    const row = buildBeneficiaryRow(BEN, [], fixed, mealsById);
    expect(row['ثابتة الغداء']).toBe('سلطة×2؛سبت احد@بارد@بديل↛رز');
  });

  it('يفصل نفس الصنف بفئتين مختلفتين إلى رمزين', () => {
    const fixed: SheetFixedMeal[] = [
      { meal_id: 'm-rice', day_of_week: 6, meal_type: 'lunch', quantity: 1, category: 'hot' },
      { meal_id: 'm-rice', day_of_week: 0, meal_type: 'lunch', quantity: 1, category: 'cold' },
    ];
    const row = buildBeneficiaryRow(BEN, [], fixed, mealsById);
    expect(splitCellTokens(row['ثابتة الغداء'])).toHaveLength(2);
  });

  it('السناك يخرج في عمود السناك لا العمود الأساسي', () => {
    const fixed: SheetFixedMeal[] = [
      { meal_id: 'm-date', day_of_week: 6, meal_type: 'lunch', quantity: 1, category: 'snack' },
    ];
    const row = buildBeneficiaryRow(BEN, [], fixed, mealsById);
    expect(row['ثابتة سناكات الغداء']).toBe('تمر؛سبت');
    expect(row['ثابتة الغداء']).toBe('');
  });
});

describe('دورة تصدير ← استيراد للأصناف الثابتة', () => {
  const roundTrip = (fixed: SheetFixedMeal[], col: string, sectionDefault: ItemCategory) => {
    const row = buildBeneficiaryRow(BEN, [], fixed, mealsById);
    return splitCellTokens(row[col]).map(t => parseFixedToken(t, sectionDefault));
  };

  it('يحافظ على الكمية والفئة وعلامة البديل والأيام', () => {
    const fixed: SheetFixedMeal[] = [
      { meal_id: 'm-salad', day_of_week: 6, meal_type: 'lunch', quantity: 3, category: 'cold', is_alternative: true },
      { meal_id: 'm-salad', day_of_week: 3, meal_type: 'lunch', quantity: 3, category: 'cold', is_alternative: true },
    ];
    const [token] = roundTrip(fixed, 'ثابتة الغداء', 'hot');
    expect(token).toMatchObject({ mealName: 'سلطة', quantity: 3, category: 'cold', isAlternative: true });
    expect(token!.dayTokens.map(d => DAY_FROM_AR[d])).toEqual([6, 3]);
  });

  it('صنف عادي بلا لواحق يرجع بقيمه الافتراضية', () => {
    const [token] = roundTrip(
      [{ meal_id: 'm-rice', day_of_week: 6, meal_type: 'lunch', quantity: 1, category: 'hot' }],
      'ثابتة الغداء', 'hot',
    );
    expect(token).toMatchObject({ mealName: 'رز', quantity: 1, category: 'hot', isAlternative: false, suppressNames: [] });
  });
});

describe('parseFixedToken — توافق مع الملفات القديمة', () => {
  it('يقرأ رمزاً بلا أي لاحقة', () => {
    expect(parseFixedToken('فول؛سبت احد', 'hot')).toMatchObject({
      mealName: 'فول', quantity: 1, category: 'hot', isAlternative: false,
    });
  });

  it('يقرأ الفئة والإلغاء بالترتيب القديم', () => {
    expect(parseFixedToken('مكرونة؛سبت@بارد↛فول,بيض', 'hot')).toMatchObject({
      mealName: 'مكرونة', category: 'cold', suppressNames: ['فول', 'بيض'],
    });
  });

  it('يرجّع null لرمز ناقص', () => {
    expect(parseFixedToken('فول', 'hot')).toBeNull();
    expect(parseFixedToken('', 'hot')).toBeNull();
  });
});

describe('parseYesNo', () => {
  it('يقبل صيغاً متعددة', () => {
    for (const v of ['نعم', 'yes', 'TRUE', '1', 'y']) expect(parseYesNo(v, false)).toBe(true);
    for (const v of ['لا', 'no', 'false', '0', '-']) expect(parseYesNo(v, true)).toBe(false);
  });

  it('العمود الغائب يأخذ الافتراضي — الملفات القديمة تُقرأ كما كانت', () => {
    expect(parseYesNo(undefined, true)).toBe(true);
    expect(parseYesNo('', false)).toBe(false);
    expect(parseYesNo('  ', true)).toBe(true);
  });

  it('قيمة غير مفهومة لا تقلب المعنى', () => {
    expect(parseYesNo('ربما', true)).toBe(true);
    expect(parseYesNo('ربما', false)).toBe(false);
  });
});

describe('أعمدة خيارات الستيكر مربوطة بمصدرها', () => {
  it('عمود لكل خيار، بنفس مفتاحه وتسميته', () => {
    expect(STICKER_FLAG_COLUMNS.map(c => c.key)).toEqual(STICKER_FLAGS.map(f => f.key));
    expect(STICKER_FLAG_COLUMNS.map(c => c.col)).toEqual(STICKER_FLAGS.map(f => f.label));
  });
});

describe('قالب الاستيراد يطابق التصدير', () => {
  it('صف المثال بطول الرؤوس تماماً — لا إزاحة', () => {
    expect(BENEFICIARY_TEMPLATE_ROW).toHaveLength(BENEFICIARY_HEADERS.length);
  });

  it('كل مثال تحت رأسه الصحيح', () => {
    const at = (h: string) => BENEFICIARY_TEMPLATE_ROW[BENEFICIARY_HEADERS.indexOf(h)];
    expect(at('الاسم')).toBe('محمد أحمد');
    expect(at('الكود')).toBe('B001');
    expect(at(COL_ACTIVE)).toBe('نعم');
    expect(at(COL_CUSTOM_LD)).toBe('لا');
    for (const f of STICKER_FLAG_COLUMNS) expect(at(f.col)).toBe('لا');
    for (const t of splitCellTokens(at('ثابتة الفطور'))) expect(parseFixedToken(t, 'hot')).not.toBeNull();
    for (const t of splitCellTokens(at(COL_MENU_OVERRIDES))) expect(typeof parseOverrideToken(t)).toBe('object');
  });

  it('رؤوس التصدير هي رؤوس القالب نفسها وبنفس الترتيب', () => {
    const row = buildBeneficiaryRow(BEN, [], [], mealsById);
    expect(Object.keys(row)).toEqual(BENEFICIARY_HEADERS);
  });
});

describe('الأنظمة الغذائية المسندة', () => {
  it('تُكتب بأسمائها وتُقرأ كما هي', () => {
    const row = buildBeneficiaryRow({ ...BEN, diet_names: ['سكري', 'قليل الملح'] }, [], [], mealsById);
    expect(row[COL_DIETS]).toBe('سكري - قليل الملح');
    expect(splitCellTokens(row[COL_DIETS])).toEqual(['سكري', 'قليل الملح']);
  });

  it('بلا أنظمة (أو من النسخة الاحتياطية) = عمود فارغ', () => {
    expect(buildBeneficiaryRow(BEN, [], [], mealsById)[COL_DIETS]).toBe('');
  });
});

describe('تعديلات المنيو لخانات محددة', () => {
  const OVERRIDES: SheetMenuOverride[] = [
    { week_number: 2, day_of_week: 0, meal_type: 'lunch', action: 'add', target_meal_id: 'm-date', quantity: 2, is_alternative: true },
    { week_number: 1, day_of_week: 6, meal_type: 'lunch', action: 'replace', base_meal_id: 'm-rice', target_meal_id: 'm-salad', quantity: 3 },
    { week_number: 1, day_of_week: 6, meal_type: 'breakfast', action: 'remove', base_meal_id: 'm-foul' },
  ];

  it('تُكتب مرتّبة بالأسبوع ثم اليوم ثم الوجبة', () => {
    const row = buildBeneficiaryRow(BEN, [], [], mealsById, OVERRIDES);
    expect(row[COL_MENU_OVERRIDES]).toBe(
      'أسبوع1؛سبت؛فطور؛حذف؛فول - أسبوع1؛سبت؛غداء؛استبدال؛رز←سلطة×3 - أسبوع2؛احد؛غداء؛إضافة؛تمر×2@بديل',
    );
  });

  it('دورة كاملة بلا فقد: الخانة والإجراء والصنفان والكمية والبديل', () => {
    const row = buildBeneficiaryRow(BEN, [], [], mealsById, OVERRIDES);
    const tokens = splitCellTokens(row[COL_MENU_OVERRIDES]).map(t => parseOverrideToken(t) as ParsedOverrideToken);
    expect(tokens).toEqual([
      { week_number: 1, day_of_week: 6, meal_type: 'breakfast', action: 'remove', baseName: 'فول', targetName: null, quantity: 1, isAlternative: false },
      { week_number: 1, day_of_week: 6, meal_type: 'lunch', action: 'replace', baseName: 'رز', targetName: 'سلطة', quantity: 3, isAlternative: false },
      { week_number: 2, day_of_week: 0, meal_type: 'lunch', action: 'add', baseName: null, targetName: 'تمر', quantity: 2, isAlternative: true },
    ]);
  });

  it('زر التحقق يقول سليم مع التعديلات والأنظمة', () => {
    const res = verifyBeneficiaryRoundTrip(
      [{ ben: { ...BEN, diet_names: ['سكري'] }, exclusions: [], fixed: [], overrides: OVERRIDES }],
      mealsById,
    );
    expect(res.issues).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it('يتسامح مع الأرقام العربية وأل التعريف والسهم المعكوس', () => {
    expect(parseOverrideToken('الأسبوع٣؛الخميس؛العشاء؛تبديل؛رز→سلطة')).toMatchObject({
      week_number: 3, day_of_week: 4, meal_type: 'dinner', action: 'replace', baseName: 'رز', targetName: 'سلطة',
    });
  });

  it('رسائل خطأ عربية واضحة', () => {
    expect(parseOverrideToken('أسبوع1؛سبت؛غداء')).toContain('غير مكتمل');
    expect(parseOverrideToken('أسبوع5؛سبت؛غداء؛حذف؛رز')).toContain('أسبوع1 إلى أسبوع4');
    expect(parseOverrideToken('أسبوع1؛فلان؛غداء؛حذف؛رز')).toContain('اليوم');
    expect(parseOverrideToken('أسبوع1؛سبت؛سحور؛حذف؛رز')).toContain('فطور أو غداء أو عشاء');
    expect(parseOverrideToken('أسبوع1؛سبت؛غداء؛نقل؛رز')).toContain('استبدال أو حذف أو إضافة');
    expect(parseOverrideToken('أسبوع1؛سبت؛غداء؛استبدال؛رز')).toContain('قديم←جديد');
  });

  it('بلا تعديلات (أو من النسخة الاحتياطية) = عمود فارغ', () => {
    expect(buildBeneficiaryRow(BEN, [], [], mealsById)[COL_MENU_OVERRIDES]).toBe('');
  });
});

describe('normalizeSheetRow', () => {
  it('يزيل المسافات الزائدة من الرؤوس فلا يُسقط العمود بصمت', () => {
    expect(normalizeSheetRow({ ' الاسم ': 'أحمد', 'محظورات  الفطور': 'فول', 'الكود': 5 })).toEqual({
      'الاسم': 'أحمد', 'محظورات الفطور': 'فول', 'الكود': '5',
    });
  });
});
