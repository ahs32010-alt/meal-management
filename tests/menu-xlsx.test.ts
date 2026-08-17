import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { ItemCategory, Meal, MealType, MenuItem } from '@/lib/types';
import { buildMenuWorkbook, parseCellText, parseMenuWorkbook, formatCellText } from '@/components/menu/menu-xlsx';
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
