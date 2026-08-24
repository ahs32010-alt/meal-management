import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  kitchenItemsFromReport,
  nextPendingIndex,
  progressSummary,
  readProgress,
  writeProgress,
  type KitchenItem,
} from '@/lib/kitchen/items';
import { pickArabicVoice } from '@/lib/kitchen/speech';

/**
 * شاشة المطبخ يستعملها من لا يقرأ أي لغة، ويبني عليها كميات طبخ يوم كامل.
 * فالأخطاء هنا ليست تجميلية: بند ساقط = صنف ما اتطبخ، ورقم خاطئ = كمية خاطئة.
 */

const report = (rows: unknown) => ({ itemsSummary: rows });

describe('استخراج بنود «إحصاء الأصناف»', () => {
  it('يحافظ على ترتيب التقرير كما هو — لا يعيد الترتيب', () => {
    const items = kitchenItemsFromReport(
      report([
        { meal: { name: 'طماطم ٦ سلايز' }, quantity: 77 },
        { meal: { name: 'فاكهة' }, quantity: 74 },
        { meal: { name: 'كبدة' }, quantity: 57 },
      ]),
    );
    // المشرف يقرأ الورقة بهذا التسلسل — واختلاف الترتيب يعني أنه لا يقدر
    // يتابع المشغّل سطراً بسطر.
    expect(items.map((i) => i.name)).toEqual(['طماطم ٦ سلايز', 'فاكهة', 'كبدة']);
    expect(items.map((i) => i.count)).toEqual([77, 74, 57]);
  });

  it('يسقط البنود بكمية صفر أو سالبة — لا شيء يُطبخ منها', () => {
    const items = kitchenItemsFromReport(
      report([
        { meal: { name: 'رز' }, quantity: 76 },
        { meal: { name: 'عدس' }, quantity: 0 },
        { meal: { name: 'شوربة' }, quantity: -3 },
      ]),
    );
    expect(items.map((i) => i.name)).toEqual(['رز']);
  });

  it('يسقط البنود بلا اسم أو بلا رقم بدل نطق «undefined»', () => {
    const items = kitchenItemsFromReport(
      report([
        { meal: { name: '  ' }, quantity: 5 },
        { meal: null, quantity: 5 },
        { meal: { name: 'خبز' }, quantity: null },
        { meal: { name: 'لبن' }, quantity: 'كثير' },
        { meal: { name: 'بيض' }, quantity: 30 },
      ]),
    );
    expect(items.map((i) => i.name)).toEqual(['بيض']);
  });

  it('يتحمّل حمولة تقرير مشوّهة بلا انهيار', () => {
    for (const bad of [null, undefined, {}, { itemsSummary: 'نص' }, { itemsSummary: null }]) {
      expect(kitchenItemsFromReport(bad)).toEqual([]);
    }
  });

  it('يشتقّ الاسم اللاتيني — وقاموس المشرف يتقدّم على التحويل التلقائي', () => {
    const auto = kitchenItemsFromReport(report([{ meal: { name: 'كبدة' }, quantity: 57 }]));
    expect(auto[0].latin.length).toBeGreaterThan(0);

    const custom = kitchenItemsFromReport(
      report([{ meal: { name: 'كبدة' }, quantity: 57 }]),
      { 'كبدة': 'kebdah' },
    );
    // هذا هو النطق الذي عوّد المشرفُ المشغّلَ عليه — لا اجتهاد الخوارزمية.
    expect(custom[0].latin).toBe('kebdah');
  });
});

/**
 * صياغة النطق وترتيب الأصوات انتقلا إلى tests/kitchen-numbers.test.ts بعد
 * تغيير السلوك: العدد صار كلمات عامية لا رقماً، والفاصل فاصلة لا نقطة، ولا
 * تكرار افتراضياً. ويبقى هنا ما يخصّ توفّر الصوت أصلاً.
 */
describe('توفّر صوت عربي', () => {
  const voice = (name: string, lang: string, localService: boolean) =>
    ({ name, lang, localService, default: false, voiceURI: name }) as SpeechSynthesisVoice;

  it('يرجّع null حين لا صوت عربي — فتظهر إرشادات التثبيت', () => {
    expect(pickArabicVoice([voice('Daniel', 'en-GB', true)])).toBeNull();
  });

  it('يقبل صيغة الشرطة السفلية في رمز اللغة', () => {
    expect(pickArabicVoice([voice('X', 'ar_SA', true)])?.name).toBe('X');
  });
});

describe('تتبّع التقدّم', () => {
  const items: KitchenItem[] = [
    { key: 'a', name: 'أ', latin: 'a', count: 10 },
    { key: 'b', name: 'ب', latin: 'b', count: 20 },
    { key: 'c', name: 'ج', latin: 'c', count: 30 },
  ];

  it('ينتقل للبند التالي غير المنجَز', () => {
    expect(nextPendingIndex(items, new Set(['a']), 0)).toBe(1);
    expect(nextPendingIndex(items, new Set(['a', 'b']), 0)).toBe(2);
  });

  it('يلفّ للبداية ليلتقط ما تخطّاه المشغّل', () => {
    // بلا اللف ينتهي «تشغيل الكل» تاركاً المتخطَّى بلا تنبيه.
    expect(nextPendingIndex(items, new Set(['b', 'c']), 2)).toBe(0);
  });

  it('يرجّع null حين يكتمل كل شيء', () => {
    expect(nextPendingIndex(items, new Set(['a', 'b', 'c']), 0)).toBeNull();
  });

  it('يبدأ من أول بند حين نبدأ من -1', () => {
    expect(nextPendingIndex(items, new Set(), -1)).toBe(0);
  });

  it('يلخّص الإنجاز', () => {
    expect(progressSummary(items, new Set(['a']))).toEqual({ completed: 1, total: 3, allDone: false });
    expect(progressSummary(items, new Set(['a', 'b', 'c']))).toEqual({ completed: 3, total: 3, allDone: true });
    // قائمة فارغة ليست «مكتملة» — وإلا ظهر الأمر الفارغ كأنه أُنجز.
    expect(progressSummary([], new Set()).allDone).toBe(false);
  });
});

describe('حفظ التقدّم على الجهاز', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => void store.set(k, v),
          removeItem: (k: string) => void store.delete(k),
        },
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
  });

  it('يبقى بعد إغلاق الصفحة — المشغّل لا يقدر يتذكّر أين وقف', () => {
    writeProgress('order-1', new Set(['كبدة', 'رز']));
    expect(readProgress('order-1')).toEqual(new Set(['كبدة', 'رز']));
  });

  it('يفصل بين الأوامر — فطور اليوم لا يشطب بنود الغداء', () => {
    writeProgress('order-1', new Set(['كبدة']));
    expect(readProgress('order-2').size).toBe(0);
  });

  it('يتحمّل تخزيناً تالفاً بدل الانهيار', () => {
    store.set('kha:kitchen-done:order-1', '{ليس JSON');
    expect(readProgress('order-1').size).toBe(0);
    store.set('kha:kitchen-done:order-1', '{"a":1}');
    expect(readProgress('order-1').size).toBe(0);
  });
});
