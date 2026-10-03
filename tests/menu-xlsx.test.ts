import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { EntityType, ItemCategory, Meal, MealType, MenuItem } from '@/lib/types';
import { buildMenuWorkbook, parseCellText, parseMenuWorkbook, formatCellText } from '@/components/menu/menu-xlsx';
import { planMenuImport, type ExistingMenuRow } from '@/lib/menu-import';
import { normalizeSlot, buildSlotMap, MAIN_ROWS_PER_MEAL } from '@/lib/menu-utils';

/**
 * حماية من تكرار العطل: «تنزيل قائمة الطعام ثم رفعها» كان يغيّر المنيو —
 * أصناف تختفي (أقسام الملف كانت بارتفاع ثابت ٥/٣/٤ فأي خانة أكبر تُقصّ)،
 * وأرقام ترتيب تتضارب، وأسماء فيها «-رقم» تُقرأ اسماً + كمية إضافية سالبة.
 * كل اختبار هنا يمثّل واحداً من هذه المسارات.
 */

let seq = 0;
function meal(name: string, category: ItemCategory, type: MealType = 'lunch'): Meal {
  return { id: `meal-${++seq}`, name, type, is_snack: category === 'snack', category, created_at: '' };
}

function item(m: Meal, opts: { week?: number; day?: number; position: number; multiplier?: number; extra?: number } ): MenuItem {
  return {
    id: `item-${++seq}`,
    week_number: opts.week ?? 1,
    day_of_week: opts.day ?? 6,
    meal_type: m.type,
    meal_id: m.id,
    category: m.category!,
    position: opts.position,
    multiplier: opts.multiplier ?? 1,
    extra_quantity: opts.extra ?? 0,
    created_at: '',
    meals: m,
  };
}

/** يصدّر ثم يستورد — يرجّع الصفوف كما ستُكتب في قاعدة البيانات. */
function roundTrip(items: MenuItem[], meals: Meal[]) {
  const wb = buildMenuWorkbook(XLSX, items);
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const reread = XLSX.read(buf, { type: 'buffer' });
  return parseMenuWorkbook(XLSX, reread, meals);
}

/** الشكل المتوقّع بعد التطبيع — مصدر المقارنة الوحيد. */
function expectedRows(items: MenuItem[]) {
  const out: unknown[] = [];
  for (const [, slotItems] of buildSlotMap(items)) {
    for (const { item: it, category, position } of normalizeSlot(slotItems)) {
      out.push({
        week_number: it.week_number,
        day_of_week: it.day_of_week,
        meal_type: it.meal_type,
        meal_id: it.meal_id,
        category,
        position,
        multiplier: it.multiplier ?? 1,
        extra_quantity: it.extra_quantity ?? 0,
      });
    }
  }
  return out;
}

const key = (r: { week_number: number; day_of_week: number; meal_type: string; meal_id: string }) =>
  `${r.week_number}|${r.day_of_week}|${r.meal_type}|${r.meal_id}`;
const sorted = (rows: unknown[]) =>
  [...rows].sort((a, b) => key(a as never).localeCompare(key(b as never)));

describe('دورة تصدير/استيراد قائمة الطعام', () => {
  it('التنزيل ثم الرفع لا يغيّر أي صنف', () => {
    const rice  = meal('رز بخاري', 'hot');
    const soup  = meal('شوربة', 'hot');
    const salad = meal('سلطة خضراء', 'cold');
    const date  = meal('تمر', 'snack');
    const meals = [rice, soup, salad, date];

    const items = [
      item(rice,  { position: 0, multiplier: 2 }),
      item(soup,  { position: 1, extra: 40 }),
      item(salad, { position: 2 }),
      item(date,  { position: 100, multiplier: 3, extra: -5 }),
    ];

    const { rows, errors } = roundTrip(items, meals);
    expect(errors).toEqual([]);
    expect(sorted(rows)).toEqual(sorted(expectedRows(items)));
  });

  it('ما يفقد صنفاً لو الخانة أكبر من ارتفاع القسم القديم (٥ حار)', () => {
    const meals = Array.from({ length: 7 }, (_, i) => meal(`صنف حار ${i + 1}`, 'hot'));
    const items = meals.map((m, i) => item(m, { position: i }));
    expect(items.length).toBeGreaterThan(5); // كان يُقص عند ٥

    const { rows, errors } = roundTrip(items, meals);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(7);
    expect(sorted(rows)).toEqual(sorted(expectedRows(items)));
  });

  it('يملأ سعة الخانة كاملة (٨ أساسي + ٤ سناك) بلا نقص', () => {
    const mains  = Array.from({ length: MAIN_ROWS_PER_MEAL }, (_, i) => meal(`أساسي ${i + 1}`, i < 5 ? 'hot' : 'cold'));
    const snacks = Array.from({ length: 4 }, (_, i) => meal(`سناك ${i + 1}`, 'snack'));
    const meals = [...mains, ...snacks];
    const items = [
      ...mains.map((m, i)  => item(m, { position: i })),
      ...snacks.map((m, i) => item(m, { position: 100 + i })),
    ];

    const { rows, errors } = roundTrip(items, meals);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(12);
  });

  it('يحافظ على المضاعف والكمية الإضافية عبر عدة أسابيع وأيام', () => {
    const m1 = meal('كبسة', 'hot');
    const m2 = meal('عصير برتقال', 'snack');
    const meals = [m1, m2];
    const items = [
      item(m1, { week: 1, day: 6, position: 0, multiplier: 4, extra: 120 }),
      item(m1, { week: 3, day: 2, position: 0, multiplier: 1, extra: -30 }),
      item(m2, { week: 4, day: 5, position: 100, multiplier: 7 }),
    ];

    const { rows, errors, weeks } = roundTrip(items, meals);
    expect(errors).toEqual([]);
    expect(weeks).toEqual([1, 2, 3, 4]);
    expect(sorted(rows)).toEqual(sorted(expectedRows(items)));
  });

  it('التصدير مستقرّ: تصدير الناتج المستورد يعطي نفس الصفوف', () => {
    const hot  = meal('مندي', 'hot');
    const cold = meal('لبن', 'cold');
    const meals = [hot, cold];
    const items = [item(hot, { position: 3 }), item(cold, { position: 0 })]; // أرقام متضاربة

    const first = roundTrip(items, meals);
    // نعيد بناء أصناف من نتيجة الاستيراد ثم نصدّرها من جديد
    const rebuilt = first.rows.map(r => ({
      ...item(meals.find(m => m.id === r.meal_id)!, { position: r.position }),
      week_number: r.week_number,
      day_of_week: r.day_of_week,
      category: r.category,
      multiplier: r.multiplier,
      extra_quantity: r.extra_quantity,
    }));
    const second = roundTrip(rebuilt, meals);
    expect(sorted(second.rows)).toEqual(sorted(first.rows));
  });
});

describe('قراءة نص الخلية', () => {
  const known = new Set(['عصير برتقال-2', 'شاي x2', 'رز', 'رز بخاري']);
  const isKnown = (n: string) => known.has(n);

  it('لا يقتطع رقماً من اسم الصنف نفسه', () => {
    // العطل القديم: «عصير برتقال-2» كان يُقرأ «عصير برتقال» + كمية إضافية −2
    expect(parseCellText('عصير برتقال-2', isKnown)).toEqual({ name: 'عصير برتقال-2', multiplier: 1, extra: 0 });
  });

  it('اسم ينتهي بما يشبه المضاعف يبقى كما هو لو كان صنفاً معروفاً', () => {
    expect(parseCellText('شاي x2', isKnown)).toEqual({ name: 'شاي x2', multiplier: 1, extra: 0 });
  });

  it('يفكّ المضاعف والكمية الإضافية من نهاية النص', () => {
    expect(parseCellText('رز ×3 +50', isKnown)).toEqual({ name: 'رز', multiplier: 3, extra: 50 });
    expect(parseCellText('رز بخاري -20', isKnown)).toEqual({ name: 'رز بخاري', multiplier: 1, extra: -20 });
    expect(parseCellText('رز ×2', isKnown)).toEqual({ name: 'رز', multiplier: 2, extra: 0 });
  });

  it('يقبل الأرقام العربية', () => {
    expect(parseCellText('رز ×٣ +٢٥', isKnown)).toEqual({ name: 'رز', multiplier: 3, extra: 25 });
  });

  it('يتوقّف عند أول لاحقة غير متوقّعة بدل التخمين', () => {
    // لاحقة إضافية مكرّرة → نقف ونترك الباقي جزءاً من الاسم، فيفشل التعرّف
    // على الصنف ويظهر خطأ واضح بدل حفظ عدد مخترَع.
    const r = parseCellText('صنف مجهول ×2 +5 +7', isKnown);
    expect(r.name).toBe('صنف مجهول ×2 +5');
    expect(r.extra).toBe(7);
    expect(isKnown(r.name)).toBe(false);
  });

  it('formatCellText و parseCellText متعاكستان', () => {
    for (const [mult, extra] of [[1, 0], [3, 0], [1, -12], [5, 200]] as const) {
      const text = formatCellText('رز', mult, extra);
      expect(parseCellText(text, () => false)).toEqual({ name: 'رز', multiplier: mult, extra });
    }
  });
});

describe('رفض الملفات المعطوبة قبل أي كتابة', () => {
  function sheetFrom(items: MenuItem[], meals: Meal[]) {
    const wb = buildMenuWorkbook(XLSX, items);
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return { wb: XLSX.read(buf, { type: 'buffer' }), meals };
  }

  it('يبلّغ عن صنف غير موجود في قاعدة الأصناف بدل تجاهله بصمت', () => {
    const known = meal('رز', 'hot');
    const ghost = meal('صنف محذوف', 'hot');
    const { wb } = sheetFrom([item(known, { position: 0 }), item(ghost, { position: 1 })], [known]);

    const { rows, errors } = parseMenuWorkbook(XLSX, wb, [known]); // ghost غير معرّف
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('صنف محذوف');
    expect(rows).toHaveLength(1);
  });

  it('يبلّغ عن سناك موضوع في قسم أساسي', () => {
    const snack = meal('تمر', 'snack');
    // نضعه عمداً في قسم أساسي عبر تزوير فئة الصنف وقت التصدير
    const asMain: MenuItem = { ...item(snack, { position: 0 }), meals: { ...snack, is_snack: false, category: 'hot' } };
    const { wb } = sheetFrom([asMain], [snack]);

    const { errors } = parseMenuWorkbook(XLSX, wb, [snack]);
    expect(errors.some(e => e.includes('سناك'))).toBe(true);
  });

  it('يبلّغ عن تكرار الصنف في نفس الخانة (يخالف قيد التفرّد)', () => {
    const rice = meal('رز', 'hot');
    const wb = buildMenuWorkbook(XLSX, [item(rice, { position: 0 })]);
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const reread = XLSX.read(buf, { type: 'buffer' });

    // نكرّر نفس الاسم في صف آخر من نفس القسم واليوم
    const ws = reread.Sheets[reread.SheetNames[0]];
    const first = XLSX.utils.decode_cell('G3'); // صف أول من قسم الفطور، عمود السبت
    void first;
    const target = XLSX.utils.encode_cell({ r: 8, c: 6 }); // قسم الغداء الحار، عمود السبت
    ws[target] = { t: 's', v: 'رز' };
    const dup = XLSX.utils.encode_cell({ r: 9, c: 6 });
    ws[dup] = { t: 's', v: 'رز' };

    const { errors } = parseMenuWorkbook(XLSX, reread, [rice]);
    expect(errors.some(e => e.includes('مكرّر'))).toBe(true);
  });
});

describe('قراءة الملفات القديمة ثابتة الأحجام', () => {
  it('يقرأ ملفاً بأقسام ٥/٣/٤ بنفس النتيجة', () => {
    const hot   = meal('مرق', 'hot');
    const cold  = meal('زيتون', 'cold');
    const snack = meal('كيك', 'snack');
    const meals = [hot, cold, snack];

    // ملف قديم: العناوين في الصف ١، الفطور يبدأ الصف ٢ بارتفاع ٥ ثم بارد ٣ ثم سناك ٤
    const aoa: string[][] = Array.from({ length: 38 }, () => Array(8).fill(''));
    aoa[0][0] = 'الأسبوع الأول';
    ['الجمعة', 'الخميس', 'الأربعاء', 'الثلاثاء', 'الإثنين', 'الأحد', 'السبت'].forEach((d, i) => { aoa[1][i] = d; });
    aoa[1][7] = 'اليوم';
    aoa[2][7]  = 'الفطور';
    aoa[7][7]  = 'بارد';
    aoa[10][7] = 'سناك';
    aoa[14][7] = 'الغداء';
    aoa[19][7] = 'بارد';
    aoa[22][7] = 'سناك';
    aoa[26][7] = 'العشاء';
    aoa[31][7] = 'بارد';
    aoa[34][7] = 'سناك';
    // السبت = العمود 6
    aoa[14][6] = 'مرق ×2';
    aoa[19][6] = 'زيتون';
    aoa[22][6] = 'كيك +10';

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'الأسبوع الأول');

    const { rows, errors } = parseMenuWorkbook(XLSX, wb, meals);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { week_number: 1, day_of_week: 6, meal_type: 'lunch', meal_id: hot.id,   category: 'hot',   position: 0,   multiplier: 2, extra_quantity: 0 },
      { week_number: 1, day_of_week: 6, meal_type: 'lunch', meal_id: cold.id,  category: 'cold',  position: 1,   multiplier: 1, extra_quantity: 0 },
      { week_number: 1, day_of_week: 6, meal_type: 'lunch', meal_id: snack.id, category: 'snack', position: 100, multiplier: 1, extra_quantity: 10 },
    ]);
  });
});

describe('تدقيق التصدير/الاستيراد — حالات أُصلحت', () => {
  function reread(wb: XLSX.WorkBook) {
    return XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  }

  it('خانة فيها أكثر من ٨ أصناف أساسية (بعد «إضافة صف») تعبر الدورة بلا خطأ سعة', () => {
    const mains = Array.from({ length: 11 }, (_, i) => meal(`كبير ${i + 1}`, i < 9 ? 'hot' : 'cold'));
    const snacks = Array.from({ length: 6 }, (_, i) => meal(`سناك كبير ${i + 1}`, 'snack'));
    const meals = [...mains, ...snacks];
    const items = [
      ...mains.map((m, i) => item(m, { position: i })),
      ...snacks.map((m, i) => item(m, { position: 100 + i })),
    ];
    const { rows, errors } = roundTrip(items, meals);
    expect(errors).toEqual([]);
    expect(sorted(rows)).toEqual(sorted(expectedRows(items)));
  });

  it('يكتب فئة المنيو وشرح الرموز في عنوان الورقة', () => {
    const rice = meal('رز عنوان', 'hot');
    const wb = buildMenuWorkbook(XLSX, [item(rice, { position: 0 })], { entityType: 'companion' });
    const title = String(wb.Sheets[wb.SheetNames[0]]['A1'].v);
    expect(title).toContain('الأسبوع الأول');
    expect(title).toContain('منيو المرافقين');
    expect(title).toContain('المضاعف');
  });

  it('يرفض ملف منيو الفئة الأخرى بدل كتابته على التبويب المفتوح', () => {
    const rice = meal('رز فئة', 'hot');
    const wb = reread(buildMenuWorkbook(XLSX, [item(rice, { position: 0 })], { entityType: 'beneficiary' }));
    const wrong = parseMenuWorkbook(XLSX, wb, [rice], { entityType: 'companion' });
    expect(wrong.rows).toEqual([]);
    expect(wrong.weeks).toEqual([]);
    expect(wrong.errors.length).toBeGreaterThan(0);
    expect(wrong.errors[0]).toContain('منيو المستفيدين');

    const right = parseMenuWorkbook(XLSX, wb, [rice], { entityType: 'beneficiary' });
    expect(right.errors).toEqual([]);
    expect(right.rows).toHaveLength(1);
  });

  it('ملف النسخة الاحتياطية (أوراق الفئتين) يُقرأ منه منيو الفئة المفتوحة فقط', () => {
    const benMeal = meal('رز مستفيد', 'hot');
    const compMeal = meal('رز مرافق', 'hot');
    const out = XLSX.utils.book_new();
    for (const [et, m, suffix] of [['beneficiary', benMeal, 'مستفيدين'], ['companion', compMeal, 'مرافقين']] as const) {
      const src = buildMenuWorkbook(XLSX, [{ ...item(m, { position: 0 }), entity_type: et as EntityType }]);
      for (const n of src.SheetNames) XLSX.utils.book_append_sheet(out, src.Sheets[n], `${n} ${suffix}`);
    }
    const wb = reread(out);
    const comp = parseMenuWorkbook(XLSX, wb, [compMeal], { entityType: 'companion' });
    expect(comp.errors).toEqual([]);
    expect(comp.rows.map(r => r.meal_id)).toEqual([compMeal.id]);
    expect(comp.weeks).toEqual([1, 2, 3, 4]);
  });

  it('المضاعف خارج المدى خطأ واضح بدل استبداله بـ١ بصمت', () => {
    const rice = meal('رز مضاعف', 'hot');
    const wb = reread(buildMenuWorkbook(XLSX, [item(rice, { position: 0 })]));
    const ws = wb.Sheets[wb.SheetNames[0]];
    ws['G3'] = { t: 's', v: 'رز مضاعف ×150' };
    const { errors } = parseMenuWorkbook(XLSX, wb, [rice]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('×150');
    expect(parseCellText('رز ×0', () => false).invalid).toBeDefined();
  });

  it('صنف بارد في قسم الحار يُكتب بفئته الحقيقية (بارد)', () => {
    const salad = meal('سلطة قسم', 'cold', 'breakfast');
    const wb = reread(buildMenuWorkbook(XLSX, []));
    wb.Sheets[wb.SheetNames[0]]['G3'] = { t: 's', v: 'سلطة قسم' }; // أول صف حار في الفطور، السبت
    const { rows, errors } = parseMenuWorkbook(XLSX, wb, [salad]);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ meal_id: salad.id, category: 'cold', position: 0 });
  });

  it('ورقة باسم يحوي رقماً (Sheet1) لا تُعامل كأسبوع', () => {
    const rice = meal('رز ورقة', 'hot');
    const wb = reread(buildMenuWorkbook(XLSX, [item(rice, { position: 0 })]));
    const extra = XLSX.utils.aoa_to_sheet([['ملاحظات']]);
    XLSX.utils.book_append_sheet(wb, extra, 'Sheet1');
    const { errors, weeks } = parseMenuWorkbook(XLSX, wb, [rice]);
    expect(errors).toEqual([]);
    expect(weeks).toEqual([1, 2, 3, 4]);
  });

  it('القالب الفارغ = نفس تخطيط التصدير ويُقرأ بلا أخطاء', () => {
    const wb = reread(buildMenuWorkbook(XLSX, [], { entityType: 'beneficiary' }));
    expect(wb.SheetNames).toEqual(['الأسبوع الأول', 'الأسبوع الثاني', 'الأسبوع الثالث', 'الأسبوع الرابع']);
    const { rows, errors, weeks } = parseMenuWorkbook(XLSX, wb, [], { entityType: 'beneficiary' });
    expect(errors).toEqual([]);
    expect(rows).toEqual([]);
    expect(weeks).toEqual([1, 2, 3, 4]);
  });

  it('اسم الصنف يُؤخذ من قائمة الأصناف لو ما وصل مع صف المنيو', () => {
    const rice = meal('رز احتياطي', 'hot');
    const bare: MenuItem = { ...item(rice, { position: 0 }), meals: undefined };
    const wb = reread(buildMenuWorkbook(XLSX, [bare], { meals: [rice] }));
    const { rows, errors } = parseMenuWorkbook(XLSX, wb, [rice]);
    expect(errors).toEqual([]);
    expect(rows.map(r => r.meal_id)).toEqual([rice.id]);
  });
});

describe('planMenuImport — تطبيق الاستيراد', () => {
  const ex = (id: string, meal_id: string, position: number, category: ItemCategory = 'hot', extra: Partial<ExistingMenuRow> = {}): ExistingMenuRow => ({
    id, week_number: 1, day_of_week: 6, meal_type: 'lunch', meal_id, category, position, multiplier: 1, extra_quantity: 0, entity_type: 'beneficiary', ...extra,
  });
  const row = (meal_id: string, position: number, category: ItemCategory = 'hot') => ({
    week_number: 1, day_of_week: 6, meal_type: 'lunch' as MealType, meal_id, category, position, multiplier: 1, extra_quantity: 0,
  });

  it('رفع نفس المنيو بدون تعديل: لا كتابة ولا حذف', () => {
    const plan = planMenuImport([ex('a', 'm1', 0), ex('b', 'm2', 100, 'snack')], [row('m1', 0), row('m2', 100, 'snack')], 'beneficiary', 'replace');
    expect(plan).toMatchObject({ toWrite: [], staleIds: [], inserted: 0, updated: 0, unchanged: 2 });
  });

  it('الاستبدال يحذف ما ليس في الملف فقط', () => {
    const plan = planMenuImport([ex('a', 'm1', 0), ex('b', 'm2', 1)], [row('m1', 0)], 'beneficiary', 'replace');
    expect(plan.staleIds).toEqual(['b']);
    expect(plan.toWrite).toEqual([]);
  });

  it('الإضافة لا تحذف، وترحّل الأصناف الباقية بعد أصناف الملف بلا تصادم في الترتيب', () => {
    const existing = [ex('a', 'm1', 0), ex('b', 'm2', 1), ex('c', 's1', 100, 'snack')];
    const plan = planMenuImport(existing, [row('m3', 0), row('m4', 1), row('s2', 100, 'snack')], 'beneficiary', 'append');
    expect(plan.staleIds).toEqual([]);
    expect(plan.inserted).toBe(3);
    const pos = new Map(plan.toWrite.map(p => [p.meal_id as string, p.position as number]));
    expect(pos.get('m3')).toBe(0);
    expect(pos.get('m4')).toBe(1);
    expect(pos.get('m1')).toBe(2);
    expect(pos.get('m2')).toBe(3);
    expect(pos.get('s2')).toBe(100);
    expect(pos.get('s1')).toBe(101);
    expect(plan.updated).toBe(3); // m1، m2، s1 رُحّلت
  });

  it('الإضافة لا تلمس خانات لم يذكرها الملف', () => {
    const other = ex('z', 'm9', 0, 'hot', { day_of_week: 0 });
    const plan = planMenuImport([other], [row('m3', 0)], 'beneficiary', 'append');
    expect(plan.toWrite.map(p => p.meal_id)).toEqual(['m3']);
  });

  it('يكتب entity_type للفئة المفتوحة على كل صف', () => {
    const plan = planMenuImport([], [row('m1', 0)], 'companion', 'append');
    expect(plan.toWrite[0].entity_type).toBe('companion');
  });
});
